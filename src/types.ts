/**
 * Branded (nominal) types. A plain `string` can't be passed where a
 * `NormalizedUsername` or `PasswordHash` is required, so "used the raw
 * username as a Redis key" or "stored the plaintext where the hash goes"
 * become compile-time errors instead of code-review catches.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Username after NFC normalization + lowercasing + charset validation. */
export type NormalizedUsername = Brand<string, 'NormalizedUsername'>;

/** A PHC-format Argon2id hash string (parameters + salt embedded). */
export type PasswordHash = Brand<string, 'PasswordHash'>;
