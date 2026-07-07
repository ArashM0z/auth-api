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
writeFileSync('openapi.json', JSON.stringify(app.swagger(), null, 2) + '\n');
await app.close();
console.log('openapi.json written');
