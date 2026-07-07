import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { AppConfig } from '../config.js';
import type { UserService } from '../services/user-service.js';
import type { PasswordHasher } from '../domain/password-hasher.js';
import { RedisRateLimiter, rateLimitHeaders } from '../plugins/rate-limit.js';
import type { WindowPolicy } from '../plugins/rate-limit.js';
import { normalizeUsername } from '../domain/username.js';
import { ProblemError } from '../problems.js';
import { ProblemSchema } from '../schemas.js';
import { audit } from '../audit.js';
import type { Metrics } from '../observability/metrics.js';

/**
 * The login schema is deliberately loose (any non-empty strings). A malformed
 * username can't exist, so it has to produce the same 401 as a wrong password;
 * a 400 here would be an account-enumeration oracle.
 */
const LoginBody = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 256 }),
    password: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

const LoginReply = Type.Object(
  {
    authenticated: Type.Literal(true),
    user: Type.Object({ username: Type.String() }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

export interface AuthRouteDeps {
  readonly users: UserService;
  readonly hasher: PasswordHasher;
  readonly limiter: RedisRateLimiter;
  readonly config: AppConfig;
  readonly metrics: Metrics;
}

export function registerAuthRoutes(instance: FastifyInstance, deps: AuthRouteDeps): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();

  const failurePolicy: WindowPolicy = {
    name: 'login-failures',
    max: deps.config.rateLimit.loginFailuresMax,
    windowSeconds: deps.config.rateLimit.loginFailuresWindowSeconds,
  };

  app.post(
    '/v1/auth/login',
    {
      schema: {
        operationId: 'login',
        tags: ['Authentication'],
        summary: 'Verify a username/password pair',
        description:
          'Returns 200 when the credentials are valid and 401 otherwise. Unknown-username and wrong-password failures are indistinguishable by response AND by timing (dummy Argon2id verification). Failed attempts are rate limited per username; the counter clears on success.',
        body: LoginBody,
        response: {
          200: LoginReply,
          400: ProblemSchema,
          401: ProblemSchema,
          413: ProblemSchema,
          415: ProblemSchema,
          429: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const { username: rawUsername, password } = request.body;
      const normalized = normalizeUsername(rawUsername);
      // Rate-limit failures for any submitted username string, real or not,
      // so the limiter can't be used to probe which usernames exist.
      const subject = normalized.ok
        ? normalized.value
        : rawUsername.normalize('NFC').trim().toLowerCase().slice(0, 64);

      // Consume one slot from the failure window before the expensive
      // Argon2id verify. A read-only check here would be a TOCTOU race: a
      // concurrent burst of guesses could all see count<max and slip past the
      // cap while their verifies run. Redis INCR serializes them, so at most
      // `max` guesses per window reach verification. The window clears on
      // success, so legitimate users aren't affected.
      const gate = await deps.limiter.hit(failurePolicy, subject);
      if (!gate.allowed) {
        deps.metrics.rateLimited.inc({ scope: 'username' });
        deps.metrics.authAttempts.inc({ outcome: 'rate_limited' });
        audit(request.log, 'auth.rate_limited', { username: subject, ip: request.ip });
        throw new ProblemError('RATE_LIMITED', {
          detail: 'Too many failed attempts for this account. Retry later.',
          headers: {
            ...rateLimitHeaders(failurePolicy, gate),
            'retry-after': String(gate.resetSeconds),
          },
        });
      }

      let verifiedUsername: string | undefined;
      if (normalized.ok) {
        const result = await deps.users.verifyCredentials(normalized.value, password);
        if (result.ok) {
          verifiedUsername = result.username;
          if (result.rehashed) {
            deps.metrics.passwordRehashes.inc();
            audit(request.log, 'user.password_rehashed', { username: result.username });
          }
        }
      } else {
        // Invalid-format usernames burn the same Argon2id cost as real ones.
        await deps.hasher.burnDummyVerify(password);
      }

      if (verifiedUsername === undefined) {
        // The slot was already consumed at the gate above, so don't double-count.
        deps.metrics.authAttempts.inc({ outcome: 'invalid' });
        audit(request.log, 'auth.failure', { username: subject, ip: request.ip });
        throw new ProblemError('INVALID_CREDENTIALS', {
          detail: 'Username or password is incorrect.',
          headers: rateLimitHeaders(failurePolicy, gate),
        });
      }

      await deps.limiter.clear(failurePolicy, subject);
      deps.metrics.authAttempts.inc({ outcome: 'success' });
      audit(request.log, 'auth.success', { username: verifiedUsername, ip: request.ip });
      return reply
        .code(200)
        .send({ authenticated: true as const, user: { username: verifiedUsername } });
    },
  );
}
