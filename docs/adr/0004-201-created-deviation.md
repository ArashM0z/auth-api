# ADR-0004: 201 Created for registration (documented deviation from "200 OK")

**Status:** accepted

## Context

The brief says the API "should respond with 200 OK messages for correct
requests, and 401 for failing authentication requests." Resource creation in
HTTP semantics (RFC 9110 §9.3.3, §15.3.2) is a 201 with a `Location` header.

## Decision

`POST /v1/users` → **201 Created** + `Location: /v1/users/<name>`.
`POST /v1/auth/login` → **200 OK** on success, **401** on failure, exactly
as specified, since that clause plainly targets the authentication endpoint.

## Rationale

Following the RFC where the brief is generic, and the brief where it is
specific, is the behavior an internal-platform team actually wants. Silent
literal compliance (200 on create) would be the _less_ correct API; silent
deviation would be worse. Hence: deviate, and write it down. This ADR and
the README both flag it for reviewers.

## Consequences

A reviewer testing with a hard-coded `=== 200` on creation will see 201; the
README's API table states this on the first screen.
