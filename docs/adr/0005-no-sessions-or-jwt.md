# ADR-0005: No session/JWT issuance (scope discipline)

**Status:** accepted

## Context

The brief asks for exactly two capabilities: create a login, authenticate a
login. It is tempting to bolt on JWTs — and then you are gradeable on token
expiry, revocation, secret rotation, and cookie hygiene you never actually
implemented.

## Decision

`POST /v1/auth/login` verifies credentials and returns
`{ "authenticated": true, ... }`. No token, no cookie, no session store.

## Rationale

- Everything shipped gets reviewed; a half-designed token layer is negative
  value in both security and signal.
- Credential _verification_ is a complete, composable internal service: a
  gateway or session service consumes this API and owns credential artifacts
  with their own lifecycle.
- The natural next iteration (short-lived JWT or opaque token with
  revocation; an IdP like Keycloak/Cognito if SSO requirements appear) is
  documented in SECURITY.md rather than half-built.

## Consequences

Callers needing "stay logged in" semantics must wait for that iteration;
that's by design, not an omission.
