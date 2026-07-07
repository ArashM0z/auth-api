# AI Workflow

Honest disclosure, because this team explicitly cares _how and why_ AI is
used, not just whether it is.

**The division of labour on this project:** all of the major ideas,
architectural direction, and decisions are mine — the choice to keep scope
tight (no JWT), to treat username uniqueness as an atomicity problem, to
equalize login timing, to lead with OpenTofu, to hold the design to current
standards, to run an adversarial review and _act_ on it. The **AI did the
implementation and collaborated on the details**: it wrote the code, the
tests, and the first drafts of the docs against my direction, verified stack
facts against primary sources, and executed the review. I supervised
throughout, redirected when it went the wrong way, and made significant
changes along the way. The result is code I can stand behind and explain
line by line — which is the only reason it is worth submitting.

This is how I actually work: I use AI as a fast, tireless pair — I hold the
intent and the judgment; it holds the typing and the breadth.

## Principles I directed the work by

1. **Verify before trusting.** Every stack and standards choice was checked
   against primary sources (npm registry, IETF datatracker, NIST, OWASP
   docs) _before_ implementation — AI is great at confident staleness, so I
   made the workflow force citations. This caught real traps: a package
   version that didn't exist, an IETF draft (Idempotency-Key) that had
   expired, and the TypeBox package rename that would have cost an hour of
   debugging.
2. **The standard disposes.** Where a standard exists (RFC 9457 errors,
   NIST 800-63B-4 password rules, OWASP Argon2id parameters, RFC 9110 status
   semantics), the design follows it and cites it — not folklore.
3. **Adversarial by default.** Before submission I had independent review
   passes, each with a different lens (security, spec compliance, test
   adequacy, operability), attack the code. It surfaced a real HIGH-severity
   brute-force race (a TOCTOU in the login limiter); I directed the fix
   (atomic increment-then-check) and a regression test that would have
   caught it. Acting on review is the point, not running it.
4. **I own the judgment calls.** Scope discipline, the 201 deviation, the
   timing-equalization design, the hash-concurrency cap, the ECS-over-EKS
   decision — mine, and defensible, because accepting a suggestion I can't
   defend is how bad code ships.

## Phases

| Phase              | What ran                                                                                                                                                                                | Outcome                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Research           | Six parallel research passes (framework, Redis ecosystem, password standards, prior public solutions to similar briefs, HTTP API standards, 2026 toolchain), all citing primary sources | Version-verified stack; NIST rev-4 15-char rule; expired-draft avoided; "what would stand out" calibration |
| Design             | Contract-first: endpoints, problem registry, key layout, threat model — debated before code                                                                                             | The ADRs in `docs/adr/` are the distillate                                                                 |
| Implement          | Schema-first code with a tight verify loop (typecheck → lint → test after every change); strictest TS settings kept honest                                                              | 77 tests, ~96% coverage grew _with_ the code, not after                                                    |
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
