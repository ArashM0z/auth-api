import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { GOOD_PASSWORD, createUser, login, makeApp } from './helpers.js';

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

describe('POST /v1/auth/login', () => {
  it('valid credentials → 200 with the canonical username', async () => {
    await createUser(app, 'alice');
    const res = await login(app, 'alice');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true, user: { username: 'alice' } });
  });

  it('login is case-insensitive on username', async () => {
    await createUser(app, 'Bob');
    expect((await login(app, 'bOB')).statusCode).toBe(200);
  });

  it('wrong password → 401 problem with INVALID_CREDENTIALS', async () => {
    await createUser(app, 'alice');
    const res = await login(app, 'alice', 'wrong but long enough password');
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json<{ code: string }>().code).toBe('INVALID_CREDENTIALS');
  });

  it('unknown user and wrong password are INDISTINGUISHABLE (anti-enumeration)', async () => {
    await createUser(app, 'alice');
    const wrongPassword = await login(app, 'alice', 'wrong but long enough password');
    const unknownUser = await login(app, 'ghost-user', 'wrong but long enough password');

    expect(unknownUser.statusCode).toBe(wrongPassword.statusCode);
    const scrub = (raw: string) => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      delete body.requestId;
      return body;
    };
    expect(scrub(unknownUser.body)).toEqual(scrub(wrongPassword.body));
  });

  it('malformed usernames also get 401 (not 400 — no format oracle)', async () => {
    const res = await login(app, '!!definitely not a valid name!!', 'whatever password here');
    expect(res.statusCode).toBe(401);
  });

  it('emits draft RateLimit headers on failures', async () => {
    await createUser(app, 'alice');
    const res = await login(app, 'alice', 'wrong but long enough password');
    expect(res.headers.ratelimit).toMatch(/^"login-failures";r=\d+;t=\d+$/);
    expect(res.headers['ratelimit-policy']).toBe('"login-failures";q=10;w=900');
  });

  it('transparently upgrades hashes created with outdated parameters', async () => {
    // Seed a user whose hash predates the current memory-cost policy.
    const oldHash = await argon2.hash(GOOD_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    });
    await app.redis.set(
      'user:legacy',
      JSON.stringify({
        username: 'legacy',
        passwordHash: oldHash,
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
    );

    const res = await login(app, 'legacy');
    expect(res.statusCode).toBe(200);

    const stored = JSON.parse((await app.redis.get('user:legacy')) ?? '{}') as {
      passwordHash: string;
      passwordRehashedAt?: string;
    };
    expect(stored.passwordHash).toContain('m=8192'); // upgraded to current params
    expect(stored.passwordRehashedAt).toBeDefined();
    expect(await argon2.verify(stored.passwordHash, GOOD_PASSWORD)).toBe(true);
  });
});

describe('brute-force protection (per-username failure window)', () => {
  it('blocks after max failures with 429 + Retry-After, even for the right password', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN_FAILURES_MAX: '3' });
    try {
      await createUser(limited, 'alice');
      for (let i = 0; i < 3; i += 1) {
        const res = await login(limited, 'alice', 'wrong but long enough password');
        expect(res.statusCode).toBe(401);
      }
      const blocked = await login(limited, 'alice');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json<{ code: string }>().code).toBe('RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });

  it('successful login clears the failure counter', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN_FAILURES_MAX: '3' });
    try {
      await limited.redis.flushDb();
      await createUser(limited, 'alice');
      await login(limited, 'alice', 'wrong but long enough password');
      await login(limited, 'alice', 'wrong but long enough password');
      expect((await login(limited, 'alice')).statusCode).toBe(200); // clears window
      await login(limited, 'alice', 'wrong but long enough password');
      await login(limited, 'alice', 'wrong but long enough password');
      expect((await login(limited, 'alice')).statusCode).toBe(200); // not blocked
    } finally {
      await limited.close();
    }
  });

  it('rate-limits attempts against nonexistent usernames identically (no probe oracle)', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN_FAILURES_MAX: '2' });
    try {
      await limited.redis.flushDb();
      await login(limited, 'ghost', 'wrong but long enough password');
      await login(limited, 'ghost', 'wrong but long enough password');
      const blocked = await login(limited, 'ghost', 'wrong but long enough password');
      expect(blocked.statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('per-IP rate limit', () => {
  it('throttles any endpoint after the window fills, health probes exempt', async () => {
    const limited = await makeApp({ RATE_LIMIT_IP_MAX: '5', RATE_LIMIT_IP_WINDOW_SECONDS: '60' });
    try {
      await limited.redis.flushDb();
      for (let i = 0; i < 5; i += 1) {
        const res = await limited.inject({ method: 'GET', url: '/v1/nope' });
        expect(res.statusCode).toBe(404);
      }
      const blocked = await limited.inject({ method: 'GET', url: '/v1/nope' });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();

      // Probes bypass the limiter: a busy prober can never mark us dead.
      const health = await limited.inject({ method: 'GET', url: '/healthz' });
      expect(health.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
