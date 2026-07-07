/**
 * Config is read and validated once at boot. A bad value fails the process
 * right away with the offending variable named, instead of surfacing as a
 * runtime error mid-request later.
 */
export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly trustProxy: boolean;
  readonly redisUrl: string;
  readonly password: {
    readonly minLength: number;
    readonly maxLength: number;
  };
  readonly hash: {
    readonly memoryKib: number;
    readonly timeCost: number;
    readonly parallelism: number;
    readonly maxConcurrency: number;
  };
  readonly rateLimit: {
    readonly ipMax: number;
    readonly ipWindowSeconds: number;
    readonly loginFailuresMax: number;
    readonly loginFailuresWindowSeconds: number;
  };
}

export class ConfigError extends Error {}

function assertConfig(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ConfigError(message);
}

function intFromEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  assertConfig(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${key} must be an integer in [${min}, ${max}], got "${raw}"`,
  );
  return value;
}

function boolFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  assertConfig(raw === 'true' || raw === 'false', `${key} must be "true" or "false", got "${raw}"`);
  return raw === 'true';
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const logLevel = env.LOG_LEVEL ?? 'info';
  assertConfig(
    (LOG_LEVELS as readonly string[]).includes(logLevel),
    `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`,
  );

  const redisUrl = env.REDIS_URL ?? 'redis://localhost:6379';
  assertConfig(
    redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'),
    `REDIS_URL must be a redis:// or rediss:// URL`,
  );

  const minLength = intFromEnv(env, 'PASSWORD_MIN_LENGTH', 15, { min: 8, max: 64 });
  const maxLength = intFromEnv(env, 'PASSWORD_MAX_LENGTH', 256, { min: 64, max: 4096 });
  assertConfig(
    minLength < maxLength,
    `PASSWORD_MIN_LENGTH (${minLength}) must be < PASSWORD_MAX_LENGTH (${maxLength})`,
  );

  return {
    host: env.HOST ?? '0.0.0.0',
    port: intFromEnv(env, 'PORT', 3000, { min: 1, max: 65535 }),
    logLevel,
    trustProxy: boolFromEnv(env, 'TRUST_PROXY', false),
    redisUrl,
    password: { minLength, maxLength },
    hash: {
      // OWASP Password Storage Cheat Sheet minimums for Argon2id.
      memoryKib: intFromEnv(env, 'HASH_MEMORY_KIB', 19456, { min: 8192, max: 1048576 }),
      timeCost: intFromEnv(env, 'HASH_TIME_COST', 2, { min: 1, max: 10 }),
      parallelism: intFromEnv(env, 'HASH_PARALLELISM', 1, { min: 1, max: 16 }),
      maxConcurrency: intFromEnv(env, 'HASH_MAX_CONCURRENCY', 8, { min: 1, max: 128 }),
    },
    rateLimit: {
      ipMax: intFromEnv(env, 'RATE_LIMIT_IP_MAX', 100, { min: 1, max: 100000 }),
      ipWindowSeconds: intFromEnv(env, 'RATE_LIMIT_IP_WINDOW_SECONDS', 60, {
        min: 1,
        max: 86400,
      }),
      loginFailuresMax: intFromEnv(env, 'RATE_LIMIT_LOGIN_FAILURES_MAX', 10, {
        min: 1,
        max: 10000,
      }),
      loginFailuresWindowSeconds: intFromEnv(env, 'RATE_LIMIT_LOGIN_FAILURES_WINDOW_SECONDS', 900, {
        min: 1,
        max: 86400,
      }),
    },
  };
}
