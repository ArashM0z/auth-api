import { commonPasswords } from './blocklist.js';

export interface PolicyViolation {
  readonly rule: string;
  readonly message: string;
}

export interface PasswordPolicyOptions {
  readonly minLength: number;
  readonly maxLength: number;
  /** Normalized username, when known; passwords containing it are rejected. */
  readonly username?: string;
}

/**
 * NIST SP 800-63B-4 (final, 2025-07-31) password policy:
 *  - length is the only strength rule (default min 15 for single-factor use);
 *  - no composition rules (no "one uppercase, one symbol"; those reduce
 *    real-world strength);
 *  - every Unicode code point counts as one character;
 *  - candidate passwords are screened against a common-password blocklist;
 *  - over-long passwords are rejected, never silently truncated.
 * Returns all violations so clients can fix everything in one round trip.
 */
export function validatePassword(
  password: string,
  options: PasswordPolicyOptions,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const normalized = password.normalize('NFC');
  // NIST 800-63B-4 counts each Unicode code point as one character, which is
  // what string spread yields (grapheme segmentation would differ).
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  const codePoints = [...normalized].length;

  if (codePoints < options.minLength) {
    violations.push({
      rule: 'min_length',
      message: `must be at least ${options.minLength} characters — a long passphrase (spaces allowed) is ideal`,
    });
  }
  if (codePoints > options.maxLength) {
    violations.push({
      rule: 'max_length',
      message: `must be at most ${options.maxLength} characters (long inputs are rejected, never truncated)`,
    });
  }
  if (commonPasswords().has(normalized.toLowerCase())) {
    violations.push({
      rule: 'blocklist',
      message: 'is on the list of commonly used passwords',
    });
  }
  const username = options.username;
  if (
    username !== undefined &&
    username.length >= 3 &&
    normalized.toLowerCase().includes(username.toLowerCase())
  ) {
    violations.push({
      rule: 'contains_username',
      message: 'must not contain the username',
    });
  }
  return violations;
}
