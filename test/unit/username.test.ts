import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeUsername } from '../../src/domain/username.js';

describe('normalizeUsername', () => {
  it('lowercases: "Alice" and "alice" are the same account', () => {
    const upper = normalizeUsername('Alice');
    const lower = normalizeUsername('alice');
    expect(upper).toEqual({ ok: true, value: 'alice' });
    expect(lower).toEqual({ ok: true, value: 'alice' });
  });

  it('accepts dots, underscores and dashes in the middle', () => {
    expect(normalizeUsername('a.b_c-d').ok).toBe(true);
  });

  it.each(['.alice', 'alice.', '-alice', 'alice-', '_alice'])(
    'rejects leading/trailing punctuation: %s',
    (raw) => {
      expect(normalizeUsername(raw).ok).toBe(false);
    },
  );

  it('rejects names shorter than 3 or longer than 32 characters', () => {
    expect(normalizeUsername('ab').ok).toBe(false);
    expect(normalizeUsername('a'.repeat(33)).ok).toBe(false);
    expect(normalizeUsername('a'.repeat(32)).ok).toBe(true);
  });

  it('rejects non-ASCII lookalikes (homoglyph defense)', () => {
    expect(normalizeUsername('аlice').ok).toBe(false); // Cyrillic "а"
    expect(normalizeUsername('alicé').ok).toBe(false);
    expect(normalizeUsername('İstanbul').ok).toBe(false); // dotted capital I
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeUsername('  alice  ')).toEqual({ ok: true, value: 'alice' });
  });

  it('property: never throws, and accepted values are idempotent under re-normalization', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 128 }), (raw) => {
        const first = normalizeUsername(raw);
        if (first.ok) {
          // Normalizing an already-normalized name must be a fixed point —
          // otherwise lookups and stored keys could disagree.
          const second = normalizeUsername(first.value);
          expect(second).toEqual(first);
          expect(first.value).toMatch(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/);
        }
      }),
    );
  });
});
