# Authentication API

An internal REST service that **creates logins** and **verifies credentials** —
nothing more, by design. Built on **Node.js 24 LTS**, **TypeScript 6 (strict)**,
**Fastify 5**, and **Redis 8**, with **Argon2id** password storage.

Every error is an [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)
response, the OpenAPI contract is generated from the same schemas that validate
requests (CI fails on drift), and every security decision cites the standard it
implements (NIST SP 800-63B-4, OWASP, RFC 9110) rather than folklore.

**Approach.** Two calls shaped the design from the outset: treat username
uniqueness as an _atomicity_ problem (a single `SET NX`, never check-then-set),
and make login _timing-safe_ so it can't be used to enumerate accounts.
Everything else follows from two rules — hold each decision to a cited standard,
and keep scope tight. The reasoning for each choice is an
[ADR](https://arashm0z.github.io/auth-api/docs/adr/); the honest limits and the
next iteration are on the
[roadmap](https://arashm0z.github.io/auth-api/docs/roadmap/).

## Live — nothing to install

Hosted on GitHub Pages:

- **[Playground](https://arashm0z.github.io/auth-api/playground.html)** — fire every case (create, login, weak password, duplicate, wrong password, rate-limited, malformed) and watch the real client ⇄ app ⇄ Redis exchange
- **[API reference](https://arashm0z.github.io/auth-api/api.html)** — the OpenAPI contract, rendered with [Scalar](https://github.com/scalar/scalar)
- **[Rate-limiter demo](https://arashm0z.github.io/auth-api/ratelimit.html)** — the live per-username failure window
- **[Infrastructure tour](https://arashm0z.github.io/auth-api/)** — the Terraform stack applied on [LocalStack](https://localstack.cloud) ($0, re-applied in CI)
- **[Visual guide](https://arashm0z.github.io/auth-api/visual-guide.html)** — 13 diagrams, system context down to a single Redis command
- **[Architecture handbook](https://arashm0z.github.io/auth-api/docs/)** — the full **arc42** documentation, searchable

The landing is a typed **React + TypeScript** app; the handbook is **MkDocs
Material**. Both deploy automatically on every change.

## Quickstart

```bash
docker compose up --build        # API on :3000, Redis with AOF durability
```

```bash
# create a login
curl -i -X POST localhost:3000/v1/users \
  -H 'content-type: application/json' \
  -d '{"username": "alice", "password": "correct horse battery staple"}'
# → 201 Created, Location: /v1/users/alice

# authenticate it
curl -i -X POST localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username": "alice", "password": "correct horse battery staple"}'
# → 200 {"authenticated":true,"user":{"username":"alice"}}
```

Interactive docs at `http://localhost:3000/docs` ·
[API reference](https://arashm0z.github.io/auth-api/api.html) ·
hot reload: `docker compose -f compose.yaml -f compose.dev.yaml up --build` ·
native: `npm ci && npm run dev`.

## API

| Endpoint                                   | Success                      | Failures                                                                     |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------- |
| `POST /v1/users` — create a login          | **201 Created** + `Location` | 400 validation · 409 taken · 422 policy · 415/413/429                        |
| `POST /v1/auth/login` — verify credentials | **200 OK**                   | **401** invalid credentials · 429 rate limited · 400/413/415 protocol errors |
| `GET /healthz` — liveness                  | 200                          | —                                                                            |
| `GET /readyz` — readiness (Redis PING)     | 200                          | 503                                                                          |

Creation returns **201** per RFC 9110, not a literal 200
([ADR-0004](https://arashm0z.github.io/auth-api/docs/adr/0004-201-created-deviation/));
login issues **no token/session** by scope
([ADR-0005](https://arashm0z.github.io/auth-api/docs/adr/0005-no-sessions-or-jwt/)).
Usernames are case-insensitively unique and NFC-normalized; passwords follow
NIST SP 800-63B-4 (15+ code points, no composition rules, blocklist-screened,
reject-never-truncate —
[ADR-0007](https://arashm0z.github.io/auth-api/docs/adr/0007-nist-password-policy/)).

## Highlights

- **Argon2id** at OWASP parameters, PHC strings, rehash-on-login ([ADR-0002](https://arashm0z.github.io/auth-api/docs/adr/0002-argon2id-over-bcrypt/))
- **Atomic uniqueness** via `SET NX` — the check-then-set race is structurally impossible; a test fires 8 concurrent registrations to prove it ([ADR-0003](https://arashm0z.github.io/auth-api/docs/adr/0003-atomic-uniqueness-set-nx/))
- **Timing-safe login** — wrong-password and unknown-user are byte-identical in body, headers, **and timing** ([security model](https://arashm0z.github.io/auth-api/docs/security/))
- **Two Redis-backed rate limits**, correct across replicas; the login gate is an atomic `INCR` _before_ the hash — the TOCTOU fix an adversarial review surfaced ([ADR-0008](https://arashm0z.github.io/auth-api/docs/adr/0008-custom-redis-rate-limiter/))
- **RFC 9457** errors everywhere; response-schema whitelisting means a password hash cannot leak into a response ([ADR-0006](https://arashm0z.github.io/auth-api/docs/adr/0006-rfc9457-problem-details/))
- **Observability** — always-on Prometheus metrics + opt-in OpenTelemetry; Argon2id queue-depth gauges are the scale-out signal ([runbook](https://arashm0z.github.io/auth-api/docs/OPERATIONS/))
- **86 tests, ~97% coverage**, five layers + Stryker mutation testing (87%, gated at 80%) ([testing arsenal](https://arashm0z.github.io/auth-api/docs/#the-testing-verification-arsenal))
- **Hardened AWS IaC** (OpenTofu) — customer-managed KMS everywhere, WAF-fronted ALB, VPC flow logs; applied end-to-end on LocalStack in CI, never on billable AWS ([infrastructure tour](https://arashm0z.github.io/auth-api/))
- **dev → staging → prod** promotion pipeline — one immutable image, OIDC (no stored keys), production behind a required-reviewer gate ([deployment](https://arashm0z.github.io/auth-api/docs/DEPLOYMENT/))

## Documentation

The searchable **[arc42 architecture handbook](https://arashm0z.github.io/auth-api/docs/)**
is the canonical reference:

| Page                                                                               | Covers                                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Design rationale](https://arashm0z.github.io/auth-api/docs/design-rationale/)     | Every major decision: decision → forces → rationale → alternatives → consequences   |
| [Architecture (arc42)](https://arashm0z.github.io/auth-api/docs/architecture/)     | Context, building blocks, runtime view, deployment, cross-cutting concepts          |
| [Diagrams](https://arashm0z.github.io/auth-api/docs/diagrams/)                     | 13 Mermaid diagrams, system context down to a single Redis command                  |
| [Security model](https://arashm0z.github.io/auth-api/docs/security/)               | Threat model, the timing-safe login flow, honestly-named residual risks             |
| [Operations (runbook)](https://arashm0z.github.io/auth-api/docs/OPERATIONS/)       | Probes, metrics with alert conditions, failure modes, the performance envelope      |
| [Deployment](https://arashm0z.github.io/auth-api/docs/DEPLOYMENT/)                 | dev → staging → prod promotion, OIDC, environment approval gates                    |
| [Compliance & AI governance](https://arashm0z.github.io/auth-api/docs/COMPLIANCE/) | OSFI E-23 / B-13 / B-10, PIPEDA, and governing an AI feature under the same regime  |
| [Configuration](https://arashm0z.github.io/auth-api/docs/CONFIGURATION/)           | Every environment variable, secrets vs config, the checkov-skip rationale           |
| [AI workflow](https://arashm0z.github.io/auth-api/docs/AI_WORKFLOW/)               | How AI was used — and why the judgment stayed human                                 |
| [Roadmap & technical debt](https://arashm0z.github.io/auth-api/docs/roadmap/)      | Every accepted trade-off, deferred decision, and pre-production task — named openly |
| [Decisions (ADRs)](https://arashm0z.github.io/auth-api/docs/adr/)                  | The eight architecture decision records                                             |

The full threat model, SOC 2-style control mapping, residual risks, and the
pre-production roadmap live on the
[security model](https://arashm0z.github.io/auth-api/docs/security/) and
[roadmap](https://arashm0z.github.io/auth-api/docs/roadmap/) pages.

## CI/CD

Every push and PR runs the full gate — lint, typecheck, real-Redis tests,
coverage, Stryker mutation testing, `npm audit`, OpenAPI-drift, Spectral, and a
non-root image assertion — alongside **five security scanners** (CodeQL,
gitleaks, Trivy, dependency-review, checkov, all reporting SARIF to the Security
tab). The Terraform is `tofu test`/tflint/checkov-gated and **applied to
LocalStack** on infra changes. `main` requires **11 checks** with linear history
and admin enforcement. Full pipeline, drawn:
**[CI/CD diagram](https://arashm0z.github.io/auth-api/docs/diagrams/#12-cicd-pipeline)**.

## License

MIT
