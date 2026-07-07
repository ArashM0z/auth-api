# AI Workflow

This project was built with AI assistance used deliberately — the same way
I use it day to day: as a force multiplier for research breadth, test
coverage, and adversarial review, with every decision human-directed and
human-owned. This document is the honest record of how.

## Principles

1. **Verify before trusting.** Every stack and standards choice was checked
   against primary sources (npm registry, IETF datatracker, NIST, OWASP
   docs) _before_ implementation — AI is great at confident staleness, so
   the workflow forces citations. This caught real traps: a package version
   that didn't exist, an IETF draft (Idempotency-Key) that had expired, and
   the TypeBox package rename that would have cost an hour of debugging.
2. **AI proposes, the standard disposes.** Where a standard exists (RFC
   9457 errors, NIST 800-63B-4 password rules, OWASP Argon2id parameters,
   RFC 9110 status semantics), the design follows it and cites it.
3. **Adversarial by default.** Before submission, independent review passes
   with different lenses (security, spec compliance, test adequacy,
   operational readiness) attacked the code; findings were triaged, fixed,
   and re-verified with tests.
4. **Human owns the judgment calls.** Scope discipline (no JWT), the 201
   deviation, the timing-equalization design, the hash concurrency cap —
   these are decisions I can defend line by line, because accepting an
   AI suggestion without being able to defend it is how bad code ships.

## Phases

| Phase              | What ran                                                                                                                                                                                | Outcome                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Research           | Six parallel research passes (framework, Redis ecosystem, password standards, prior public solutions to similar briefs, HTTP API standards, 2026 toolchain), all citing primary sources | Version-verified stack; NIST rev-4 15-char rule; expired-draft avoided; "what would stand out" calibration |
| Design             | Contract-first: endpoints, problem registry, key layout, threat model — debated before code                                                                                             | The ADRs in `docs/adr/` are the distillate                                                                 |
| Implement          | Schema-first code with a tight verify loop (typecheck → lint → test after every change); strictest TS settings kept honest                                                              | 61 tests, ~96% coverage grew _with_ the code, not after                                                    |
| Verify             | Real-Redis integration tests (Testcontainers), property-based fuzzing (fast-check), benchmark with capacity math, empirical timing measurement of the enumeration defense               | Numbers in the README are measured, not asserted                                                           |
| Adversarial review | Multi-agent review: each finding independently verified before being accepted, then fixed + regression-tested                                                                           | Findings log summarized below the prompts                                                                  |

## Example prompts (verbatim)

Research (one of six):

> Question: What is the state-of-the-art for password storage and password
> policy as of 2026? Verify: OWASP Password Storage Cheat Sheet current
> recommended algorithm and exact argon2id parameters; NIST SP 800-63B
> revision 4 status (was it finalized? when?) and what it says about
> password rules — minimum length, composition rules, blocklists, maximum
> length; best npm package for argon2 in 2026 including maintenance status
> and prebuilt-binary story. Prefer primary sources. Report only what you
> verified on the web, with URLs. If a claim cannot be verified, say so
> rather than guessing.

Adversarial review (the shape of each reviewer):

> You are reviewing an authentication API before submission. Your lens:
> {security | spec-compliance | test-adequacy | operations}. Actively try
> to BREAK it: find concrete failure scenarios (inputs/state → wrong
> behavior), not style notes. For each finding, state the file/line, the
> scenario, and how you verified it is real (read the code, run the test,
> craft the request). Default to "refuted" if you cannot demonstrate it.

The refute-by-default clause matters: it filters plausible-but-wrong
findings, which are the main failure mode of AI review.

## What the workflow caught (sample)

- Fastify's built-in `text/plain` parser turning a should-be-415 into a 400
  (found by an integration test written before the fix).
- Fastify's AJV defaults _silently stripping_ unknown body fields —
  inverted to strict rejection (`removeAdditional: false`).
- A rate-limiter off-by-one between `hit` and `peek` semantics.
- The benchmark being throttled by our own IP rate limiter — resolved with
  an env override and a warning in the bench output (the limiter working
  was the correct behavior).
- **A mutation-testing probe removed the dummy-hash verification** (the
  timing-attack defense) to check whether the suite would notice. The
  security timing test — which asserts both login paths spend a full
  Argon2id verification — catches exactly this, confirming the defense has a
  real executable regression guard rather than just a comment. (The probe
  was reverted; the guard stays.)

## Cost of the approach

More upfront time on research and review than "just start typing", repaid
by the absence of a rewrite: the contract, threat model, and key layout
survived from first design to submission unchanged.
