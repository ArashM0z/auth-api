import type { FastifyInstance } from 'fastify';
import type { Metrics } from '../observability/metrics.js';

/**
 * Prometheus scrape endpoint. Unversioned (an ops contract, like the health
 * probes) and exempt from IP rate limiting so a scrape cadence doesn't trip
 * the limiter. In production, keep this reachable only from the internal
 * metrics network, never on the public listener.
 */
export function registerMetricsRoute(app: FastifyInstance, metrics: Metrics): void {
  app.get(
    '/metrics',
    { schema: { hide: true }, config: { skipIpRateLimit: true } },
    async (_req, reply) => {
      reply.type(metrics.registry.contentType);
      return metrics.registry.metrics();
    },
  );
}
