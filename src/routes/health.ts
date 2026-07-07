import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { AppRedis } from '../plugins/redis.js';
import { PROBLEM_CONTENT_TYPE, problemBody } from '../problems.js';
import { ProblemSchema } from '../schemas.js';

const OkReply = Type.Object({ status: Type.Literal('ok') }, { additionalProperties: false });
const ReadyReply = Type.Object({ status: Type.Literal('ready') }, { additionalProperties: false });

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out after ${ms}ms`));
      }, ms);
      timer.unref();
    }),
  ]);
}

/**
 * Unversioned by design. Probe paths are a contract with infrastructure
 * (load balancers, orchestrators), not with API consumers, and the two
 * evolve independently. Excluded from IP rate limiting so a busy prober
 * can't mark a healthy instance dead.
 */
export function registerHealthRoutes(instance: FastifyInstance, redis: AppRedis): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/healthz',
    {
      schema: {
        operationId: 'liveness',
        tags: ['ops'],
        summary: 'Liveness probe (process is up)',
        description:
          'Always 200 while the process can serve requests. Used by orchestrators to decide restarts; does not check dependencies.',
        response: { 200: OkReply },
      },
      config: { skipIpRateLimit: true },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/readyz',
    {
      schema: {
        operationId: 'readiness',
        tags: ['ops'],
        summary: 'Readiness probe (Redis reachable)',
        description:
          '200 while Redis answers PING within 1s, 503 otherwise. Used by load balancers to stop routing to an instance that lost its datastore.',
        response: { 200: ReadyReply, 503: ProblemSchema },
      },
      config: { skipIpRateLimit: true },
    },
    async (request, reply) => {
      try {
        await withTimeout(redis.ping(), 1000);
        return { status: 'ready' as const };
      } catch {
        return reply
          .code(503)
          .header('retry-after', '5')
          .type(PROBLEM_CONTENT_TYPE)
          .send(problemBody('SERVICE_UNAVAILABLE', request, { detail: 'Redis is unreachable.' }));
      }
    },
  );
}
