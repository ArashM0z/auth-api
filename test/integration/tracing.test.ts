/**
 * OpenTelemetry tracing, end to end: the README claims tracing is dormant
 * unless configured, and that when enabled every request becomes a span —
 * except the health/metrics probes. This suite proves all three against a
 * real in-test OTLP receiver (no mocks of the SDK).
 *
 * Runs in its own file so the SDK's Fastify instrumentation (which patches
 * instances created after sdk.start()) cannot leak into other suites —
 * vitest isolates test files per worker.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { startTracing } from '../../src/observability/tracing.js';
import { createUser, login, makeApp } from './helpers.js';

describe('startTracing() opt-in behavior', () => {
  it('is dormant when no OTEL configuration is present', () => {
    expect(startTracing({})).toBeUndefined();
    expect(startTracing({ SOME_OTHER_VAR: 'x' })).toBeUndefined();
  });
});

describe('tracing enabled (real OTLP export)', () => {
  let collector: Server;
  let received: Buffer[];
  let sdk: NodeSDK | undefined;
  let app: FastifyInstance;

  beforeAll(async () => {
    // A minimal OTLP/HTTP receiver: accept POST /v1/traces, record the body.
    received = [];
    collector = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        if (req.url === '/v1/traces' && req.method === 'POST') {
          received.push(Buffer.concat(chunks));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    collector.listen(0, '127.0.0.1');
    await once(collector, 'listening');
    const address = collector.address();
    if (address === null || typeof address === 'string') throw new Error('no port');

    // Start the SDK exactly as server.ts does — before the app is built, so
    // @fastify/otel instruments the instance on creation. The env argument
    // gates enablement; the exporter itself reads process.env (as in
    // production), so the endpoint must live there.
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${String(address.port)}`;
    sdk = startTracing(process.env);
    expect(sdk).toBeDefined();

    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
    await sdk?.shutdown(); // flushes the batch processor
    collector.close();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it('exports spans for API requests but not for the probe endpoints', async () => {
    await createUser(app, 'realuser');
    await login(app, 'realuser');
    await app.inject({ method: 'GET', url: '/healthz' });
    await app.inject({ method: 'GET', url: '/readyz' });
    await app.inject({ method: 'GET', url: '/metrics' });

    // Shutdown flushes pending spans to the collector.
    await sdk?.shutdown();
    sdk = undefined;

    expect(received.length).toBeGreaterThan(0);
    // Assert on the raw payload text: route strings appear verbatim in both
    // the JSON and protobuf OTLP encodings, so this holds regardless of the
    // exporter's wire format.
    const payload = Buffer.concat(received).toString('utf8');
    expect(payload).toContain('/v1/users');
    expect(payload).toContain('/v1/auth/login');
    expect(payload).not.toContain('/healthz');
    expect(payload).not.toContain('/readyz');
    expect(payload).not.toContain('/metrics');
  });
});
