/**
 * Contract tests: live responses must validate against the committed
 * openapi.json. With the CI drift check (regenerate + git diff), the
 * published contract can't drift from what the API actually does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import type { FastifyInstance } from 'fastify';
import { createUser, login, makeApp } from './helpers.js';

interface OpenApiDoc {
  paths: Record<
    string,
    Record<string, { responses: Record<string, { content?: Record<string, { schema: object }> }> }>
  >;
}

let app: FastifyInstance;
let spec: OpenApiDoc;
const ajv = new Ajv({ strict: false });

function schemaFor(path: string, method: string, status: string, contentType: string): object {
  const operation = spec.paths[path]?.[method];
  const media = operation?.responses[status]?.content?.[contentType];
  if (media === undefined) {
    throw new Error(`${method.toUpperCase()} ${path} ${status} ${contentType} not in spec`);
  }
  return media.schema;
}

beforeAll(async () => {
  app = await makeApp();
  spec = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../openapi.json'), 'utf8'),
  ) as OpenApiDoc;
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.redis.flushDb();
});

describe('responses conform to the committed OpenAPI contract', () => {
  it('201 create-user body matches its response schema', async () => {
    const res = await createUser(app, 'alice');
    const validate = ajv.compile(schemaFor('/v1/users', 'post', '201', 'application/json'));
    expect(validate(res.json())).toBe(true);
  });

  it('409 duplicate-user matches the Problem schema', async () => {
    await createUser(app, 'alice');
    const res = await createUser(app, 'alice');
    // The wire Content-Type and the documented media type must agree.
    expect(res.headers['content-type']).toContain('application/problem+json');
    const validate = ajv.compile(schemaFor('/v1/users', 'post', '409', 'application/problem+json'));
    expect(validate(res.json())).toBe(true);
  });

  it('200 login body matches its response schema', async () => {
    await createUser(app, 'alice');
    const res = await login(app, 'alice');
    const validate = ajv.compile(schemaFor('/v1/auth/login', 'post', '200', 'application/json'));
    expect(validate(res.json())).toBe(true);
  });

  it('401 login matches the Problem schema', async () => {
    const res = await login(app, 'ghost', 'wrong but long enough password');
    expect(res.headers['content-type']).toContain('application/problem+json');
    const validate = ajv.compile(
      schemaFor('/v1/auth/login', 'post', '401', 'application/problem+json'),
    );
    expect(validate(res.json())).toBe(true);
  });
});
