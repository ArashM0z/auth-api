import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);

// SIGTERM/SIGINT drain in-flight requests (up to 10s) before exit — required
// for zero-downtime rolling deploys behind a load balancer.
closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err !== undefined) {
    app.log.error({ err }, 'shutting down after fatal error');
  }
  await app.close();
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.fatal({ err }, 'failed to start server');
  await app.close();
  process.exitCode = 1;
}
