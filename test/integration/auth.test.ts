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
  it('valid credentials → 200 with the username', async () => {
    await createUser(app, 'alice');
    const res = await login(app, 'alice');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true, user: { username: 'alice' } });
  });

  it('login is case-insensitive on username', async () => {
    await createUser(app, 'Bob');
    expect((await login(app, 'bOB')).statusCode).toBe(200);
  });

  it('wrong password → 401 with INVALID_CREDENTIALS', async () => {
    await createUser(app, 'alice');
    const res = await login(app, 'alice', 'wrong but long enough password');
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json<{ code: string }>().code).toBe('INVALID_CREDENTIALS');
  });

  it('wrong password and unknown user look the same', async () => {
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

  it('malformed usernames get 401 too, not 400', async () => {
    const res = await login(app, '!!definitely not a valid name!!', 'whatever password here');
    expect(res.statusCode).toBe(401);
  });

  it('RateLimit headers count down with each failure', async () => {
    const limited = await makeApp({ RATE_LIMIT_LOGIN_FAILURES_MAX: '10' });
    try {
      await limited.redis.flushDb();
      await createUser(limited, 'alice');
      const first = await login(limited, 'alice', 'wrong but long enough password');
      const second = await login(limited, 'alice', 'wrong but long enough password');
      expect(first.headers['ratelimit-policy']).toBe('"login-failures";q=10;w=900');
      // Two failures consumed, so remaining goes 9 then 8, not a constant.
      expect(first.headers.ratelimit).toMatch(/^"login-failures";r=9;t=\d+$/);
      expect(second.headers.ratelimit).toMatch(/^"login-failures";r=8;t=\d+$/);
    } finally {
      await limited.close();
    }
  });

  it('returns a clean 500 when Redis blows up, no internals leaked', async () => {
    const faulty = await makeApp();
    try {
      faulty.redis.destroy(); // every subsequent Redis command now rejects
      const res = await login(faulty, 'alice');
      expect(res.statusCode).toBe(500);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json<{ code: string }>().code).toBe('INTERNAL_ERROR');
      // No stack trace or connection details leak out.
      expect(res.body).not.toMatch(/stack|ECONN|redis|closed/i);
    } finally {
      await faulty.close();
    }
  });

  it('upgrades an outdated password hash on login', async () => {
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

  it('leaves a current hash alone, no needless rewrite', async () => {
    await createUser(app, 'current');
    const before = (await app.redis.get('user:current')) ?? '';
    const res = await login(app, 'current');
    expect(res.statusCode).toBe(200);

    const after = (await app.redis.get('user:current')) ?? '';
    // Byte-identical: no rehash write when the stored hash is already current.
    expect(after).toBe(before);
    const record = JSON.parse(after) as { passwordRehashedAt?: string };
    expect(record.passwordRehashedAt).toBeUndefined();
  });
});

describe('brute-force protection', () => {
  it('locks out with 429 + Retry-After after too many failures, even with the right password', async () => {
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

  it('rate-limits unknown usernames the same way', async () => {
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

  it('a concurrent burst still cannot beat the cap', async () => {
    const max = 3;
    const limited = await makeApp({ RATE_LIMIT_LOGIN_FAILURES_MAX: String(max) });
    try {
      await limited.redis.flushDb();
      await createUser(limited, 'alice');
      // Fire 20 wrong-password guesses for the same account at once.
      // A read-then-verify-then-increment gate would let them all through;
      // the atomic INCR gate lets at most `max` reach verification.
      const results = await Promise.all(
        Array.from({ length: 20 }, () => login(limited, 'alice', 'wrong but long enough password')),
      );
      const reachedVerify = results.filter((r) => r.statusCode === 401).length;
      const rejected = results.filter((r) => r.statusCode === 429).length;
      expect(reachedVerify).toBeLessThanOrEqual(max);
      expect(reachedVerify + rejected).toBe(20);
      expect(rejected).toBeGreaterThanOrEqual(20 - max);
    } finally {
      await limited.close();
    }
  });

  it('puts a TTL on the failure window so lockouts expire on their own', async () => {
    const limited = await makeApp({
      RATE_LIMIT_LOGIN_FAILURES_MAX: '5',
      RATE_LIMIT_LOGIN_FAILURES_WINDOW_SECONDS: '900',
    });
    try {
      await limited.redis.flushDb();
      await createUser(limited, 'alice');
      await login(limited, 'alice', 'wrong but long enough password');
      const ttl = await limited.redis.ttl('rl:login-failures:alice');
      // A missing EXPIRE shows -1 (permanent lockout) or runs past the
      // window; a correct one is in (0, 900].
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(900);
    } finally {
      await limited.close();
    }
  });
});

describe('per-IP rate limit', () => {
  it('throttles requests once the window fills, but health probes are exempt', async () => {
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
