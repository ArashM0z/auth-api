/**
 * Publishes numbers instead of adjectives: framework overhead via /healthz,
 * then real login throughput — which is Argon2id-bound BY DESIGN (19 MiB,
 * t=2 per verification). Run against the compose stack:
 *   docker compose up --build -d && npm run bench
 */
import autocannon from 'autocannon';

const BASE = process.env.BENCH_URL ?? 'http://localhost:3000';
const USERNAME = `bench-${Date.now().toString(36)}`;
const PASSWORD = 'benchmarking passphrase with enough length';

async function ensureUser(): Promise<void> {
  const res = await fetch(`${BASE}/v1/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`could not seed bench user: ${res.status} ${await res.text()}`);
  }
}

function run(title: string, opts: autocannon.Options): Promise<autocannon.Result> {
  process.stdout.write(`\n== ${title} ==\n`);
  return autocannon({ duration: 10, connections: 20, ...opts });
}

function report(result: autocannon.Result): void {
  const { requests, latency, non2xx } = result;
  process.stdout.write(
    `req/s avg ${String(requests.average)} | latency p50 ${String(latency.p50)}ms ` +
      `p99 ${String(latency.p99)}ms | non-2xx ${String(non2xx)}\n`,
  );
}

await ensureUser();

report(
  await run('framework overhead: GET /healthz', {
    url: `${BASE}/healthz`,
  }),
);

report(
  await run('argon2id-bound: POST /v1/auth/login (valid credentials)', {
    url: `${BASE}/v1/auth/login`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    // Login throughput ceiling ≈ HASH_MAX_CONCURRENCY / verify-time. That is
    // the security budget working, not a bottleneck to "fix".
    connections: 8,
  }),
);
