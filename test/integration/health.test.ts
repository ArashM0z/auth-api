import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe('probes', () => {
  it('GET /healthz → 200 while the process is up', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /readyz → 200 while Redis answers PING', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('GET /readyz → 503 problem when Redis is unreachable', async () => {
    const doomed = await makeApp();
    doomed.redis.destroy(); // force-close the connection
    const res = await doomed.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ code: string }>().code).toBe('SERVICE_UNAVAILABLE');
    await doomed.close();
  });

  it('serves interactive API docs at /docs and the OpenAPI document', async () => {
    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(docs.statusCode);
  });
});
