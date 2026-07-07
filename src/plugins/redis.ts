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
  app.addHook('onClose', async () => {
    if (client.isOpen) await client.quit();
  });
  return client;
}
