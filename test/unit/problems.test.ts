import { describe, expect, it } from 'vitest';
import { PROBLEM_TYPES, ProblemError } from '../../src/problems.js';

describe('problem registry', () => {
  it('slugs are unique (each problem type has a distinct URI)', () => {
    const slugs = Object.values(PROBLEM_TYPES).map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('statuses are valid HTTP error codes', () => {
    for (const def of Object.values(PROBLEM_TYPES)) {
      expect(def.status).toBeGreaterThanOrEqual(400);
      expect(def.status).toBeLessThanOrEqual(599);
    }
  });

  it('ProblemError exposes the registry status for its code', () => {
    const err = new ProblemError('USERNAME_TAKEN');
    expect(err.status).toBe(409);
    expect(err.code).toBe('USERNAME_TAKEN');
    expect(err).toBeInstanceOf(Error);
  });

  it('ProblemError carries field errors and headers through', () => {
    const err = new ProblemError('WEAK_PASSWORD', {
      detail: 'nope',
      errors: [{ field: 'password', rule: 'min_length', message: 'too short' }],
      headers: { 'retry-after': '5' },
    });
    expect(err.errors).toHaveLength(1);
    expect(err.headers).toEqual({ 'retry-after': '5' });
    expect(err.message).toBe('nope');
  });
});
