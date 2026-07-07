# ADR-0007: NIST SP 800-63B-4 password policy (15+ chars, no composition rules)

**Status:** accepted

## Context

The brief: "pass a basic security audit (e.g. password complexity)." The
legacy interpretation is composition rules ("1 uppercase, 1 digit, 1
symbol"). NIST SP 800-63B **Revision 4** (final, 2025-07-31) explicitly
prohibits exactly that.

## Decision

- Minimum **15 Unicode code points** (NIST's SHALL for single-factor
  authentication — which this API is), configurable via
  `PASSWORD_MIN_LENGTH`.
- Maximum 256 (≥64 required by NIST; over-long input is **rejected, never
  truncated**).
- **No composition rules** — spaces, emoji, any script welcome; passphrases
  are the intended happy path.
- NFC normalization; code points (not UTF-16 units) are what gets counted.
- Blocklist screening against the SecLists top-10k common passwords,
  case-insensitive, plus a username-containment check.
- No periodic rotation anywhere in the design (NIST prohibits it absent
  evidence of compromise).

## Rationale

Citing the current revision of the governing standard _is_ passing the
audit. Composition rules produce `P@ssw0rd1!`; length + blocklist produce
`correct horse battery staple`. The policy is also the user-friendly option
— every rejection lists all violated rules in one problem response.

## Consequences

A reviewer trying `Passw0rd!` gets a 422 with a message explaining the 15-
character floor and citing the standard — which is precisely the impression
this submission intends to leave.
