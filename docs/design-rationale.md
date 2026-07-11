# Design Rationale

Every significant decision on this project, stated as a **defensible rationale**
rather than a preference. The format is deliberate:

> **Decision** → **Forces** (what pressures the choice) → **Rationale** (why this
> one) → **Alternatives rejected** → **Consequences** (what we accept).

The [ADRs](adr/index.md) hold the long form; this page is the distilled
summary.

## Quality goals — the tie-breaker

When two good options conflict, this ordering decides:

**security > correctness > operability > throughput > feature count.**

That single line explains almost everything below: why login is deliberately
~37 ms (security beats throughput), why registration wastes a hash on a conflict
(security beats efficiency), and why there's no JWT layer (correctness and
scope-discipline beat feature count).

---

## 1. Fastify 5 over Express / Nest / Hono

- **Forces.** The input gate is the most security-critical code in an auth API,
  and it must be impossible to forget on a route. "Fast" is in the brief.
- **Rationale.** Fastify compiles a JSON Schema per route (AJV) for validation,
  and — decisively — **serializes responses against a schema too**
  (fast-json-stringify). That makes "a password hash can never appear in a
  response" a _structural_ guarantee, not a convention. The same TypeBox schema
  drives runtime validation, compile-time types, and the OpenAPI document — one
  source of truth, zero drift.
- **Alternatives rejected.** Express ships no validation and no response
  serialization; the guarantee would rest on discipline. NestJS's DI machinery
  is disproportionate for two endpoints. Hono targets edge runtimes we don't
  deploy to.
- **Consequences.** Reviewers less familiar with Fastify need its hook docs. Worth
  it. → [ADR-0001](adr/0001-fastify-over-express.md)

## 2. Argon2id over bcrypt

- **Forces.** Password hashing is the single most-scrutinized choice in an auth
  service, and the store is the crown-jewel target.
- **Rationale.** OWASP lists Argon2id **first**; bcrypt is "legacy-only." Argon2id
  is memory-hard — ~19 MiB per guess versus bcrypt's ~4 KB — which is what makes
  cracking a _leaked_ store expensive. And bcrypt **silently truncates at 72
  bytes**, a real correctness bug with a generous max length. PHC-format hashes
  embed their parameters, which enables **rehash-on-login**.
- **Alternatives rejected.** bcrypt (truncation + weaker); scrypt (OWASP-ranked
  below Argon2id); plain PBKDF2 (not memory-hard).
- **Consequences.** Native module (mitigated by prebuilt binaries); memory ×
  concurrency must be bounded — see the hashing gate (#7).
  → [ADR-0002](adr/0002-argon2id-over-bcrypt.md)

## 3. Uniqueness as atomicity — Redis `SET NX`

- **Forces.** "Usernames are unique" hides the classic check-then-set race: two
  concurrent registrations both pass an `EXISTS` check, both write, and the first
  user is silently orphaned.
- **Rationale.** Write the record with `SET user:NAME json NX` — atomic
  create-if-absent. A `nil` reply **is** the "taken" verdict (→ 409). There is no
  separate existence check anywhere in the write path, so the race cannot exist.
  Redis's single-threaded execution makes uniqueness a property of the datastore,
  not of application discipline.
- **Alternatives rejected.** `EXISTS`-then-`SET` (the race); `WATCH`/`MULTI` retry
  loops or Lua (more moving parts for the same guarantee).
- **Consequences.** The whole user lives under one JSON key rather than a hash +
  index — which also removes an entire class of index-desync bugs. A test fires 8
  concurrent registrations and asserts exactly one 201 and seven 409s.
  → [ADR-0003](adr/0003-atomic-uniqueness-set-nx.md)

## 4. Timing-safe login (no enumeration oracle)

- **Forces.** If "unknown user" is cheaper or different from "wrong password", an
  attacker can enumerate accounts by response _or_ by stopwatch.
- **Rationale.** Three defenses compose: (a) the login schema is deliberately
  loose (any non-empty strings) so a malformed username returns the same 401, not
  a 400; (b) the unknown-user path runs a real Argon2id verify against a
  **boot-time dummy hash**, so it costs the same wall-clock; (c) both failure
  bodies and headers are byte-identical. Registration hashes **before** the
  `SET NX`, so a 409 costs the same as a 201.
- **Alternatives rejected.** Returning 404/400 for unknown usernames (an oracle);
  skipping the hash when the user is absent (a timing oracle); a `Server-Timing`
  header (hands the attacker the measurement).
- **Consequences.** A wasted hash on every failed login and every conflict — the
  deliberate price of leaking nothing. An integration test measures both medians
  and asserts they're within tolerance.

## 5. Purpose-built Redis rate limiter — and the race it fixed

- **Forces.** Brute-force defense needs two coordinated windows (per-IP for all
  traffic; per-username failures, cleared on success) and must hold **across
  replicas**.
- **Rationale.** ~70 lines: `INCR` + `EXPIRE NX` + `TTL` in one `MULTI`. State in
  Redis means the cap is correct at any horizontal scale (an in-memory limiter
  multiplies its threshold by the instance count). The failure counter keys on the
  **submitted** username, real or not, so it can't be used as an existence probe.
  **The critical detail:** the failure slot is consumed with an atomic `INCR`
  _before_ the expensive verify. A read-only peek-then-check would be a TOCTOU race
  — a concurrent burst could all read `count < max` and slip past the cap. This
  was a real HIGH-severity finding from the adversarial review; the fix is
  increment-then-read, and it has a concurrency regression test.
- **Alternatives rejected.** `@fastify/rate-limit` (built around ioredis; no clean
  atomic consume-and-check `hit` / success-`clear` semantics for the failure
  window; this project standardizes on node-redis).
- **Consequences.** Fixed windows allow ≤2× burst at the edges — accepted at these
  thresholds; a sliding-log/token-bucket is the documented refinement.
  → [ADR-0008](adr/0008-custom-redis-rate-limiter.md)

## 6. RFC 9457 Problem Details for every error

- **Forces.** The brief wants "proper error checking, with error responses in a
  JSON body." Most APIs invent an ad-hoc `{ error }` envelope.
- **Rationale.** Error format is a _standards-citation_ exercise, not an invention.
  Every non-2xx is `application/problem+json` with a stable machine-readable
  `code`, a `requestId` correlating to logs, and a field-level `errors[]` on
  validation. Uniformity is itself a security property — the 401 body is identical
  for every failure cause **by construction**.
- **Alternatives rejected.** Bespoke error envelope (no tooling, no taxonomy);
  leaving `type` as `about:blank` (loses the machine-readable problem taxonomy).
- **Consequences.** One deliberate asymmetry: login failures carry a generic detail
  (enumeration defense) while registration failures list _every_ violated rule at
  once (developer experience). → [ADR-0006](adr/0006-rfc9457-problem-details.md)

## 7. Bounded hashing — the concurrency gate

- **Forces.** Argon2id's memory-hardness is the security feature _and_ an
  operational hazard: each in-flight hash reserves ~19 MiB. Unbounded concurrency
  turns a login burst into a self-inflicted memory DoS.
- **Rationale.** All hash/verify work goes through a `p-limit` gate
  (`maxConcurrency` default 8), so worst-case hashing memory is a bounded,
  predictable `8 × 19 ≈ 152 MiB`. The gate's queue depth is exported as a
  Prometheus gauge — the signal to scale out _before_ logins start queueing.
- **Alternatives rejected.** No gate (OOM under load); a global mutex (throughput
  collapse); tuning Argon2 down for speed (weakens the actual security property).
- **Consequences.** Sustained login throughput is capped — deliberately. The
  ceiling is `maxConcurrency ÷ verify-time ≈ 216 req/s`, and the benchmark lands
  within 4% of that math.

## 8. Scope discipline — no JWT / session issuance

- **Forces.** It is tempting to bolt on JWTs — and thereby become gradeable on
  token expiry, revocation, and rotation that a two-endpoint brief gives no room
  to finish properly.
- **Rationale.** The brief asks for exactly two capabilities. Credential
  _verification_ is a complete, composable internal service; a gateway or session
  service consumes it and owns token lifecycle. A half-built token layer is
  negative value in both security and signal.
- **Alternatives rejected.** Ship a JWT layer (out of scope, under-designed).
- **Consequences.** Callers needing "stay logged in" wait for the documented next
  iteration — by design, not omission. → [ADR-0005](adr/0005-no-sessions-or-jwt.md)

## 9. 201 Created — a documented deviation

- **Forces.** The brief says "200 OK for correct requests." RFC 9110 says resource
  creation is a 201 + `Location`.
- **Rationale.** Follow the RFC where the brief is generic, follow the brief where
  it is specific (the 200/401 clause plainly targets _login_). Silent literal
  compliance would be the _less_ correct API; silent deviation would be worse.
  So: deviate, and write it down.
- **Consequences.** A reviewer hard-coding `=== 200` on create sees 201; the README
  and this page flag it up front. → [ADR-0004](adr/0004-201-created-deviation.md)

## 10. NIST SP 800-63B-4 password policy

- **Forces.** "Pass a basic security audit (e.g. password complexity)." The legacy
  reflex is composition rules; NIST rev-4 (final, 2025) _prohibits_ them.
- **Rationale.** Length is the only strength rule (≥15 code points for
  single-factor), no composition rules, screen against a 10k-common blocklist, NFC
  normalization, reject-never-truncate, no forced rotation. Citing the current
  revision of the governing standard **is** passing the audit.
- **Alternatives rejected.** Composition rules (produce `P@ssw0rd1!`, reduce real
  strength); silent truncation (bcrypt's bug).
- **Consequences.** A reviewer trying `Passw0rd!` gets a 422 explaining the 15-char
  floor and citing the standard. → [ADR-0007](adr/0007-nist-password-policy.md)

## 11. Redis as system of record — the honest trade-off

- **Forces.** The brief mandates Redis for storage. Credentials are durable data.
- **Rationale.** Configure durability rather than default it: AOF `appendfsync
everysec` bounds crash-loss to ~1s of writes; production notes recommend RDB+AOF
  together.
- **Alternatives rejected.** Postgres as the system of record now (the brief
  mandates Redis for storage; named as the production evolution below instead).
- **Consequences — stated plainly.** For a regulated mortgage fintech I would make
  **Postgres** the system of record and keep Redis for rate-limiting and sessions.
  Naming this before being asked is the point: it's a conscious, bounded trade-off,
  not an oversight.

## 12. OpenTofu for IaC

- **Forces.** New IaC in 2026 that wants to stay open-source.
- **Rationale.** OpenTofu is the Linux Foundation's MPL-2.0 fork of Terraform after
  HashiCorp's BUSL relicense — drop-in compatible with the HCL/provider ecosystem.
  The stack (ECS Fargate, ALB, ElastiCache, ECR) is the standard shape for containerized services on AWS,
  and its security invariants are asserted by native `tofu test`, not hoped for.
- **Alternatives rejected.** Terraform proper (BUSL 1.1 since 2023 —
  source-available, not open source); CloudFormation/CDK (locks the IaC to one
  cloud's tooling).
- **Consequences.** Never applied to billable AWS — but applied end-to-end
  against LocalStack (emulated AWS APIs), so the Terraform is exercised, not
  just linted, and the demo stays zero-cost.

---

## How the rationale shows up in tests

A rationale is only "solid" if a regression would be caught. Each decision above
has an executable guard:

| Decision                   | The test that proves it                                             |
| -------------------------- | ------------------------------------------------------------------- |
| Atomic uniqueness (#3)     | 8 concurrent registrations → exactly one 201                        |
| Timing safety (#4)         | measured medians of unknown-user vs wrong-password within tolerance |
| TOCTOU fix (#5)            | concurrent-burst regression test on the failure limiter             |
| Response whitelisting (#1) | security suite asserts no hash/PHC prefix ever appears              |
| Reject-not-truncate (#10)  | over-long password → 422 with a `max_length` rule                   |

That last column is why I can say these are decisions I can **defend line by
line**, not assertions.
