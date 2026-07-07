import { describe, expect, it } from 'vitest';
import { rateLimitHeaders } from '../../src/plugins/rate-limit.js';

describe('rateLimitHeaders (draft-ietf-httpapi-ratelimit-headers-11)', () => {
  it('emits RateLimit and RateLimit-Policy structured fields', () => {
    const headers = rateLimitHeaders(
      { name: 'login-failures', max: 10, windowSeconds: 900 },
      { allowed: true, remaining: 7, resetSeconds: 340 },
    );
    expect(headers).toEqual({
      ratelimit: '"login-failures";r=7;t=340',
      'ratelimit-policy': '"login-failures";q=10;w=900',
    });
  });
});
