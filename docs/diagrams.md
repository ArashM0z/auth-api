# Diagrams

The whole service, drawn. These render live (Mermaid) and are the same source you
can point at in a walkthrough. For a hand-tuned interactive version, see the
companion visual guide linked from the README.

## 1. System context

Where the service sits: internal callers in, Redis + logs + orchestrator around
it. No browsers — so no CORS, no cookies.

```mermaid
flowchart LR
  subgraph consumers [Internal services]
    S1[Gateway / BFF]
    S2[Back-office jobs]
  end
  A[Authentication API<br/>Fastify 5 · stateless · N replicas]
  R[(Redis 8<br/>users + rate windows<br/>AOF everysec)]
  P[Orchestrator / LB]
  O[Log pipeline<br/>audit events]
  S1 -->|POST /v1/users, /v1/auth/login| A
  S2 --> A
  A -->|SET NX · GET · INCR| R
  P -.probes.-> A
  A -.structured logs.-> O
```

## 2. Boot & wiring order

Config fails fast; the hasher precomputes the dummy hash **before** any request
can arrive, so the very first login is already timing-safe.

```mermaid
flowchart LR
  C[loadConfig<br/>validate env] --> S[helmet + under-pressure] --> D[swagger + Scalar]
  D --> R[connectRedis] --> H[hasher.init<br/>precompute dummy hash] --> W[hooks + error handlers + routes]
```

## 3. Request lifecycle (Fastify hooks)

Cross-cutting concerns are hooks, not per-route code, so they can't be forgotten.

```mermaid
flowchart TD
  A[onRequest: per-IP rate limit] --> B[content-type check<br/>415 / 413]
  B --> C[AJV schema validate<br/>no coercion, no extra fields → 400]
  C --> D[route handler<br/>may throw ProblemError]
  D --> E[onSend: X-Request-Id]
  E --> F[onResponse: metrics by template route]
  D -.throws.-> G[setErrorHandler → RFC 9457 problem+json]
```

## 4. Create-user flow

Uniqueness is a single `SET NX`; a `nil` reply is the "already taken" verdict.

```mermaid
flowchart TD
  A[POST /v1/users] --> B{normalize username}
  B -->|invalid| E1[422 invalid-username]
  B -->|ok| C{password policy}
  C -->|violations| E2[422 weak-password<br/>all rules at once]
  C -->|ok| H[Argon2id hash<br/>before the write]
  H --> S[SET user:NAME json NX]
  S -->|reply ok| OK[201 Created + Location<br/>audit user.created]
  S -->|reply nil| CF[409 username-taken<br/>audit user.create_conflict]
```

## 5. Login — the timing-safe sequence ★

Unknown-user, wrong-password, and bad-format all cost the same and return the same
401. The gate increments **before** the hash (the TOCTOU fix).

```mermaid
sequenceDiagram
  participant C as Caller
  participant A as API
  participant R as Redis
  C->>A: POST /v1/auth/login
  A->>R: INCR failure window (atomic, before hash)
  alt window exhausted
    A-->>C: 429 + Retry-After
  else
    A->>R: GET user:NAME
    alt user exists
      A->>A: argon2id verify (19 MiB, t=2)
      opt params outdated
        A->>R: SET ... XX (rehash)
      end
    else user unknown / bad format
      A->>A: argon2id verify vs DUMMY (same cost)
    end
    alt verified
      A->>R: DEL failure window
      A-->>C: 200 authenticated
    else
      A-->>C: 401 (byte-identical for every failure)
    end
  end
```

## 6. Rate limiter & the TOCTOU fix

`INCR` first, then compare — Redis serializes the increments, so at most `max`
guesses ever reach the expensive verify.

```mermaid
flowchart TD
  H["hit(policy, subject)"] --> M[MULTI: INCR key · EXPIRE key NX · TTL key]
  M --> Q{count &le; max?}
  Q -->|yes| P[allowed → run Argon2id verify]
  Q -->|no| L[429 + RateLimit / Retry-After headers]
  P -->|login success| D["clear(): DEL key"]
```

## 7. Password hashing: the memory gate

Each in-flight hash reserves ~19 MiB; the gate caps that at `8 × 19 ≈ 152 MiB`.

```mermaid
flowchart LR
  N[N concurrent hash/verify] --> G[p-limit gate<br/>maxConcurrency = 8]
  G --> A[active &le; 8<br/>~152 MiB worst case]
  G --> Q[queued<br/>authapi_hash_queued → scale out]
```

## 8. Redis data model

Three key shapes — the entire persistent footprint.

```mermaid
flowchart LR
  U["user:NAME<br/>{username, passwordHash, createdAt}"]
  I["rl:ip:IP<br/>counter + TTL"]
  F["rl:login-failures:USER<br/>counter + TTL, cleared on success"]
```

## 9. Error model — one shape, every failure

Every non-2xx is `application/problem+json` with a stable `code` and `requestId`.

```mermaid
flowchart TD
  X[any non-2xx] --> P[problem+json<br/>type · title · status · code · requestId]
  P --> V[400 validation / malformed]
  P --> A[401 invalid-credentials — identical]
  P --> M[404 · 405 + Allow]
  P --> C[409 taken · 413 · 415 · 422]
  P --> R[429 + Retry-After · 500 · 503]
```

## 10. Component layers

HTTP knowledge stays at the top; the domain knows nothing about Fastify.

```mermaid
flowchart TD
  server[server.ts] --> app[app.ts<br/>hooks + error surface]
  app --> routes[routes/]
  routes --> svc[services/user-service]
  routes --> domain[domain/<br/>username · policy · hasher]
  svc --> plugins[plugins/<br/>redis · rate-limit]
  svc --> domain
```

## 11. Testing strategy

Wide base of fast tests; mutation testing on top checks the tests themselves.

```mermaid
flowchart TD
  U[Unit + Property / fast-check] --> I[Integration<br/>Testcontainers real redis:8]
  I --> S[Security attack-suite] --> C[Contract vs openapi.json]
  C --> M[Mutation testing / Stryker<br/>87%, gate 80%]
```

## 12. CI/CD pipeline

Every push runs the full gate; a red check blocks merge.

```mermaid
flowchart LR
  L[lint] --> T[typecheck] --> TE[test vs real Redis + coverage]
  TE --> AU[npm audit high+] --> OA[OpenAPI drift + Spectral] --> DK[docker build + non-root assert]
```

## 13. AWS infrastructure (OpenTofu)

Image from ECR, secrets from Secrets Manager, config from SSM — nothing sensitive
in plain env.

```mermaid
flowchart LR
  U[Internal callers] --> ALB[ALB HTTPS<br/>health → /readyz] --> ECS[ECS Fargate<br/>non-root tasks · autoscaling]
  ECS -->|rediss:// + AUTH| EC[(ElastiCache Redis<br/>encrypt at rest + transit)]
  ECR[ECR scan/immutable] -.image.-> ECS
  SM[Secrets Manager] -.redis token.-> ECS
  SSM[SSM Param Store] -.config.-> ECS
  ECS -.logs.-> CW[CloudWatch]
```
