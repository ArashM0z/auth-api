# Contributing

Thanks for taking a look. This repo optimises for a reviewable, verifiable
history — small commits, green checks, and decisions written down.

## Local setup

```bash
docker compose up --build         # API on :3000, Redis with AOF durability
# or, hot-reload dev:
docker compose -f compose.yaml -f compose.dev.yaml up --build
# or natively (Node >= 24):
npm ci && npm run dev
```

## Before you open a PR

```bash
npm run lint          # eslint + prettier
npm run typecheck     # tsc --noEmit (strict)
npm test              # unit + property + integration vs a real Redis (testcontainers)
npm run openapi:generate   # only if you changed the API surface
```

- **Tests are required.** Unit tests are pure; integration tests run against a
  real Redis container. Coverage thresholds (85% lines/statements/functions,
  80% branches) are enforced, and `npm run test:mutation` guards test quality.
- **Types are strict.** No `any` escapes, no coercion — wrong types are errors.
- **Errors are RFC 9457.** Every non-2xx is `application/problem+json` with a
  stable `code`; never leak secrets, hashes, or stack traces.

## Commits & PRs

- Branch off `main`; keep commits small and focused.
- **Conventional Commits** for PR titles (a check enforces this):
  `feat(auth): …`, `fix(rate-limit): …`, `docs: …`, `chore(ci): …`.
- Every PR runs CI (lint/type/tests/mutation), CodeQL, dependency audit, a
  non-root image build, and — for `infra/**` — `tofu fmt/validate`, `tflint`,
  and `checkov`. All must pass before merge.
- If a design decision changes, add or update an ADR in [`docs/adr/`](docs/adr/).

## Security

Please report vulnerabilities privately via a
[security advisory](https://github.com/ArashM0z/auth-api/security/advisories/new),
never as a public issue. See [SECURITY.md](SECURITY.md).
