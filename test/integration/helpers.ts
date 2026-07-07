import { inject } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

export const GOOD_PASSWORD = 'correct horse battery staple';

/**
 * Builds a real app wired to the Testcontainers Redis. Argon2 parameters are
 * lowered to keep the suite fast — parameter *behavior* (needsRehash etc.)
 * is exercised explicitly where it matters.
 */
export async function makeApp(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    REDIS_URL: inject('redisUrl'),
    LOG_LEVEL: 'silent',
    HASH_MEMORY_KIB: '8192',
    HASH_TIME_COST: '2',
    ...env,
  });
  const app = await buildApp(config);
  await app.ready();
  return app;
}

export function post(app: FastifyInstance, url: string, payload: unknown) {
  return app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
}

export function createUser(app: FastifyInstance, username: string, password = GOOD_PASSWORD) {
  return post(app, '/v1/users', { username, password });
}

export function login(app: FastifyInstance, username: string, password = GOOD_PASSWORD) {
  return post(app, '/v1/auth/login', { username, password });
}
