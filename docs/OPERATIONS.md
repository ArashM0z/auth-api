# Operations (runbook)

What an on-call engineer needs: the probes, the signals, what to alert on,
and what to do when each failure mode shows up.

## Probes — what the orchestrator sees

| Endpoint       | Meaning                                         | Healthy    | Unhealthy                                          |
| -------------- | ----------------------------------------------- | ---------- | -------------------------------------------------- |
| `GET /healthz` | Liveness — the process can serve requests       | 200 always | no answer → restart the task                       |
| `GET /readyz`  | Readiness — Redis answers `PING` within **1 s** | 200        | 503 + `Retry-After: 5` → the LB stops routing here |

Liveness never checks dependencies (a Redis outage should not make the
orchestrator kill healthy processes); readiness does. Both are unversioned —
they're a contract with infrastructure, not with API consumers — and both are
exempt from IP rate limiting so a busy prober can't mark an instance dead.

## Metrics — `GET /metrics` (Prometheus)

Always on; scrape it from the internal network only. Domain signals on top of
the default Node/process metrics (all prefixed `authapi_`):

| Metric                                             | Type    | What it tells you                                                           |
| -------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `authapi_http_requests_total{method,route,status}` | counter | traffic + error rate; `route` is the template, so cardinality stays bounded |
| `authapi_auth_attempts_total{outcome}`             | counter | logins by `success` / `invalid` / `rate_limited`                            |
| `authapi_users_created_total`                      | counter | registration volume                                                         |
| `authapi_rate_limited_total{scope}`                | counter | rejections by `ip` vs `username`                                            |
| `authapi_password_rehashes_total`                  | counter | progress of a parameter migration                                           |
| `authapi_hash_active`                              | gauge   | Argon2id verifies executing now (≤ `HASH_MAX_CONCURRENCY`)                  |
| `authapi_hash_queued`                              | gauge   | verifies **waiting** for a slot — the scale-out signal                      |

### Alerts worth paging on

| Condition                                                                            | Why                                                                        | First response                                                                                          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `authapi_hash_queued > 0` sustained (minutes)                                        | logins are queueing behind the hash gate — users see latency before errors | add a replica (stateless tier), or raise `HASH_MAX_CONCURRENCY` if memory allows (~19 MiB/slot)         |
| `readyz` failing across instances                                                    | Redis unreachable — the datastore is down, not the app                     | check ElastiCache/Redis health; the app self-recovers when Redis returns                                |
| spike in `auth_attempts_total{outcome="rate_limited"}` or `audit: auth.rate_limited` | credential-stuffing / brute-force in progress                              | confirm limiter is absorbing it (it should); consider tightening `RATE_LIMIT_*` or blocking at the edge |
| 5xx rate > 0                                                                         | the API sanitizes all 500s — any volume is a bug                           | correlate `requestId` from the problem body to the logs                                                 |
| 503s from load shedding                                                              | event loop saturated (`under-pressure`: delay > 1 s or utilization > 0.98) | scale out; investigate what pinned the loop                                                             |

## Logs & audit trail

Structured JSON (pino). Every response carries `X-Request-Id`, which appears
in every log line and problem body — one id threads logs, metrics context,
and traces. Bodies are never logged; password paths are redacted as defense
in depth.

Audit events (`audit: true`, stable `event` names, never credentials):
`user.created` · `user.create_conflict` · `user.password_rehashed` ·
`auth.success` · `auth.failure` · `auth.rate_limited`. Ship them to the log
pipeline and you have the forensic record; alert on `auth.rate_limited`
spikes.

**Tracing** is opt-in: set `OTEL_EXPORTER_OTLP_ENDPOINT` (or
`OTEL_ENABLED=true`) and every request becomes a span via `@fastify/otel`;
health/metrics probes are excluded to keep traces signal-heavy.

## Failure modes & behavior

| Failure                          | Behavior (by design)                                                                                                              | Operator action                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Redis down                       | `readyz` → 503 within 1 s; LB drains the instance; in-flight requests error                                                       | restore Redis; nothing to do on the app side          |
| Login burst beyond hash capacity | requests queue at the `p-limit` gate (`hash_queued` rises), then latency; memory stays bounded (~`HASH_MAX_CONCURRENCY × 19 MiB`) | scale out before the queue grows                      |
| Event-loop overload              | `under-pressure` sheds load: 503 + `Retry-After: 10` — predictable failure instead of meltdown                                    | scale out; find the loop-blocker                      |
| Deploy / SIGTERM                 | `close-with-grace`: stops accepting, drains in-flight for up to **10 s**, then exits — zero-downtime behind a drained LB          | none; this is the happy path                          |
| Crash with AOF `everysec`        | ≤ ~1 s of writes lost (see the durability trade-off in the [security model](security.md))                                         | assess whether any registrations landed in the window |

## Performance envelope

Measured (see the [README](https://github.com/ArashM0z/auth-api#measured-performance)
for the method): login sustains ≈ **208 req/s** per instance — the deliberate
ceiling `HASH_MAX_CONCURRENCY ÷ verify-time ≈ 8 ÷ 0.037 s`, i.e. the security
budget, not a bottleneck — while `/healthz` clears ~25k req/s. Need more login
throughput? Add replicas (the tier is stateless; the Redis-backed limiter
stays correct at any count) or raise the hash concurrency at ~19 MiB a slot.

## Configuration

Everything is environment-driven and validated at boot — a bad value crashes
the process with the offending variable named. The full reference (names,
defaults, ranges, secrets-vs-config placement) is in
[Configuration](CONFIGURATION.md).
