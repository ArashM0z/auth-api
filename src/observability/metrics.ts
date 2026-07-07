import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics. A fresh Registry per app instance (not the global
 * default) so multiple apps in one test process don't collide on metric
 * names. Exposed at GET /metrics for scraping.
 */
export interface Metrics {
  readonly registry: Registry;
  readonly httpRequests: Counter<'method' | 'route' | 'status'>;
  readonly authAttempts: Counter<'outcome'>;
  readonly usersCreated: Counter;
  readonly rateLimited: Counter<'scope'>;
  readonly passwordRehashes: Counter;
}

export interface HashQueueProbe {
  activeCount(): number;
  pendingCount(): number;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'authapi_' });

  return {
    registry,
    httpRequests: new Counter({
      name: 'authapi_http_requests_total',
      help: 'HTTP requests by method, route and status code',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    }),
    authAttempts: new Counter({
      name: 'authapi_auth_attempts_total',
      help: 'Login attempts by outcome (success, invalid, rate_limited)',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    usersCreated: new Counter({
      name: 'authapi_users_created_total',
      help: 'Successfully created users',
      registers: [registry],
    }),
    rateLimited: new Counter({
      name: 'authapi_rate_limited_total',
      help: 'Requests rejected by a rate limiter, by scope (ip, username)',
      labelNames: ['scope'],
      registers: [registry],
    }),
    passwordRehashes: new Counter({
      name: 'authapi_password_rehashes_total',
      help: 'Passwords transparently re-hashed to current Argon2id parameters on login',
      registers: [registry],
    }),
  };
}

/**
 * Gauges the Argon2id hashing gate (active + queued). Registered with a
 * collect callback so the depth is read at scrape time — this is the signal
 * that tells you to scale out before logins start queueing.
 */
export function registerHashQueueGauge(metrics: Metrics, probe: HashQueueProbe): void {
  new Gauge({
    name: 'authapi_hash_active',
    help: 'Argon2id hashes currently executing',
    registers: [metrics.registry],
    collect() {
      this.set(probe.activeCount());
    },
  });
  new Gauge({
    name: 'authapi_hash_queued',
    help: 'Argon2id hashes waiting for a concurrency slot',
    registers: [metrics.registry],
    collect() {
      this.set(probe.pendingCount());
    },
  });
}
