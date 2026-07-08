## What & why

<!-- What does this change do, and why? Link the issue it closes, if any. -->

## How it was verified

- [ ] `npm run lint` + `npm run typecheck` clean
- [ ] `npm test` (unit + property + integration vs real Redis) green
- [ ] Added/updated tests for the behaviour changed
- [ ] `npm run openapi:generate` re-run if the API surface changed
- [ ] `infra/` changes pass `tofu fmt/validate`, `tflint`, `checkov` (if touched)

## Risk & rollout

<!-- Behavioural changes, migrations, config, or ordering to be aware of. -->

## Checklist

- [ ] Errors stay RFC 9457 (`application/problem+json`); no secrets in logs or responses
- [ ] No new lint/type warnings; no coverage regression below thresholds
- [ ] ADR added/updated if a design decision changed
