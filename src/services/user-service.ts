import type { NormalizedUsername, PasswordHash } from '../types.js';
import type { AppRedis } from '../plugins/redis.js';
import type { PasswordHasher } from '../domain/password-hasher.js';

export interface PublicUser {
  readonly username: string;
  readonly createdAt: string;
}

interface StoredUser {
  readonly username: string;
  readonly passwordHash: string;
  readonly createdAt: string;
  readonly passwordRehashedAt?: string;
}

export type CreateResult =
  { readonly created: true; readonly user: PublicUser } | { readonly created: false };

export type VerifyResult =
  | { readonly ok: true; readonly username: string; readonly rehashed: boolean }
  | { readonly ok: false };

const userKey = (username: NormalizedUsername): string => `user:${username}`;

export class UserService {
  private readonly redis: AppRedis;
  private readonly hasher: PasswordHasher;

  constructor(redis: AppRedis, hasher: PasswordHasher) {
    this.redis = redis;
    this.hasher = hasher;
  }

  /**
   * Uniqueness is enforced by Redis itself: SET ... NX atomically creates
   * the key only if absent, so two concurrent registrations of the same
   * username cannot both succeed (no check-then-set race). Hashing happens
   * BEFORE the write for both outcomes, so a "taken" response costs the
   * same time as a successful one — no timing oracle on registration.
   */
  async create(username: NormalizedUsername, password: string): Promise<CreateResult> {
    const passwordHash = await this.hasher.hash(password);
    const createdAt = new Date().toISOString();
    const record: StoredUser = { username, passwordHash, createdAt };
    const reply = await this.redis.set(userKey(username), JSON.stringify(record), {
      condition: 'NX',
    });
    if (reply === null) return { created: false };
    return { created: true, user: { username, createdAt } };
  }

  /**
   * Unknown-user and wrong-password paths are indistinguishable: both
   * consume one Argon2id verification (a dummy one when the user does not
   * exist) and both surface as the same 401 upstream.
   *
   * On success, if the stored hash predates current Argon2id parameters it
   * is transparently re-hashed (the only moment the plaintext is available)
   * — the user base upgrades itself one login at a time.
   */
  async verifyCredentials(username: NormalizedUsername, password: string): Promise<VerifyResult> {
    const raw = await this.redis.get(userKey(username));
    if (raw === null) {
      await this.hasher.burnDummyVerify(password);
      return { ok: false };
    }
    const stored = JSON.parse(raw) as StoredUser;
    const hash = stored.passwordHash as PasswordHash;
    const ok = await this.hasher.verify(hash, password);
    if (!ok) return { ok: false };

    let rehashed = false;
    if (this.hasher.needsRehash(hash)) {
      const upgraded: StoredUser = {
        ...stored,
        passwordHash: await this.hasher.hash(password),
        passwordRehashedAt: new Date().toISOString(),
      };
      // XX: only update an existing key; if the user vanished mid-flight the
      // rehash is silently dropped rather than resurrecting the account.
      await this.redis.set(userKey(username), JSON.stringify(upgraded), { condition: 'XX' });
      rehashed = true;
    }
    return { ok: true, username: stored.username, rehashed };
  }
}
