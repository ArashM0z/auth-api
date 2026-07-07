import { createClient } from 'redis';
import type { FastifyInstance } from 'fastify';

// Infer the instantiated client type from a concrete call signature. The
// generic ReturnType<typeof createClient> doesn't unify with created clients
// under exactOptionalPropertyTypes.
const clientFactory = (url: string) => createClient({ url });
export type AppRedis = ReturnType<typeof clientFactory>;

declare module 'fastify' {
  interface FastifyInstance {
    redis: AppRedis;
  }
}

export async function connectRedis(app: FastifyInstance, url: string): Promise<AppRedis> {
  const client = clientFactory(url);
  client.on('error', (err: Error) => {
    app.log.error({ err }, 'redis client error');
  });
  await client.connect();
  // The client's lifecycle is owned by the composition root (server.ts closes
  // it during graceful shutdown), not by a Fastify hook — a request pipeline
  // never touches the connection lifecycle.
  return client;
}
