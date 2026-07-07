import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: ReadonlySet<string> | undefined;

/**
 * Top-10k common passwords (SecLists, MIT). NIST SP 800-63B-4 requires
 * screening candidate passwords against commonly used or compromised values.
 * Loaded once, lazily; ~10k lowercase entries.
 */
export function commonPasswords(): ReadonlySet<string> {
  if (cached === undefined) {
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(here, '..', 'data', 'common-passwords.txt'), 'utf8');
    cached = new Set(
      text
        .split('\n')
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0),
    );
  }
  return cached;
}
