import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { GOOD_PASSWORD, createUser, makeApp, post } from './helpers.js';

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

describe('POST /v1/users', () => {
  it('creates a user: 201, Location header, RFC 3339 timestamp, request id echoed', async () => {
    const res = await createUser(app, 'alice');
    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe('/v1/users/alice');
    expect(res.headers['x-request-id']).toBeDefined();
    const body = res.json<{ user: { username: string; createdAt: string } }>();
    expect(body.user.username).toBe('alice');
    expect(new Date(body.user.createdAt).toISOString()).toBe(body.user.createdAt);
  });

  it('never leaks the password or hash in any response', async () => {
    const res = await createUser(app, 'alice');
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('$argon2');
    expect(res.body).not.toContain(GOOD_PASSWORD);
  });

  it('usernames are case-insensitively unique: "Alice" then "alice" → 409', async () => {
    expect((await createUser(app, 'Alice')).statusCode).toBe(201);
    const res = await createUser(app, 'alice');
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json<{ code: string; type: string; status: number }>();
    expect(body.code).toBe('USERNAME_TAKEN');
    expect(body.type).toBe('/problems/username-taken');
    expect(body.status).toBe(409);
  });

  it('concurrent duplicate registrations cannot race: exactly one 201', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => createUser(app, 'race-target')),
    );
    const codes = attempts.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(7);
  });

  it('echoes a well-formed caller X-Request-Id for correlation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { username: 'alice', password: GOOD_PASSWORD },
      headers: { 'x-request-id': 'caller-abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('caller-abc-123');
  });

  describe('validation (400, schema layer)', () => {
    it('missing password → VALIDATION_ERROR with field details', async () => {
      const res = await post(app, '/v1/users', { username: 'alice' });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ code: string; errors: { field: string }[] }>();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors.some((e) => e.field === 'password')).toBe(true);
    });

    it('unknown fields are REJECTED, not silently stripped', async () => {
      const res = await post(app, '/v1/users', {
        username: 'alice',
        password: GOOD_PASSWORD,
        admin: true,
      });
      expect(res.statusCode).toBe(400);
    });

    it('non-string password is rejected (no type coercion)', async () => {
      const res = await post(app, '/v1/users', { username: 'alice', password: 123456789012345 });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('policy (422, domain layer)', () => {
    it('weak password → WEAK_PASSWORD with every violated rule listed', async () => {
      const res = await createUser(app, 'alice', 'password');
      expect(res.statusCode).toBe(422);
      const body = res.json<{ code: string; errors: { rule: string }[] }>();
      expect(body.code).toBe('WEAK_PASSWORD');
      const rules = body.errors.map((e) => e.rule);
      expect(rules).toContain('min_length');
      expect(rules).toContain('blocklist');
    });

    it('password containing the username is rejected', async () => {
      const res = await createUser(app, 'alice', 'this contains alice sadly');
      expect(res.statusCode).toBe(422);
      expect(res.json<{ errors: { rule: string }[] }>().errors[0]?.rule).toBe('contains_username');
    });

    it('username that survives the schema but fails normalization → INVALID_USERNAME', async () => {
      const res = await createUser(app, '.alice');
      expect(res.statusCode).toBe(422);
      expect(res.json<{ code: string }>().code).toBe('INVALID_USERNAME');
    });
  });

  describe('protocol edges', () => {
    it('wrong content type → 415 problem', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/users',
        payload: 'username=alice',
        headers: { 'content-type': 'text/plain' },
      });
      expect(res.statusCode).toBe(415);
      expect(res.json<{ code: string }>().code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('malformed JSON → 400 MALFORMED_BODY problem', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/users',
        payload: '{"username": "alice", ',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ code: string }>().code).toBe('MALFORMED_BODY');
    });

    it('unknown path → 404 problem+json (not an HTML error page)', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/nope' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('wrong method on a real route → 405 with Allow header', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/users' });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe('POST');
      expect(res.json<{ code: string }>().code).toBe('METHOD_NOT_ALLOWED');
    });
  });
});
