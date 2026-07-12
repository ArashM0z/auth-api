import { randomUUID } from 'node:crypto';
import fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import swagger from '@fastify/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';
import type { AppConfig } from './config.js';
import { connectRedis } from './plugins/redis.js';
import type { AppRedis } from './plugins/redis.js';
import { RedisRateLimiter, rateLimitHeaders } from './plugins/rate-limit.js';
import type { WindowPolicy } from './plugins/rate-limit.js';
import { PasswordHasher } from './domain/password-hasher.js';
import { UserService } from './services/user-service.js';
import { PROBLEM_CONTENT_TYPE, ProblemError, problemBody } from './problems.js';
import type { FieldError } from './problems.js';
import { createMetrics, registerHashQueueGauge } from './observability/metrics.js';
import type { Metrics } from './observability/metrics.js';
import { registerUserRoutes } from './routes/users.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetricsRoute } from './routes/metrics.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Health probes opt out of IP rate limiting. */
    skipIpRateLimit?: boolean;
  }
}

export interface BuildOverrides {
  /** Inject a Redis client (tests, spec generation); skips connecting. */
  redis?: AppRedis;
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: Metrics;
  }
}

/** Static route/method map so unmatched methods get a correct 405 + Allow. */
const KNOWN_ROUTES: Readonly<Record<string, readonly string[]>> = {
  '/v1/users': ['POST'],
  '/v1/auth/login': ['POST'],
  '/healthz': ['GET', 'HEAD'],
  '/readyz': ['GET', 'HEAD'],
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export async function buildApp(
  config: AppConfig,
  overrides: BuildOverrides = {},
): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: config.logLevel,
      // Bodies aren't logged, but redact password fields anyway in case a
      // log line ever includes one.
      redact: {
        paths: ['password', '*.password', '*.*.password'],
        censor: '[REDACTED]',
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
    genReqId: (raw) => {
      // Use the caller's correlation id if it's well-formed, otherwise
      // mint one. Echoed back on every response as X-Request-Id.
      const header = raw.headers['x-request-id'];
      return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
    },
    ajv: {
      customOptions: {
        // Fastify's defaults coerce types and strip unknown fields. For a
        // security API we want the opposite: wrong types are errors and
        // unknown fields get rejected (additionalProperties: false) rather
        // than silently dropped.
        coerceTypes: false,
        removeAdditional: false,
        allErrors: true,
      },
    },
  });

  // JSON-only API. Fastify ships a built-in text/plain parser; with it, a
  // text body parses and then fails schema validation as a 400. Removing it
  // makes any non-JSON Content-Type a proper 415.
  app.removeContentTypeParser('text/plain');

  // ---- security & resilience -------------------------------------------
  await app.register(helmet, {
    // The API serves only JSON, so a CSP buys it nothing, and it would break
    // the self-hosted Scalar reference at /docs. Deliberate tradeoff.
    contentSecurityPolicy: false,
  });

  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxEventLoopUtilization: 0.98,
    pressureHandler: (request, reply, type, value) => {
      request.log.warn({ type, value }, 'load shedding');
      void reply
        .code(503)
        .header('retry-after', '10')
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problemBody('SERVICE_UNAVAILABLE', request, {
            detail: 'Server is shedding load; retry shortly.',
          }),
        );
    },
  });

  // ---- OpenAPI ----------------------------------------------------------
  await app.register(swagger, {
    openapi: {
      // 3.0.3 is the output level @fastify/swagger officially documents.
      openapi: '3.0.3',
      info: {
        title: 'Authentication API',
        description: [
          'Internal service for other backend systems to **create logins** and **verify credentials**. No tokens are issued — login only confirms a username/password pair.',
          '',
          '- **Errors** use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) (`application/problem+json`) with a stable machine-readable `code` and a `requestId` for correlation.',
          '- **Passwords** follow NIST SP 800-63B-4 (min 15 chars, common-password blocklist, no composition rules) and are stored with Argon2id.',
          '- **Failed logins** are rate-limited per username, and a wrong password is indistinguishable from an unknown user — same status, body, and timing.',
        ].join('\n'),
        version: '1.0.1', // x-release-please-version
      },
      servers: [{ url: 'http://localhost:3000', description: 'local' }],
      tags: [
        {
          name: 'Users',
          description: 'Create a login with a unique username and a policy-checked password.',
        },
        {
          name: 'Authentication',
          description:
            'Verify a username/password pair. Returns 200 on success or an identical 401 otherwise — no token is issued.',
        },
        {
          name: 'Operations',
          description:
            'Liveness, readiness, and Prometheus metrics for orchestrators and monitoring.',
        },
      ],
    },
  });
  // Scalar renders the same OpenAPI document as a searchable API reference
  // with a built-in request playground (a Swagger UI successor).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Scalar's plugin export is loosely typed
  await app.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: { title: 'Authentication API', content: () => app.swagger() },
  });

  // ---- dependencies ------------------------------------------------------
  const redis = overrides.redis ?? (await connectRedis(app, config.redisUrl));
  app.decorate('redis', redis);

  const hasher = new PasswordHasher(config.hash);
  await hasher.init();
  const limiter = new RedisRateLimiter(redis);
  const users = new UserService(redis, hasher);

  const metrics = createMetrics();
  registerHashQueueGauge(metrics, hasher);
  app.decorate('metrics', metrics);

  // ---- correlation id + per-IP rate limit --------------------------------
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    // routeOptions.url is the template ("/v1/users"), not the raw path with
    // its variable segments, so metric cardinality stays bounded.
    const route = request.routeOptions.url ?? 'unmatched';
    metrics.httpRequests.inc({
      method: request.method,
      route,
      status: reply.statusCode,
    });
  });

  const ipPolicy: WindowPolicy = {
    name: 'ip',
    max: config.rateLimit.ipMax,
    windowSeconds: config.rateLimit.ipWindowSeconds,
  };
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.config.skipIpRateLimit === true) return;
    const state = await limiter.hit(ipPolicy, request.ip);
    if (!state.allowed) {
      request.log.warn({ ip: request.ip }, 'ip rate limited');
      metrics.rateLimited.inc({ scope: 'ip' });
      return reply
        .code(429)
        .headers({
          ...rateLimitHeaders(ipPolicy, state),
          'retry-after': String(state.resetSeconds),
        })
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problemBody('RATE_LIMITED', request, {
            detail: 'Too many requests from this address.',
          }),
        );
    }
  });

  // ---- uniform RFC 9457 error surface ------------------------------------
  app.setErrorHandler((error: FastifyError | ProblemError, request, reply) => {
    if (error instanceof ProblemError) {
      if (error.headers !== undefined) reply.headers(error.headers);
      return reply
        .code(error.status)
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problemBody(error.code, request, {
            ...(error.detail !== undefined ? { detail: error.detail } : {}),
            ...(error.errors !== undefined ? { errors: error.errors } : {}),
          }),
        );
    }

    const fastifyError = error;
    if (fastifyError.validation !== undefined) {
      const errors: FieldError[] = fastifyError.validation.map((v) => {
        const params = v.params as { missingProperty?: string };
        const field =
          v.instancePath.length > 1 ? v.instancePath.slice(1) : (params.missingProperty ?? 'body');
        return { field, rule: v.keyword, message: v.message ?? 'is invalid' };
      });
      return reply
        .code(400)
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problemBody('VALIDATION_ERROR', request, {
            detail: 'Request body failed schema validation.',
            errors,
          }),
        );
    }

    switch (fastifyError.code) {
      case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
        return reply
          .code(415)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            problemBody('UNSUPPORTED_MEDIA_TYPE', request, {
              detail: 'Content-Type must be application/json.',
            }),
          );
      case 'FST_ERR_CTP_BODY_TOO_LARGE':
        return reply
          .code(413)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            problemBody('PAYLOAD_TOO_LARGE', request, {
              detail: 'Request body exceeds the 16 KiB limit.',
            }),
          );
      default:
        break;
    }

    if (fastifyError.statusCode === 400) {
      return reply
        .code(400)
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problemBody('MALFORMED_BODY', request, {
            detail: 'Request body must be valid JSON.',
          }),
        );
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .type(PROBLEM_CONTENT_TYPE)
      .send(
        problemBody('INTERNAL_ERROR', request, {
          detail: 'An unexpected error occurred.',
        }),
      );
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    const allowed = KNOWN_ROUTES[path];
    if (allowed !== undefined && !allowed.includes(request.method)) {
      return reply
        .code(405)
        .header('allow', allowed.join(', '))
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          problemBody('METHOD_NOT_ALLOWED', request, {
            detail: `This resource supports: ${allowed.join(', ')}.`,
          }),
        );
    }
    return reply
      .code(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send(problemBody('NOT_FOUND', request, { detail: 'No resource at this path.' }));
  });

  // ---- routes -------------------------------------------------------------
  registerHealthRoutes(app, redis);
  registerMetricsRoute(app, metrics);
  registerUserRoutes(app, { users, config, metrics });
  registerAuthRoutes(app, { users, hasher, limiter, config, metrics });

  return app;
}
