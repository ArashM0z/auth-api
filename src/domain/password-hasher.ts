import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pLimit from 'p-limit';
import type { LimitFunction } from 'p-limit';
import type { PasswordHash } from '../types.js';

export interface HasherOptions {
  readonly memoryKib: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly maxConcurrency: number;
}

/**
 * Argon2id hashing with two production concerns most implementations miss:
 *
 * 1. Concurrency cap: every in-flight Argon2id call reserves `memoryKib`
 *    (19 MiB at OWASP minimums). Unbounded concurrency turns a burst of
 *    login attempts into a self-inflicted memory DoS, so all hash/verify
 *    work funnels through a p-limit gate. Worst-case hashing memory is
 *    maxConcurrency * memoryKib.
 *
 * 2. Timing equalization: when a username does not exist we still verify
 *    the supplied password against a boot-time dummy hash, so "unknown
 *    user" and "wrong password" cost the same wall-clock time and cannot
 *    be told apart by measurement.
 */
export class PasswordHasher {
  private readonly limit: LimitFunction;
  private readonly options: argon2.Options;
  private dummyHash: PasswordHash | undefined;

  constructor(options: HasherOptions) {
    this.limit = pLimit(options.maxConcurrency);
    this.options = {
      type: argon2.argon2id,
      memoryCost: options.memoryKib,
      timeCost: options.timeCost,
      parallelism: options.parallelism,
    };
  }

  /** Precomputes the dummy hash used for timing equalization. */
  async init(): Promise<void> {
    this.dummyHash = await this.hash(`dummy-${randomUUID()}`);
  }

  /** Hashes currently executing — exposed for the queue-depth gauge. */
  activeCount(): number {
    return this.limit.activeCount;
  }

  /** Hashes waiting for a concurrency slot — the scale-out signal. */
  pendingCount(): number {
    return this.limit.pendingCount;
  }

  async hash(password: string): Promise<PasswordHash> {
    const hashed = await this.limit(() => argon2.hash(password, this.options));
    return hashed as PasswordHash;
  }

  async verify(hash: PasswordHash, password: string): Promise<boolean> {
    return this.limit(() => argon2.verify(hash, password));
  }

  /** Same cost as a real verification; always "false". */
  async burnDummyVerify(password: string): Promise<void> {
    if (this.dummyHash === undefined) {
      throw new Error('PasswordHasher.init() must be called before use');
    }
    await this.verify(this.dummyHash, password);
  }

  /**
   * True when the stored hash was produced with weaker parameters than the
   * current policy — the login handler then transparently re-hashes.
   */
  needsRehash(hash: PasswordHash): boolean {
    return argon2.needsRehash(hash, this.options);
  }
}
