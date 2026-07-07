# ADR-0006: RFC 9457 Problem Details for every error

**Status:** accepted

## Context

The brief requires "proper error checking, with error responses in a JSON
response body." Most APIs invent an ad-hoc `{ "error": ... }` envelope.

## Decision

Every non-2xx response — including 404s, 405s, malformed JSON, rate limits
and load shedding — is `application/problem+json` per **RFC 9457** (the 2023
standard that obsoleted RFC 7807), with two extension members: a stable
machine-readable `code` and the request's correlation `requestId`, plus a
field-level `errors[]` array on validation failures.

## Rationale

- Error format is a _standards citation exercise, not an invention
  exercise_: consumers get a documented, tooling-friendly shape.
- Each problem type has a stable `type` URI (`/problems/<slug>`) and appears
  in a registry table in the README — most Problem Details adopters leave
  `type` as `about:blank` and lose the machine-readable taxonomy.
- Uniformity is itself a security property: the 401 body is identical for
  every failure cause by construction.

## Consequences

- One deliberate exception to field detail: login failures carry a generic
  detail string (enumeration defense) while registration failures enumerate
  every violated rule (developer experience).
- The `errors[]` array reports _all_ violations at once — clients fix a
  password in one round trip instead of playing whack-a-mole.
