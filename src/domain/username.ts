import type { NormalizedUsername } from '../types.js';

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/**
 * Lowercase ASCII letters/digits with ., _, - allowed in the middle.
 * Applied AFTER NFC normalization + lowercasing, so visually confusable
 * Unicode (homoglyphs, combining marks) can never form a distinct account.
 */
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export type UsernameResult =
  | { readonly ok: true; readonly value: NormalizedUsername }
  | { readonly ok: false; readonly reason: string };

/**
 * Usernames are case-insensitively unique: "Alice" and "alice" are the same
 * account. NFC first (NIST SP 800-63B-4 normalization guidance), then
 * lowercase, then charset check.
 */
export function normalizeUsername(raw: string): UsernameResult {
  const normalized = raw.normalize('NFC').trim().toLowerCase();
  const length = normalized.length;
  if (length < USERNAME_MIN_LENGTH) {
    return { ok: false, reason: `must be at least ${USERNAME_MIN_LENGTH} characters` };
  }
  if (length > USERNAME_MAX_LENGTH) {
    return { ok: false, reason: `must be at most ${USERNAME_MAX_LENGTH} characters` };
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      reason:
        'may contain only letters, digits, ".", "_" and "-", and must start and end with a letter or digit',
    };
  }
  return { ok: true, value: normalized as NormalizedUsername };
}
