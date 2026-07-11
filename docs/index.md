# Authentication API — Architecture Documentation

An internal REST service that **creates logins** and **verifies credentials** —
nothing more, by design. Built on **Node.js 24**, **TypeScript 6 (strict)**,
**Fastify 5**, and **Redis 8**, with **Argon2id** password storage.

This site is the architecture documentation, structured on
[arc42](https://arc42.org). Every significant decision has a **solid, written
rationale** and cites the standard it implements (NIST SP 800-63B-4, OWASP,
RFC 9457, RFC 9110) rather than folklore.

<div class="grid cards" markdown>

- :material-scale-balance:{ .lg .middle } **[Design rationale](design-rationale.md)**

    ---

    The quality goals, the priority ordering, and every major decision as
    *decision → forces → rationale → alternatives rejected → consequences*.

- :material-sitemap:{ .lg .middle } **[Architecture (arc42)](architecture.md)**

    ---

    Context, building blocks, runtime, deployment, and cross-cutting concepts.

- :material-chart-sankey:{ .lg .middle } **[Diagrams](diagrams.md)**

    ---

    The whole system drawn — 13 Mermaid diagrams from system context down to a
    single Redis command.

- :material-shield-lock:{ .lg .middle } **[Security model](security.md)**

    ---

    Threat model, the timing-safe login, and the honest residual risks.

- :material-gavel:{ .lg .middle } **[Compliance & AI governance](COMPLIANCE.md)**

    ---

    OSFI E-23 / B-13 / B-10, PIPEDA, and how I'd govern an AI mortgage feature.

- :material-robot-happy:{ .lg .middle } **[AI workflow](AI_WORKFLOW.md)**

    ---

    How AI was used — and why the judgment calls are mine to defend.

</div>

## At a glance

| | |
| --- | --- |
| **Endpoints** | `POST /v1/users` (201) · `POST /v1/auth/login` (200/401) · `/healthz` · `/readyz` · `/metrics` |
| **Password storage** | Argon2id (OWASP params), PHC strings, rehash-on-login |
| **Uniqueness** | Redis `SET NX` — the check-then-set race is structurally impossible |
| **Login safety** | Wrong-password and unknown-user are identical in body, headers, **and timing** |
| **Errors** | RFC 9457 `application/problem+json`, stable `code` + `requestId`, everywhere |
| **Rate limiting** | Two Redis-backed windows (per-IP, per-username failures) — correct across replicas |
| **Tests** | 79 tests, ~96% coverage, 5 layers + Stryker mutation testing (87%, gate 80%) |
| **Infra** | OpenTofu → ECS Fargate + ALB + ElastiCache + ECR (validated, not applied) |

## Quickstart

```bash
docker compose up --build   # API on :3000, Redis with AOF durability
# interactive docs (Scalar): http://localhost:3000/docs
```

> The quality priority order that drives every trade-off on this site:
> **security > correctness > operability > throughput > feature count.**
