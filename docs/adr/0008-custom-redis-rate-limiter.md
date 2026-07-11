# ADR-0008: Purpose-built Redis rate limiter (not a plugin)

**Status:** accepted — amended 2026-07-11 (`peek` removed; see [Amendment](#amendment-2026-07-11-peek-removed-after-adversarial-review))

## Context

Brute-force protection needs two coordinated windows: per-IP (all traffic)
and per-username (login failures only, cleared by success). The obvious
reach is `@fastify/rate-limit`.

## Decision

A ~90-line `RedisRateLimiter` (fixed windows; atomic
`INCR` + `EXPIRE NX` + `TTL` in one `MULTI`) with three verbs (`hit`,
`peek`, `clear`), plus a helper emitting the draft-IETF rate-limit headers.

## Rationale

- **Cross-replica correctness**: counters live in Redis, so limits hold at
  any horizontal scale. (In-memory limiters silently multiply thresholds by
  the instance count.)
- The per-username failure window needs `peek` (gate without consuming) and
  `clear` (success resets), semantics plugins don't expose cleanly.
- `@fastify/rate-limit`'s Redis store is built around ioredis; this project
  standardizes on the official `node-redis` client (ioredis's own README
  directs new projects there).
- Emits `RateLimit` / `RateLimit-Policy` structured fields per
  **draft-ietf-httpapi-ratelimit-headers-11** (still an Internet-Draft,
  noted in the README) + `Retry-After` on 429, instead of legacy
  `X-RateLimit-*`.
- Failure counters key on the _submitted_ username (existent or not), so the
  limiter cannot be used as an account-existence probe.

## Consequences

Fixed windows allow ≤2× burst at window edges, acceptable at these
thresholds; a sliding-log or token bucket is a documented future refinement.
90 lines of owned code carry their own tests (unit + integration).

## Amendment (2026-07-11): `peek` removed after adversarial review

The original design gated login with `peek` (a read-only check) and consumed
a slot only after a failed verify. Adversarial review found that to be a
**HIGH-severity TOCTOU race**: a concurrent burst of guesses could all read
`count < max` before any increment landed, letting the entire burst past the
cap and into the expensive Argon2id verify.

The shipped limiter therefore has **two verbs, `hit` and `clear`**. The login
handler consumes a slot with an atomic `INCR` **before** verification and
checks the returned count; Redis serializes the increments, so at most `max`
attempts per window ever reach a verify, and the window still clears on
success. A concurrency regression test pins the behaviour.

The sections above are retained as written for the historical record; where
they mention `peek`, this amendment supersedes them.
