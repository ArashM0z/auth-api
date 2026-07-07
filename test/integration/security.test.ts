/**
 * Attacker's-eye view: every test here is an attack that should fail.
 * The executable version of SECURITY.md, covering enumeration, timing,
 * injection, mass-assignment, leaks, and brute-force.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { GOOD_PASSWORD, createUser, login, makeApp, post } from './helpers.js';

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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 !== 0) return hi;
  const lo = sorted[mid - 1] ?? hi;
  return (lo + hi) / 2;
}

describe('attack: username enumeration', () => {
  it('wrong password and unknown user give byte-identical body and status', async () => {
    await createUser(app, 'realuser');
    const wrong = await login(app, 'realuser', 'incorrect but long enough passphrase');
    const unknown = await login(app, 'ghostuser', 'incorrect but long enough passphrase');

    expect(unknown.statusCode).toBe(wrong.statusCode);
    const scrub = (raw: string) => {
      const b = JSON.parse(raw) as Record<string, unknown>;
      delete b.requestId; // per-request only; not a distinguishing channel
      return b;
    };
    expect(scrub(unknown.body)).toEqual(scrub(wrong.body));
  });

  it('headers do not differ between the two cases', async () => {
    await createUser(app, 'realuser');
    const drop = new Set(['date', 'x-request-id', 'ratelimit', 'content-length']);
    const headerSig = (h: Record<string, unknown>) =>
      Object.keys(h)
        .filter((k) => !drop.has(k))
        .sort();
    const wrong = await login(app, 'realuser', 'incorrect but long enough passphrase');
    const unknown = await login(app, 'ghostuser', 'incorrect but long enough passphrase');
    expect(headerSig(unknown.headers)).toEqual(headerSig(wrong.headers));
  });

  it('never uses 404 or 400 to give away a bad username', async () => {
    await createUser(app, 'realuser');
    expect((await login(app, 'realuser', 'wrong passphrase here ok')).statusCode).toBe(401);
    expect((await login(app, 'ghostuser', 'wrong passphrase here ok')).statusCode).toBe(401);
    // Structurally invalid username → still 401, never a 400/422 format oracle.
    expect((await login(app, '!!bad!!', 'wrong passphrase here ok')).statusCode).toBe(401);
  });
});

describe('attack: timing side-channel', () => {
  // Uses realistic Argon2id cost so hashing dominates response time.
  // Both failure paths run one verification, so their median latencies
  // differ only by scheduling noise. A skipped dummy verify would drop the
  // unknown-user path by a whole hash (~tens of ms); asserting on the
  // absolute gap (not a ratio of tiny numbers) catches that without CI flake.
  it('unknown user and wrong password take about the same time', async () => {
    // Raise the failure cap so none of the 15 samples become a cheap 429
    // (which would skip hashing and corrupt the measurement).
    const timingApp = await makeApp({
      HASH_MEMORY_KIB: '19456',
      HASH_TIME_COST: '2',
      RATE_LIMIT_LOGIN_FAILURES_MAX: '10000',
    });
    try {
      await timingApp.redis.flushDb();
      await createUser(timingApp, 'realuser');
      // Warm-up so JIT/allocation costs don't skew the first samples.
      await login(timingApp, 'realuser', 'incorrect but long enough passphrase');

      const samples = 15;
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < samples; i += 1) {
        let t = performance.now();
        await login(timingApp, 'realuser', 'incorrect but long enough passphrase');
        known.push(performance.now() - t);
        t = performance.now();
        await login(timingApp, `ghost${String(i)}`, 'incorrect but long enough passphrase');
        unknown.push(performance.now() - t);
      }

      const knownMedian = median(known);
      const unknownMedian = median(unknown);
      // Both paths must actually hash (proves the dummy verify runs at all):
      expect(knownMedian).toBeGreaterThan(8);
      expect(unknownMedian).toBeGreaterThan(8);
      // A skipped hash would open a full-verification gap; the real gap is a
      // small fraction of one hash.
      expect(Math.abs(knownMedian - unknownMedian)).toBeLessThan(knownMedian * 0.6);
    } finally {
      await timingApp.close();
    }
  });
});

describe('attack: credential/hash leakage', () => {
  it('no response leaks the password, hash, or PHC prefix', async () => {
    const created = await createUser(app, 'realuser');
    const ok = await login(app, 'realuser');
    const bad = await login(app, 'realuser', 'wrong passphrase here ok');
    for (const res of [created, ok, bad]) {
      expect(res.body).not.toContain(GOOD_PASSWORD);
      expect(res.body).not.toContain('$argon2');
      expect(res.body.toLowerCase()).not.toContain('passwordhash');
    }
  });

  it('the stored record contains a hash, never the plaintext', async () => {
    await createUser(app, 'realuser');
    const raw = (await app.redis.get('user:realuser')) ?? '';
    expect(raw).toContain('$argon2id$');
    expect(raw).not.toContain(GOOD_PASSWORD);
  });
});

describe('attack: injection & smuggling', () => {
  it('username cannot inject Redis key structure', async () => {
    // ':' and spaces are rejected, so "user:admin" style key injection fails.
    for (const evil of ['admin:master', 'a b', 'a\nb', '../etc', 'a*']) {
      const res = await createUser(app, evil);
      expect([400, 422]).toContain(res.statusCode);
    }
  });

  it('extra fields are rejected, not stored (no mass assignment)', async () => {
    const res = await post(app, '/v1/users', {
      username: 'realuser',
      password: GOOD_PASSWORD,
      isAdmin: true,
      role: 'superuser',
    });
    expect(res.statusCode).toBe(400);
    // And nothing was written.
    expect(await app.redis.get('user:realuser')).toBeNull();
  });

  it('a CRLF-injecting X-Request-Id is dropped and replaced with a fresh one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { username: 'realuser', password: GOOD_PASSWORD },
      headers: { 'x-request-id': 'evil\r\nSet-Cookie: x=1' },
    });
    const echoed = res.headers['x-request-id'];
    expect(echoed).not.toContain('\n');
    expect(echoed).not.toBe('evil\r\nSet-Cookie: x=1');
  });
});

describe('attack: resource exhaustion', () => {
  it('oversized body is rejected with 413 before parsing', async () => {
    const res = await post(app, '/v1/users', {
      username: 'realuser',
      password: 'x'.repeat(64 * 1024),
    });
    expect(res.statusCode).toBe(413);
  });

  it('over-long password gets 422, never truncated', async () => {
    const res = await createUser(app, 'realuser', 'x'.repeat(500));
    expect(res.statusCode).toBe(422);
    expect(
      res.json<{ errors: { rule: string }[] }>().errors.some((e) => e.rule === 'max_length'),
    ).toBe(true);
  });
});
