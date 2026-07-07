/**
 * Emits openapi.json from the live route schemas — the committed spec is
 * generated, never hand-written, and CI fails if it drifts from the code.
 * A stub Redis client is injected because no request is ever served.
 */
import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppRedis } from '../src/plugins/redis.js';

const app = await buildApp(loadConfig({}), { redis: {} as AppRedis });
await app.ready();

interface MinimalSpec {
  paths: Record<
    string,
    Record<string, { responses: Record<string, { content?: Record<string, unknown> }> }>
  >;
}
const spec = app.swagger() as unknown as MinimalSpec;

// Fastify serializes every declared response as application/json, but the
// error handler actually sends application/problem+json (RFC 9457). Rewrite
// the media type on all >=400 responses so the committed contract matches the
// wire — otherwise a spec-driven consumer would reject real error bodies.
for (const methods of Object.values(spec.paths)) {
  for (const operation of Object.values(methods)) {
    for (const [status, response] of Object.entries(operation.responses)) {
      const json = response.content?.['application/json'];
      if (Number(status) >= 400 && json !== undefined && response.content !== undefined) {
        response.content = { 'application/problem+json': json };
      }
    }
  }
}

writeFileSync('openapi.json', JSON.stringify(spec, null, 2) + '\n');
await app.close();
console.log('openapi.json written');
