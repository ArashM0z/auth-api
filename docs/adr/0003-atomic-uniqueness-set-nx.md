# ADR-0003: Username uniqueness via Redis `SET NX`

**Status:** accepted

## Context

"Usernames must be unique" hides a classic distributed-systems bug: the
check-then-set race. Two concurrent registrations of `alice` both pass an
`EXISTS`/`GET` check, then both write — last writer wins, first user's
credentials are silently orphaned.

## Decision

The user record is written with `SET user:<name> <json> NX` — Redis's atomic
create-only-if-absent. A `nil` reply _is_ the uniqueness verdict (→ 409).
There is no separate existence check anywhere in the write path.

## Rationale

- Redis executes commands single-threaded: `NX` makes uniqueness a property
  of the datastore, not of application-level discipline.
- No `WATCH`/`MULTI` retry loops, no Lua — one command, one guarantee.
- An integration test fires 8 concurrent registrations for the same name and
  asserts exactly one 201 and seven 409s.

## Consequences

- The whole user must live under a single key (JSON blob) rather than
  a Redis hash plus separate index key — acceptable at this record size, and
  it removes an entire class of index-desync bugs.
- Hashing happens _before_ the `SET NX`, so a conflict response costs the
  same wall-clock as a success (no registration timing oracle). The wasted
  hash on conflict is the deliberate price.
