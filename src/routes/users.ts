import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { AppConfig } from '../config.js';
import type { UserService } from '../services/user-service.js';
import { normalizeUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '../domain/username.js';
import { validatePassword } from '../domain/password-policy.js';
import { ProblemError } from '../problems.js';
import { ProblemSchema } from '../schemas.js';
import { audit } from '../audit.js';
import type { Metrics } from '../observability/metrics.js';

const CreateUserBody = Type.Object(
  {
    username: Type.String({
      minLength: USERNAME_MIN_LENGTH,
      maxLength: USERNAME_MAX_LENGTH,
      // Syntactic gate only; full normalization (NFC, case) happens in the handler.
      pattern: '^[A-Za-z0-9._-]+$',
      description: `${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} chars; letters, digits, ".", "_", "-". Case-insensitively unique.`,
    }),
    password: Type.String({
      minLength: 1,
      maxLength: 4096,
      description:
        'Checked against the password policy (NIST SP 800-63B-4): length + common-password blocklist; no composition rules.',
    }),
  },
  { additionalProperties: false },
);

const CreateUserReply = Type.Object(
  {
    user: Type.Object(
      {
        username: Type.String(),
        createdAt: Type.String({ description: 'RFC 3339 UTC timestamp' }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export interface UserRouteDeps {
  readonly users: UserService;
  readonly config: AppConfig;
  readonly metrics: Metrics;
}

export function registerUserRoutes(instance: FastifyInstance, deps: UserRouteDeps): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    '/v1/users',
    {
      schema: {
        operationId: 'createUser',
        tags: ['Users'],
        summary: 'Create a new login',
        description:
          'Creates a user with a unique (case-insensitive) username. Uniqueness is enforced atomically in Redis (SET NX) — concurrent duplicate registrations cannot race.',
        body: CreateUserBody,
        response: {
          201: CreateUserReply,
          400: ProblemSchema,
          409: ProblemSchema,
          413: ProblemSchema,
          415: ProblemSchema,
          422: ProblemSchema,
          429: ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const { username: rawUsername, password } = request.body;

      const username = normalizeUsername(rawUsername);
      if (!username.ok) {
        throw new ProblemError('INVALID_USERNAME', {
          detail: `Username ${username.reason}.`,
          errors: [{ field: 'username', rule: 'format', message: username.reason }],
        });
      }

      const violations = validatePassword(password, {
        minLength: deps.config.password.minLength,
        maxLength: deps.config.password.maxLength,
        username: username.value,
      });
      if (violations.length > 0) {
        throw new ProblemError('WEAK_PASSWORD', {
          detail: 'The supplied password does not meet the password policy.',
          errors: violations.map((v) => ({ field: 'password', rule: v.rule, message: v.message })),
        });
      }

      const result = await deps.users.create(username.value, password);
      if (!result.created) {
        audit(request.log, 'user.create_conflict', { username: username.value, ip: request.ip });
        throw new ProblemError('USERNAME_TAKEN', {
          detail: 'A user with this username already exists.',
        });
      }

      deps.metrics.usersCreated.inc();
      audit(request.log, 'user.created', { username: username.value, ip: request.ip });
      return reply
        .code(201)
        .header('location', `/v1/users/${username.value}`)
        .send({ user: result.user });
    },
  );
}
