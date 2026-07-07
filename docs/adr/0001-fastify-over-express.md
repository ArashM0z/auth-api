# ADR-0001: Fastify 5 over Express 5

**Status:** accepted

## Context

The brief requires a fast, secure, production-quality JSON API on Node.js.
The realistic candidates in mid-2026: Express 5 (ubiquitous), Fastify 5,
Hono (edge-first), NestJS (framework-heavy).

## Decision

Fastify 5.

## Rationale

- **Validation is core, not middleware.** Fastify compiles a JSON Schema per
  route (AJV) for body/query/params — the security-critical input gate is
  declarative and cannot be forgotten on a route. Express ships none.
- **Response-schema serialization** (fast-json-stringify) whitelists output
  fields per status code. For an auth service this is a structural guarantee
  that a password hash can never leak into a response — stronger than
  convention or review.
- **Schemas triple as the contract**: the same TypeBox objects drive runtime
  validation, compile-time types (`@fastify/type-provider-typebox`), and the
  generated OpenAPI document. One source of truth, zero drift.
- **Performance**: materially higher throughput than Express on JSON
  workloads; "fast" is in the brief.
- First-party plugin suite (`@fastify/helmet`, `@fastify/under-pressure`,
  `@fastify/swagger`) verified current and Fastify-5 compatible.

## Consequences

Express is more universally familiar; reviewers may need the Fastify docs
for hook semantics. Hono targets multi-runtime/edge (not this deployment);
NestJS's DI machinery is disproportionate for two endpoints.
