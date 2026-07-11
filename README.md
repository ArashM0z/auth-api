# Authentication API

An internal REST service that **creates logins** and **verifies credentials** —
nothing more, by design. Built on **Node.js 24 LTS**, **TypeScript 6 (strict)**,
**Fastify 5**, and **Redis 8**, with **Argon2id** password storage.

Every error is an [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)
response, the OpenAPI contract is generated from the same schemas that validate
requests (CI fails on drift), and every security decision cites the standard it
implements (NIST SP 800-63B-4, OWASP, RFC 9110) rather than folklore.

## Live — nothing to install

Hosted on GitHub Pages:

- **[Playground](https://arashm0z.github.io/auth-api/playground.html)** — fire every case and watch the real client ⇄ app ⇄ Redis exchange
- **[API reference](https://arashm0z.github.io/auth-api/api.html)** — the OpenAPI contract, rendered with [Scalar](https://github.com/scalar/scalar)
- **[Rate-limiter demo](https://arashm0z.github.io/auth-api/ratelimit.html)** — the live per-username failure window
- **[Infrastructure tour](https://arashm0z.github.io/auth-api/)** — the Terraform stack applied on [LocalStack](https://localstack.cloud) ($0, re-applied in CI)
- **[Visual guide](https://arashm0z.github.io/auth-api/visual-guide.html)** — 13 diagrams, system context down to a single Redis command
- **[Architecture handbook](https://arashm0z.github.io/auth-api/docs/)** — the full arc42 documentation (searchable)

The landing is a typed **React + TypeScript** app ([`web/`](web/)); the handbook
is **MkDocs Material** ([`docs/`](docs/)). Both deploy from
[`docs.yml`](.github/workflows/docs.yml) on every change.

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

- Interactive docs (Scalar): **http://localhost:3000/docs** · contract: [`openapi.json`](openapi.json) · click-to-run: [`requests.http`](requests.http) · client types: [`client/api.d.ts`](client/api.d.ts)
- Hot reload: `docker compose -f compose.yaml -f compose.dev.yaml up --build` · native: `npm ci && npm run dev`

## API

| Endpoint                                   | Success                      | Failures                                                                     |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------- |
| `POST /v1/users` — create a login          | **201 Created** + `Location` | 400 validation · 409 taken · 422 policy · 415/413/429                        |
| `POST /v1/auth/login` — verify credentials | **200 OK**                   | **401** invalid credentials · 429 rate limited · 400/413/415 protocol errors |
| `GET /healthz` — liveness                  | 200                          | —                                                                            |
| `GET /readyz` — readiness (Redis PING)     | 200                          | 503                                                                          |

Creation returns **201** per RFC 9110, not a literal 200
([ADR-0004](docs/adr/0004-201-created-deviation.md)); login issues **no
token/session** by scope ([ADR-0005](docs/adr/0005-no-sessions-or-jwt.md)).
Usernames are case-insensitively unique and NFC-normalized; passwords follow
NIST SP 800-63B-4 (15+ code points, no composition rules, blocklist-screened,
reject-never-truncate — [ADR-0007](docs/adr/0007-nist-password-policy.md)).

## Highlights

- **Argon2id** at OWASP parameters, PHC strings, rehash-on-login ([ADR-0002](docs/adr/0002-argon2id-over-bcrypt.md))
- **Atomic uniqueness** via `SET NX` — the check-then-set race is structurally impossible; a test fires 8 concurrent registrations to prove it ([ADR-0003](docs/adr/0003-atomic-uniqueness-set-nx.md))
- **Timing-safe login** — wrong-password and unknown-user are byte-identical in body, headers, **and timing** ([security model](docs/security.md))
- **Two Redis-backed rate limits**, correct across replicas; the login gate is an atomic `INCR` _before_ the hash — the TOCTOU fix an adversarial review surfaced ([ADR-0008](docs/adr/0008-custom-redis-rate-limiter.md))
- **RFC 9457** errors everywhere; response-schema whitelisting means a password hash cannot leak into a response ([ADR-0006](docs/adr/0006-rfc9457-problem-details.md))
- **Observability** — always-on Prometheus metrics + opt-in OpenTelemetry; Argon2id queue-depth gauges are the scale-out signal ([runbook](docs/OPERATIONS.md))
- **86 tests, ~97% coverage**, five layers + Stryker mutation testing (87%, gated at 80%) ([testing arsenal](https://arashm0z.github.io/auth-api/docs/#the-testing-verification-arsenal))
- **Hardened AWS IaC** (OpenTofu) — customer-managed KMS everywhere, WAF-fronted ALB, VPC flow logs; applied end-to-end on LocalStack in CI, never on billable AWS ([infra/](infra/README.md))
- **dev → staging → prod** promotion pipeline — one immutable image, OIDC (no stored keys), production behind a required-reviewer gate ([deployment](docs/DEPLOYMENT.md))

## Documentation

The searchable **[architecture handbook](https://arashm0z.github.io/auth-api/docs/)**
(arc42) is the canonical reference; its source is in [`docs/`](docs/):

| Page                                             | Covers                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [Design rationale](docs/design-rationale.md)     | Every major decision: decision → forces → rationale → alternatives → consequences  |
| [Architecture (arc42)](docs/architecture.md)     | Context, building blocks, runtime view, deployment, cross-cutting concepts         |
| [Diagrams](docs/diagrams.md)                     | 13 Mermaid diagrams, system context down to a single Redis command                 |
| [Security model](docs/security.md)               | Threat model, the timing-safe login flow, honestly-named residual risks            |
| [Operations (runbook)](docs/OPERATIONS.md)       | Probes, metrics with alert conditions, failure modes, the performance envelope     |
| [Deployment](docs/DEPLOYMENT.md)                 | dev → staging → prod promotion, OIDC, environment approval gates                   |
| [Compliance & AI governance](docs/COMPLIANCE.md) | OSFI E-23 / B-13 / B-10, PIPEDA, and governing an AI feature under the same regime |
| [Configuration](docs/CONFIGURATION.md)           | Every environment variable, secrets vs config, the checkov-skip rationale          |
| [AI workflow](docs/AI_WORKFLOW.md)               | How AI was used — and why the judgment stayed human                                |
| [Decisions (ADRs)](docs/adr/)                    | The eight architecture decision records                                            |

Also: **[SECURITY.md](SECURITY.md)** (full threat table + SOC 2 mapping) ·
**[infra/README.md](infra/README.md)** (the AWS stack) ·
**[CONTRIBUTING.md](CONTRIBUTING.md)**.

## CI/CD at a glance

Every push and PR runs [`ci.yml`](.github/workflows/ci.yml) (lint → typecheck →
real-Redis tests → coverage → mutation → audit → OpenAPI-drift → Spectral →
non-root image), [`security.yml`](.github/workflows/security.yml) (gitleaks ·
Trivy · dependency-review · checkov, all SARIF to the Security tab),
[`codeql.yml`](.github/workflows/codeql.yml), and
[`iac.yml`](.github/workflows/iac.yml) (`tofu test` · tflint · checkov).
[`localstack.yml`](.github/workflows/localstack.yml) applies the full stack to
LocalStack on infra changes. `main` requires **11 checks**; details and diagrams
in the [handbook](https://arashm0z.github.io/auth-api/docs/diagrams/#12-cicd-pipeline).

## License

MIT
