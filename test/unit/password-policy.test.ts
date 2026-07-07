import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validatePassword } from '../../src/domain/password-policy.js';
import type { PasswordPolicyOptions } from '../../src/domain/password-policy.js';

const policy: PasswordPolicyOptions = { minLength: 15, maxLength: 256 };
const rules = (password: string, options: PasswordPolicyOptions = policy) =>
  validatePassword(password, options).map((v) => v.rule);

describe('validatePassword (NIST SP 800-63B-4)', () => {
  it('accepts a long passphrase with spaces and unicode', () => {
    expect(rules('correct horse battery staple 🐎')).toEqual([]);
  });

  it('rejects short passwords with min_length', () => {
    expect(rules('short')).toContain('min_length');
  });

  it('rejects over-long passwords instead of truncating', () => {
    expect(rules('x'.repeat(257))).toContain('max_length');
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    // 15 emoji = 30 UTF-16 code units but exactly 15 code points.
    expect(rules('🔥'.repeat(15))).toEqual([]);
  });

  it('screens against the common-password blocklist (case-insensitive)', () => {
    expect(rules('PASSWORD', { minLength: 8, maxLength: 64 })).toContain('blocklist');
    expect(rules('1qaz2wsx', { minLength: 8, maxLength: 64 })).toContain('blocklist');
  });

  it('imposes NO composition rules: lowercase-only length is enough', () => {
    expect(rules('justlowercaseletters')).toEqual([]);
  });

  it('rejects passwords containing the username', () => {
    expect(rules('prefix-alice-liked-this-suffix', { ...policy, username: 'alice' })).toContain(
      'contains_username',
    );
  });

  it('treats NFC and NFD encodings of the same password identically', () => {
    const composed = 'café con leche por favor'; // é as one code point
    const decomposed = 'café con leche por favor'; // e + combining acute
    expect(composed).not.toBe(decomposed);
    expect(validatePassword(composed, policy)).toEqual(validatePassword(decomposed, policy));
    expect(rules(composed)).toEqual([]);
  });

  it('reports every violation at once (single round trip for clients)', () => {
    const found = rules('password', { minLength: 15, maxLength: 64 });
    expect(found).toContain('min_length');
    expect(found).toContain('blocklist');
  });

  it('property: never throws and always returns rule+message pairs', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (password) => {
        const violations = validatePassword(password, policy);
        for (const violation of violations) {
          expect(violation.rule.length).toBeGreaterThan(0);
          expect(violation.message.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('property: any ≥15-codepoint non-blocklisted password without the username passes', () => {
    fc.assert(
      fc.property(
        fc.string({
          // ASCII-only alphabet: spreading it into chars is unambiguous.
          // eslint-disable-next-line @typescript-eslint/no-misused-spread
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 !@#$%'),
          minLength: 30,
          maxLength: 60,
        }),
        (password) => {
          const violations = validatePassword(password, policy);
          const nonBlocklist = violations.filter((v) => v.rule !== 'blocklist');
          expect(nonBlocklist).toEqual([]);
        },
      ),
    );
  });
});
