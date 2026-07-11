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

  it('ships the default Node/process metrics under the authapi_ prefix', async () => {
    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(body).toContain('authapi_process_cpu_user_seconds_total');
    expect(body).toContain('authapi_nodejs_eventloop_lag_seconds');
  });

  it('labels http requests with the route template, not the raw path (bounded cardinality)', async () => {
    await createUser(app, 'realuser');
    const body = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(body).toMatch(/authapi_http_requests_total\{[^}]*route="\/v1\/users"[^}]*\} [1-9]/);
    expect(body).not.toContain('route="/v1/users/realuser"');
  });

  it('counts rate-limit rejections by scope: username', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN_FAILURES_MAX: '1' });
    try {
      await limited.redis.flushDb();
      await createUser(limited, 'realuser');
      await login(limited, 'realuser', 'wrong passphrase here ok'); // consumes the window
      const blocked = await login(limited, 'realuser', 'wrong passphrase here ok');
      expect(blocked.statusCode).toBe(429);

      const body = (await limited.inject({ method: 'GET', url: '/metrics' })).body;
      expect(body).toMatch(/authapi_rate_limited_total\{scope="username"\} [1-9]/);
      expect(body).toMatch(/authapi_auth_attempts_total\{outcome="rate_limited"\} [1-9]/);
    } finally {
      await limited.close();
    }
  });

  it('counts rate-limit rejections by scope: ip', async () => {
    const limited = await makeApp({ RATE_LIMIT_IP_MAX: '1' });
    try {
      await limited.redis.flushDb();
      await limited.inject({ method: 'GET', url: '/v1/nope' }); // consumes the window
      const blocked = await limited.inject({ method: 'GET', url: '/v1/nope' });
      expect(blocked.statusCode).toBe(429);

      const body = (await limited.inject({ method: 'GET', url: '/metrics' })).body;
      expect(body).toMatch(/authapi_rate_limited_total\{scope="ip"\} [1-9]/);
    } finally {
      await limited.close();
    }
  });

  it('counts transparent password rehashes', async () => {
    // Create under the suite's weaker Argon2id parameters, then log in on an
    // app with a stronger policy sharing the same Redis: the stored hash
    // upgrades and the upgrade is visible as a metric.
    await createUser(app, 'realuser'); // helpers default: 8 MiB
    const stronger = await makeApp({ HASH_MEMORY_KIB: '16384' });
    try {
      const res = await login(stronger, 'realuser');
      expect(res.statusCode).toBe(200);

      const body = (await stronger.inject({ method: 'GET', url: '/metrics' })).body;
      expect(body).toMatch(/authapi_password_rehashes_total [1-9]/);
    } finally {
      await stronger.close();
    }
  });
});
