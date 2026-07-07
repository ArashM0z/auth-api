import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUser, login, makeApp } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.redis.flushDb();
});

describe('GET /metrics (Prometheus)', () => {
  it('exposes Prometheus metrics, exempt from rate limiting', async () => {
    const limited = await makeApp({ RATE_LIMIT_IP_MAX: '1' });
    try {
      await limited.redis.flushDb();
      // Exhaust the IP window, then confirm /metrics still answers.
      await limited.inject({ method: 'GET', url: '/v1/nope' });
      const res = await limited.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toContain('authapi_');
    } finally {
      await limited.close();
    }
  });

  it('counts users created, auth outcomes, and queue gauges', async () => {
    await createUser(app, 'realuser');
    await login(app, 'realuser');
    await login(app, 'realuser', 'wrong passphrase here ok');

    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(body).toContain('authapi_users_created_total');
    expect(body).toMatch(/authapi_auth_attempts_total\{outcome="success"\} [1-9]/);
    expect(body).toMatch(/authapi_auth_attempts_total\{outcome="invalid"\} [1-9]/);
    expect(body).toContain('authapi_hash_active');
    expect(body).toContain('authapi_hash_queued');
  });
});
