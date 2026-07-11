# Roadmap & Technical Debt

Nothing here is hidden. Every trade-off this service accepts, every decision it
defers, and every task a real production deployment would add is named openly
with the reason and the next step. Volunteering the limits is the point — a
system whose author can't list its weaknesses hasn't been examined closely
enough.

## Accepted trade-offs

Deliberate choices, sound at this scope, that a larger system would revisit.

| Trade-off                                                 | Why it's acceptable here                                                                           | What changes it                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Redis as the system of record**                         | Brief-mandated; AOF `everysec` bounds crash-loss to ~1s of writes                                  | Postgres as the durable store, Redis for rate-limiting/sessions ([ADR-0003](adr/0003-atomic-uniqueness-set-nx.md))                                                                                                                                 |
| **Fixed-window rate limiter** (≤2× burst at window edges) | Well within tolerance at 10/15 min and 100/min thresholds                                          | A sliding-log or token-bucket limiter ([ADR-0008](adr/0008-custom-redis-rate-limiter.md))                                                                                                                                                          |
| **No token/session issuance**                             | The brief asks only to verify credentials; a half-built token layer is negative value              | A gateway/session service consumes this API; or an IdP if SSO appears ([ADR-0005](adr/0005-no-sessions-or-jwt.md))                                                                                                                                 |
| **CSP disabled globally**                                 | The JSON API is unaffected; it exists only so the self-hosted Scalar `/docs` UI renders            | Scope CSP per-route or host the docs UI separately                                                                                                                                                                                                 |
| **Single Redis in the demo**                              | Zero-cost local run                                                                                | Replication/Sentinel, or managed ElastiCache (already in the IaC)                                                                                                                                                                                  |
| **409 on registration reveals a username exists**         | Unavoidable for username-based signup; the login side leaks nothing and registration is IP-limited | Invite-only or email-verified signup, if the threat model demands it                                                                                                                                                                               |
| **Timing equalization assumes uniform hash parameters**   | Holds today; the dummy hash uses current parameters                                                | If parameters are ever raised, pin the dummy hash to the weakest deployed parameters (or a constant minimum handler time) and pair the bump with a forced-rehash migration — see the [security model](security.md#residual-risks-named-on-purpose) |

## Test-coverage debt

The suite is 86 tests across five layers at ~97% line coverage, with mutation
testing gated at 80% (score 87%). One branch is deliberately left uncovered:

- **The `@fastify/under-pressure` load-shed 503.** Triggering it requires
  event-loop lag above a threshold, which can only be simulated with timing
  tricks that make a test flaky. A flaky test is worse than an honestly-noted
  gap, so it stays documented rather than faked. The sibling failure path — the
  `/readyz` 503 when Redis is unreachable — **is** covered (an integration test
  force-closes the client and asserts the 503 + problem body). Closing this
  properly means making the pressure thresholds injectable so the branch can be
  driven deterministically.

## Infrastructure & operations debt

| Item                 | Status                                                                                                    | Next step                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| IaC assurance depth  | `tofu test` asserts security invariants at plan time; the stack is applied end-to-end on LocalStack in CI | Policy-as-code (OPA/Conftest) and apply-time integration tests against a sandbox account                                            |
| Metrics/trace wiring | `/metrics` and opt-in OTLP tracing are implemented                                                        | The scrape config, dashboards, and alert rules are environment-side — the [runbook](OPERATIONS.md) lists the conditions to alert on |
| Log retention        | Structured audit events ship to stdout                                                                    | A retention policy for the audit trail (PIPEDA) once a log pipeline is chosen                                                       |

## Required before a real production deployment

The service is production-_grade_ in construction, not production-_deployed_.
A real rollout adds, roughly in order:

1. **TLS everywhere** — terminate at the ALB/ingress (`TRUST_PROXY` already
   plumbed); `rediss://` + Redis AUTH/ACL between app and Redis (the IaC already
   provisions ElastiCache with both encryptions and an auth token).
2. **Session/token issuance** — short-lived JWTs or opaque sessions with
   revocation; this service remains the credential-verification primitive.
3. **Breached-password screening** — the HIBP k-anonymity range API alongside
   the static 10k blocklist.
4. **Account-lockout escalation** — exponential backoff / step-up beyond the
   fixed window, and alerting on `auth.rate_limited` spikes.
5. **MFA hooks** and password reset/change flows (with rehash-on-change).
6. **Secret rotation** — a rotation Lambda + schedule for the Redis auth token
   in Secrets Manager (the wiring point exists; see
   [Configuration](CONFIGURATION.md)).
7. **Observability wiring** — Prometheus scrape config, dashboards, and alert
   rules (e.g. on `authapi_hash_queued` and `auth.rate_limited`).
8. **Compliance operationalization** — audit-log retention (PIPEDA) and SOC 2
   evidence collection; the controls exist, the organization provides the
   process. See [Compliance](COMPLIANCE.md).

## Considered and deferred

Options that were evaluated and consciously left out — knowing _why not_ is as
much a part of the design as knowing _why_.

| Option                               | Verdict                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `Idempotency-Key` header             | The IETF draft expired (April 2026) without becoming an RFC — revisit if revived                         |
| `Server-Timing` header               | Rejected: it would hand attackers the timing oracle the dummy-hash defense closes                        |
| CORS middleware                      | Rejected: an internal service-to-service API has no browser callers; enabling it only widens the surface |
| Composition rules (uppercase/symbol) | Prohibited by NIST 800-63B-4 — they reduce real-world strength                                           |
| `GET /users/:name`                   | Rejected: a purpose-built account-enumeration endpoint                                                   |
| Password rotation                    | Prohibited by NIST absent evidence of compromise                                                         |

---

The next iteration most worth building is **session/token issuance** — it's the
natural composition boundary this service was scoped around, and everything
above (MFA, revocation, lockout escalation) hangs off it.
