# Security Model

This document is the security half of the submission: what is defended, how,
where the residual risks are, and what a production deployment must add.
Standards are cited by name so every choice is auditable, not aesthetic.

## Threat model & mitigations

| Threat                                   | Mitigation                                                                                                                                                                                                    | Where                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Credential theft from a leaked datastore | Argon2id (OWASP first-choice, memory-hard) at 19 MiB / t=2 / p=1; PHC strings with per-password salts; params upgrade transparently on login (`needsRehash`)                                                  | `src/domain/password-hasher.ts`, `src/services/user-service.ts` |
| Brute force / credential stuffing        | Per-username failure window (10 per 15 min, clears on success) + per-IP window (100/min), both **in Redis so limits hold across replicas**; Argon2id verify cost (~tens of ms) caps guess rate per connection | `src/plugins/rate-limit.ts`, `src/routes/auth.ts`               |
| Username enumeration — response oracle   | Wrong-password and unknown-user return byte-identical 401 problems (asserted by an integration test); login schema is deliberately loose so malformed usernames also get 401, not 400                         | `src/routes/auth.ts`                                            |
| Username enumeration — timing oracle     | Unknown users burn a dummy Argon2id verification precomputed at boot; registration hashes **before** the uniqueness check so 409s cost the same as 201s                                                       | `src/domain/password-hasher.ts`, `src/services/user-service.ts` |
| Duplicate-account race                   | Uniqueness is enforced by Redis `SET ... NX` — atomic create-if-absent, no check-then-set window (verified by a concurrent-registration test)                                                                 | `src/services/user-service.ts`                                  |
| Homoglyph / case-trick accounts          | Usernames NFC-normalized, lowercased, restricted to `[a-z0-9._-]`; `Alice`, `alice` and Cyrillic look-alikes cannot coexist                                                                                   | `src/domain/username.ts`                                        |
| Weak passwords                           | NIST SP 800-63B-4 (final, 2025-07): min 15 code points, no composition rules, 10k common-password blocklist, username-containment check, reject-never-truncate                                                | `src/domain/password-policy.ts`                                 |
| Memory-exhaustion DoS via hashing        | Every in-flight hash reserves 19 MiB, so hashing is capped at `HASH_MAX_CONCURRENCY` (default 8 → worst case ~152 MiB); excess waits in queue                                                                 | `src/domain/password-hasher.ts`                                 |
| Event-loop overload                      | `@fastify/under-pressure` sheds load with 503 + `Retry-After` when the loop lags                                                                                                                              | `src/app.ts`                                                    |
| Oversized / hostile payloads             | 16 KiB body limit (413), strict JSON-only content type (415), password length cap (422, rejected not truncated)                                                                                               | `src/app.ts`, schemas                                           |
| Mass assignment / smuggled fields        | AJV configured with `removeAdditional: false` + `additionalProperties: false`: unknown fields are **rejected**, not silently stripped (Fastify's default strips)                                              | `src/app.ts`                                                    |
| Type-coercion bypass                     | `coerceTypes: false` — a numeric password is a 400, not a string                                                                                                                                              | `src/app.ts`                                                    |
| Secrets in responses                     | Response-schema serialization (fast-json-stringify) whitelists every field per status code — a hash structurally cannot appear in output; tested                                                              | route schemas                                                   |
| Secrets in logs                          | Request bodies are never logged; pino `redact` censors password paths as defense in depth                                                                                                                     | `src/app.ts`                                                    |
| Missing forensic trail                   | Structured audit events (`user.created`, `auth.success`, `auth.failure`, `auth.rate_limited`, `user.password_rehashed`) with request id + IP, never credentials                                               | `src/audit.ts`                                                  |
| Supply chain                             | Lockfile, minimal dependency set, `npm audit` gate in CI, CodeQL static analysis, Dependabot (npm / actions / docker / terraform)                                                                             | `.github/`                                                      |
| Container compromise blast radius        | Multi-stage image: no devDependencies, no TS sources, runs as the unprivileged `node` user (CI asserts uid ≠ 0)                                                                                               | `Dockerfile`, `ci.yml`                                          |
| Data loss (Redis as system of record)    | AOF `appendfsync everysec` in compose (≤1s loss window); production notes recommend RDB+AOF together per Redis persistence docs                                                                               | `compose.yaml`, README                                          |

## Deliberately rejected

- **`Server-Timing` header** — would hand attackers the exact timing oracle
  the dummy-hash defense closes.
- **`GET /users/:name`** — not in the brief, and it would be a purpose-built
  enumeration endpoint.
- **CORS middleware** — this is an internal service-to-service API with no
  browser callers; enabling CORS would only widen the attack surface.
- **Composition rules** (uppercase/symbol requirements) — prohibited by NIST
  800-63B-4 because they reduce real-world strength.
- **Idempotency-Key header** — the IETF draft expired (April 2026) without
  becoming an RFC; revisit if it is revived.

## Accepted tradeoffs

- **409 on registration reveals username existence.** Unavoidable for a
  username-based signup; standard industry posture. The login side leaks
  nothing, and registration is IP-rate-limited.
- **Redis as primary store** is mandated by the brief. With AOF everysec the
  crash-loss window is ~1s of registrations. A production system of record
  would be Postgres, with Redis for rate limiting and sessions.
- **CSP disabled globally** so the self-hosted Scalar API reference at `/docs` works;
  the API surface itself is JSON-only where CSP does not apply. A production
  hardening pass would scope CSP per route or host docs separately.
- **Timing equalization is exact only while hash parameters are uniform.**
  The unknown-user path verifies against a boot-time dummy hash built with
  the _current_ Argon2id parameters. If an operator later _raises_ those
  parameters, an existing user whose stored hash still encodes the older,
  cheaper parameters (and who has not yet logged in successfully to trigger
  rehash-on-login) verifies slightly faster than the unknown-user path —
  a narrow, transient enumeration signal for that specific account class.
  It is bounded by the per-username failure limiter (≈10 samples / 15 min)
  and drains as accounts re-authenticate. The robust closure — a constant
  minimum handler time, or a dummy hash pinned to the weakest deployed
  parameters — is listed in future work; a parameter bump should be paired
  with a forced-rehash migration. (Surfaced by the adversarial review.)

## Required before real production (annotated future work)

1. **TLS everywhere** — terminate at the ALB/ingress (`TRUST_PROXY=true` is
   already plumbed); `rediss://` + Redis AUTH/ACL between API and Redis (the
   OpenTofu config already provisions ElastiCache with both encryptions and
   an auth token).
2. **Session/token issuance** — this service only _verifies_ credentials by
   design; the next iteration issues short-lived JWTs or opaque sessions
   with revocation.
3. **Breached-password screening** — HIBP k-anonymity range API alongside
   the static blocklist.
4. **Account lockout escalation** — exponential backoff / step-up challenge
   beyond the fixed window; alerting on `auth.rate_limited` spikes.
5. **MFA hooks**, password reset/change flows (with rehash-on-change).
6. **Secret rotation** — the IaC stores the Redis auth token in AWS Secrets
   Manager and config in SSM Parameter Store (see
   [docs/CONFIGURATION.md](docs/CONFIGURATION.md)); wiring an automatic
   rotation Lambda + schedule is the remaining prod step.
7. **Observability wiring** — Prometheus `/metrics` and OpenTelemetry tracing
   are implemented (traces opt-in via OTLP env); production adds the scrape
   config, dashboards, and alert rules (e.g. on `authapi_hash_queued` and
   `auth.rate_limited` spikes).
8. **IaC assurance depth** — `tofu test` covers security invariants at plan
   time; deeper policy-as-code (OPA/Conftest or Sentinel) and apply-time
   integration tests against a sandbox account are the next layer (see
   technical debt in [docs/architecture.md](docs/architecture.md)).
9. **Compliance operationalization** — log retention policy for the audit
   trail (PIPEDA), SOC 2 evidence collection (this repo provides the
   controls; the organization provides the process).

## Compliance mapping (SOC 2-style controls)

| Control area                     | Evidence in this repo                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Access control / least privilege | Non-root container; scoped IAM task roles in `infra/`; Redis SG only reachable from app SG     |
| Change management                | CI gates (lint, typecheck, tests, audit, CodeQL, OpenAPI drift) on every change                |
| Monitoring & incident response   | Structured audit log with correlation ids; health probes; load-shedding signals                |
| Confidentiality                  | Argon2id at-rest for credentials; encryption in transit/at rest in the IaC; no secrets in code |
| Data minimization (PIPEDA)       | Stored per user: username + hash + timestamps. Nothing else exists to breach.                  |
