# Architecture Decision Records

Each significant choice is captured as an ADR — context, decision, rationale, and
the consequences we accept. The [Design rationale](../design-rationale.md) page is
the distilled, cross-cutting version; these are the long form.

| ADR                                       | Decision                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| [0001](0001-fastify-over-express.md)      | Fastify 5 over Express — schema-first validation + response whitelisting |
| [0002](0002-argon2id-over-bcrypt.md)      | Argon2id over bcrypt — OWASP ordering, 72-byte cliff, rehash-on-login    |
| [0003](0003-atomic-uniqueness-set-nx.md)  | `SET NX` atomic uniqueness — no check-then-set race                      |
| [0004](0004-201-created-deviation.md)     | 201 Created — documented deviation from the brief's "200 OK"             |
| [0005](0005-no-sessions-or-jwt.md)        | No JWT/sessions — scope discipline                                       |
| [0006](0006-rfc9457-problem-details.md)   | RFC 9457 Problem Details for every error                                 |
| [0007](0007-nist-password-policy.md)      | NIST 800-63B-4 policy — 15+ chars, no composition rules                  |
| [0008](0008-custom-redis-rate-limiter.md) | Purpose-built Redis rate limiter                                         |

> **Note on ADR-0008:** it describes a `peek` verb from the original limiter
> design. The shipped `rate-limit.ts` has only `hit()` and `clear()` — the
> peek-then-check approach was the racy design the adversarial review replaced with
> the atomic `hit()` gate. The code is the source of truth; this ADR predates the
> fix.
