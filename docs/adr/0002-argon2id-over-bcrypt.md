# ADR-0002: Argon2id over bcrypt

**Status:** accepted

## Context

Password hashing is the single most-scrutinized choice in an auth service.
bcrypt remains the most common pick in Node projects.

## Decision

Argon2id via the `argon2` package (node-argon2, prebuilt binaries), at the
OWASP Password Storage Cheat Sheet minimum configuration: **m=19456 KiB
(19 MiB), t=2, p=1** — which happens to be the library default.

## Rationale

- OWASP's ordering is explicit: Argon2id first; bcrypt "should only be used
  for password storage in legacy systems where Argon2 and scrypt are not
  available".
- Argon2id is memory-hard: 19 MiB per guess makes GPU/ASIC cracking of a
  leaked store drastically more expensive than bcrypt's 4 KB working set.
- **bcrypt silently truncates input at 72 bytes.** Combined with a generous
  maximum password length this becomes a real correctness bug (chars 73+ are
  ignored). Argon2 has no such cliff; our policy rejects (never truncates)
  over-long inputs.
- PHC-format hashes embed algorithm + parameters + salt, enabling
  **rehash-on-login**: when stored parameters lag current policy, the hash
  upgrades transparently at the only moment the plaintext exists. The user
  base migrates itself one login at a time (integration-tested).

## Consequences

- Native module — mitigated by prebuilt binaries for all mainstream
  platforms and a Docker build that compiles nothing.
- Memory cost × concurrency must be bounded: see the `p-limit` hashing gate
  (worst case = `HASH_MAX_CONCURRENCY` × 19 MiB).
- Node 24.7+ ships experimental `crypto.argon2`; when stable this dependency
  can shrink to a thin wrapper.
