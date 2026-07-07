/**
 * OpenTelemetry tracing — opt-in and side-effect-free unless configured.
 * Enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set (or OTEL_ENABLED=true), so
 * `docker compose up` and the test suite need no collector. Import and call
 * startTracing() FIRST in the process entrypoint, before the app is built.
 *
 * Fastify spans come from @fastify/otel (registerOnInitialization patches
 * every Fastify instance once the SDK starts) — no ESM loader flag required.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { FastifyOtelInstrumentation } from '@fastify/otel';

export function startTracing(env: NodeJS.ProcessEnv = process.env): NodeSDK | undefined {
  const enabled = env.OTEL_ENABLED === 'true' || env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined;
  if (!enabled) return undefined;

  const fastifyInstrumentation = new FastifyOtelInstrumentation({
    registerOnInitialization: true,
    // Health/metrics probes generate no spans — keep traces signal-heavy.
    ignorePaths: (route) => ['/healthz', '/readyz', '/metrics'].includes(route.url),
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'auth-api',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    // Exporter reads OTEL_EXPORTER_OTLP_ENDPOINT / headers from the env.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [fastifyInstrumentation],
  });

  sdk.start();
  return sdk;
}
