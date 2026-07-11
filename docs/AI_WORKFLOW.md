# AI Workflow

Honest disclosure of how AI was used on this project — because for this kind of
work, _how and why_ matters more than _whether_. The short version: I hold the
**intent and the judgment**; AI supplies the **breadth and the typing**. The
result is code I can defend line by line, which is the only reason it's worth
submitting.

## The division of labor

The decisions that shaped this service are mine: scope discipline (no JWT),
treating username uniqueness as an _atomicity_ problem, making login
_timing-safe_, holding every choice to a **cited standard** rather than folklore,
and running an adversarial review and _acting_ on it. AI wrote code, tests, and
first-draft docs against that direction, verified facts against primary sources,
and ran the review. I supervised throughout, redirected it when it drifted, and
made the calls that mattered.

This is how I actually work — AI as a fast, tireless pair, never a substitute for
judgment.

### The judgment calls, itemized

None of these came from a model. Each is a decision I can defend on its merits,
and each has an [ADR](adr/index.md) or a test behind it:

- **Scope** — verify credentials, issue nothing. Half a token layer is negative
  value in both security and signal ([ADR-0005](adr/0005-no-sessions-or-jwt.md)).
- **Uniqueness is an atomicity problem** — `SET NX`, not check-then-set; a
  concurrency test proves it ([ADR-0003](adr/0003-atomic-uniqueness-set-nx.md)).
- **Login must be timing-safe** — a dummy-hash verify on the unknown-user path,
  a loose schema so malformed usernames still 401, and a measured timing test.
- **The limiter gate goes _before_ the hash** — the fix for the TOCTOU race the
  review found ([ADR-0008](adr/0008-custom-redis-rate-limiter.md)).
- **Standards over folklore** — RFC 9457, NIST 800-63B-4, OWASP, RFC 9110, each
  cited at the point it's applied.
- **The trade-offs I chose to accept** — Redis as the store, a fixed-window
  limiter, ECS over EKS — named openly on the [Roadmap](roadmap.md).

Accepting a suggestion I couldn't defend is how bad code ships; that filter is
the whole job.

## Context & prompt engineering — the techniques that made it reliable

An LLM's default failure mode is _confident wrongness_. The workflow was
engineered to convert that liability into leverage. Each pattern below is
reusable — it's exactly how I'd build a production AI feature responsibly.

### 1. Verification-forced prompting (anti-hallucination)

Every stack and standards claim had to be verified against a **primary source**
before it entered the design. The load-bearing part is the permission-to-fail
clause:

> _"Report only what you can verify on the web, with URLs. Prefer primary sources
> — npm, IETF Datatracker, NIST, OWASP. If a claim cannot be verified, say so
> explicitly rather than guessing."_

Giving the model an explicit exit ("say so rather than guess") is what stops it
inventing confidence. This caught real traps: a package version that didn't
exist, an IETF draft (`Idempotency-Key`) that had **expired**, and a package
rename that would otherwise have burned an hour of debugging.

### 2. Refute-by-default adversarial review

Before submission, independent passes attacked the code. The prompt inverts the
model's natural agreeableness:

> _"Actively try to BREAK this. Find concrete failure scenarios — specific
> inputs/state that produce wrong behaviour — not style notes. For each finding,
> give the file/line, the scenario, and how you verified it is real. **Default to
> 'refuted' unless you can demonstrate the failure.**"_

Refute-by-default filters plausible-but-wrong findings, which are the dominant
failure mode of AI review. This pass surfaced a real **HIGH-severity brute-force
race** — a TOCTOU in the login limiter. I directed the fix (atomic
increment-then-check) and a regression test that would have caught it.

### 3. Lens diversity over redundancy

Rather than run one reviewer five times, each pass got a **distinct lens** —
security, spec-compliance, test-adequacy, operability. Diversity catches failure
modes redundancy can't: the security lens found the race; the test lens found
assertions that executed code without checking behaviour; the ops lens noticed
the benchmark was being throttled by our own rate limiter (the limiter working
correctly — resolved with an env override and a note in the output).

### 4. Context engineering — ground first, then constrain

Each agent was handed exactly what it needed and no more: the specific files, the
standard to cite, and the project's **quality-priority ordering** (security >
correctness > operability > throughput > features) as the explicit tie-breaker.
Grounding in primary sources plus a tight, stated scope is what keeps a model
on-task instead of drifting into generic advice.

### 5. Schema-constrained generation

Where one step's output fed the next, it was constrained to a **schema** so it
could be validated mechanically instead of parsed hopefully — the same discipline
the API itself applies with TypeBox response schemas. Structured output turns
"trust the model" into "verify the shape."

### 6. The tight verify loop

Every change ran **typecheck → lint → test** before the next. Coverage grew
_with_ the code, not after; the strictest TypeScript settings stayed on
throughout, so the compiler acted as a continuous reviewer. Numbers in the README
(latency, timing medians) are _measured_, not asserted.

## Evidence the workflow was real

- Fastify's built-in `text/plain` parser turning a should-be-**415** into a
  **400** — caught by an integration test written _before_ the fix.
- Fastify's AJV defaults silently _stripping_ unknown body fields — inverted to
  strict rejection (`removeAdditional: false`).
- A rate-limiter **TOCTOU race** under concurrency — fixed with an atomic gate and
  a concurrency regression test.
- A **mutation probe deleted the dummy-hash timing defence** to test whether the
  suite would notice. The security timing test caught it — proving the defence has
  a real, executable regression guard, not just a comment.

## How this maps to building AI features

These same patterns are how I'd ship an AI capability into a mortgage workflow
responsibly: verification-forced prompting and citations for **grounding**;
schema-constrained outputs for **validation**; an **eval harness** (the review
pass, formalised as regression tests) gating every prompt change; and adversarial
red-teaming before release. The judgment — what to build, what to trust, what to
reject — stays human. That is the entire point, and it's the discipline I'd bring
to an AI-strategy team. (Governance framing: see [Compliance](COMPLIANCE.md).)

---

Every architectural and security decision on this project is mine to defend. The
tooling widened research breadth and review depth; it did not stand in for
judgment.
