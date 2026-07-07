import type { AppRedis } from './redis.js';

export interface WindowPolicy {
  /** Short policy name; appears in the RateLimit headers and Redis keys. */
  readonly name: string;
  readonly max: number;
  readonly windowSeconds: number;
}

export interface WindowState {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetSeconds: number;
}

/**
 * Fixed-window counters in Redis. Because state lives in Redis (not process
 * memory), limits hold across horizontally scaled replicas — an in-memory
 * limiter silently multiplies its threshold by the instance count.
 */
export class RedisRateLimiter {
  private readonly redis: AppRedis;

  constructor(redis: AppRedis) {
    this.redis = redis;
  }

  private key(policy: WindowPolicy, subject: string): string {
    return `rl:${policy.name}:${subject}`;
  }

  /**
   * Consume one attempt and report the resulting state. The Nth attempt of
   * a window with max N is still allowed; N+1 is not.
   */
  async hit(policy: WindowPolicy, subject: string): Promise<WindowState> {
    const key = this.key(policy, subject);
    // INCR + EXPIRE NX + TTL execute atomically inside MULTI: the expiry is
    // set exactly once per window, by whichever request created the key.
    const replies = await this.redis
      .multi()
      .incr(key)
      .expire(key, policy.windowSeconds, 'NX')
      .ttl(key)
      .exec();
    const count = Number(replies[0]);
    const ttl = Number(replies[2]);
    return {
      allowed: count <= policy.max,
      remaining: Math.max(0, policy.max - count),
      resetSeconds: ttl > 0 ? ttl : policy.windowSeconds,
    };
  }

  /** Drop the counter (e.g. successful login clears the failure window). */
  async clear(policy: WindowPolicy, subject: string): Promise<void> {
    await this.redis.del(this.key(policy, subject));
  }
}

/**
 * draft-ietf-httpapi-ratelimit-headers-11 structured fields (Internet-Draft,
 * not yet an RFC — see README). `r` = remaining quota, `t` = seconds to
 * reset, `q` = quota, `w` = window seconds.
 */
export function rateLimitHeaders(policy: WindowPolicy, state: WindowState): Record<string, string> {
  return {
    ratelimit: `"${policy.name}";r=${state.remaining};t=${state.resetSeconds}`,
    'ratelimit-policy': `"${policy.name}";q=${policy.max};w=${policy.windowSeconds}`,
  };
}
