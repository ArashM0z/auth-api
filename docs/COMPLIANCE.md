# Compliance & AI Governance

How this service maps to the Canadian regulatory context a mortgage-fintech
platform operates in, and how I would govern an AI feature under the same
regime. Written to be read by a security/compliance reviewer as well as an
engineer.

> _Informational, not legal advice. Current as of July 2026; guideline status
> and dates should be re-verified against OSFI/ISED before relying on them._

## 1. How this applies to Lendesk (the framing that matters)

Lendesk is a **technology provider** to the mortgage market, not itself a
federally regulated financial institution (FRFI). But its lender and bank
customers **are** FRFIs, and OSFI's expectations reach a vendor like Lendesk
**through** them:

- **OSFI Guideline B-10 – Third-Party Risk Management** (in force **May 1,
  2024**) makes an FRFI responsible for the risk of its third parties,
  including **technology and cloud service providers**, with heightened
  expectations for _critical_ arrangements (due diligence, contractual
  controls, concentration and exit planning).
- So a credential/identity service sold into that market is graded, in
  practice, against **FRFI-grade** controls during customer due diligence.

**The takeaway I'd lead with:** building to OSFI-grade from day one is a
_commercial_ advantage, not just a compliance cost — it shortens every lender
customer's third-party review. This repo's controls are designed to survive
that review.

## 2. The regulatory map (Canada, mid-2026)

| Framework                               | Governs                                                                                                                                    | Status                                              | Why it matters here                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OSFI B-13** – Technology & Cyber Risk | Governance, tech operations & resilience, cyber security at FRFIs                                                                          | **In force Jan 1, 2024**                            | The bar our CI/CD, IaC, audit trail, and resilience controls are built to clear                                                                     |
| **OSFI B-10** – Third-Party Risk        | Vendor/outsourcing & cloud risk, incl. criticality, concentration, exit                                                                    | **In force May 1, 2024**                            | The channel by which OSFI reaches Lendesk as a supplier                                                                                             |
| **OSFI E-23** – Model Risk Management   | **All models, incl. AI/ML**, at all FRFIs — lifecycle, validation, monitoring                                                              | Final **Sep 11, 2025**; **effective May 1, 2027**   | The framework any AI mortgage feature must be governed under                                                                                        |
| **OSFI–FCAC AI Report** + FIFAI         | Responsible-AI expectations; the **EDGE** principles (Explainability, Data, Governance, Ethics); FIFAI II adds an **AGILE** operating lens | Report Sep 24, 2024                                 | The soft-law shape of "responsible AI" while hard law catches up                                                                                    |
| **PIPEDA**                              | Federal private-sector privacy (collection/consent/retention)                                                                              | **In force**                                        | Governs the personal data we store; drives data minimization                                                                                        |
| **AIDA / Bill C-27**                    | Would have been Canada's horizontal AI statute                                                                                             | **Died on the Order Paper, Jan 2025** (prorogation) | There is **no** comprehensive federal AI law today — the regime is **sector guidance (OSFI) + PIPEDA**. Worth naming, so nobody over-relies on AIDA |

_Provincial note:_ Quebec's **Law 25** adds stricter privacy obligations
(including around automated decision-making) for Quebec data subjects.

## 3. What this service already implements

Controls already in the repo, mapped to the frameworks above. Full SOC 2-style
control table is in [security model](security.md); this is the regulatory view.

| Control in this repo                                                                                               | Evidence                                          | Maps to                                                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------- |
| Argon2id at-rest, PHC strings, rehash-on-login                                                                     | `src/domain/password-hasher.ts`                   | B-13 cyber; PIPEDA safeguards                             |
| **Data minimization** — only username + hash + timestamps stored                                                   | `src/services/user-service.ts`                    | PIPEDA (limiting collection); reduces breach blast radius |
| Encryption in transit + at rest (ElastiCache, TLS at ALB)                                                          | `infra/redis.tf`, `infra/security.tf`             | B-13 resilience; B-10 cloud controls                      |
| Secrets in AWS Secrets Manager, config in SSM — never in code/env                                                  | `infra/secrets.tf`, `docs/CONFIGURATION.md`       | B-13 governance; B-10 key management                      |
| **Structured audit trail** with correlation ids, never credentials                                                 | `src/audit.ts`                                    | B-13 monitoring; SOC 2 monitoring; forensic evidence      |
| Change management: lint, typecheck, real-Redis tests, coverage gate, `npm audit`, CodeQL, OpenAPI-drift, IaC scans | `.github/workflows/`                              | B-13 governance & secure SDLC                             |
| Least-privilege IAM; Redis SG reachable only from the app SG; non-root container                                   | `infra/`, `Dockerfile`                            | B-13 access control; B-10 segmentation                    |
| Resilience: load shedding, graceful drain, `/readyz` dependency gating, AOF durability                             | `src/app.ts`, `src/server.ts`, `compose.yaml`     | B-13 technology operations & resilience                   |
| Brute-force & timing defenses (rate limits, timing-equalized login)                                                | `src/plugins/rate-limit.ts`, `src/routes/auth.ts` | B-13 cyber; abuse resistance                              |

## 4. Governing an AI mortgage feature under E-23 + EDGE

This is the bridge to the AI Strategy team's mandate. If we add an AI feature
to the mortgage workflow (e.g. structured extraction from income documents, or
drafting borrower communications), here is how I'd govern it so it survives
E-23 and the EDGE principles — reusing the same engineering discipline as this
service:

| E-23 / EDGE expectation                   | How I'd meet it (concretely)                                                                                                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model inventory & risk tiering** (E-23) | Register every model; tier by materiality. A doc-extraction assistant with human review is low-risk; anything touching an underwriting/eligibility decision is high-risk and needs the full lifecycle                                               |
| **Validation before deployment** (E-23)   | An **eval harness** — a golden set + prompt-regression tests run in CI, exactly like this repo's test layers. No prompt change ships without passing evals                                                                                          |
| **Explainability** (EDGE-E)               | Structured, cited outputs (schema-validated JSON, source spans), and for any adverse-action-adjacent output, a human-readable rationale — never an unexplained score                                                                                |
| **Data governance** (EDGE-D, PIPEDA)      | PII minimization and redaction before/around model calls; data-residency and retention controls; no training on customer data without explicit basis                                                                                                |
| **Human-in-the-loop** (EDGE-G/Ethics)     | Decisions stay with a person; the model assists. Confidence thresholds route low-confidence cases to review                                                                                                                                         |
| **Ongoing monitoring** (E-23)             | Drift, quality, and bias metrics on live traffic (same Prometheus/OTel spine already here); alerting on degradation                                                                                                                                 |
| **Fairness / bias testing** (EDGE-Ethics) | Test for disparate outcomes across protected-ground proxies; document mitigations — critical in a lending context                                                                                                                                   |
| **Third-party model risk** (B-10)         | Treat the LLM provider (e.g. Anthropic) as a critical third party: contractual data terms, no-training guarantees, an exit/fallback plan, cost/latency budgets, and a **concurrency gate** — the same `p-limit` pattern this repo uses for Argon2id |

## 5. Interview talking points

- _"Lendesk isn't a FRFI, but its lender customers are — so OSFI's B-10 and
  B-13 expectations reach us as a critical third party. Building to that bar
  is a sales advantage: it shortens every customer's due-diligence."_
- _"For any AI feature touching a mortgage decision, that's a model under
  OSFI E-23 (effective May 2027). It needs governance, validation,
  explainability, and monitoring — and I'd enforce that with an eval harness
  in CI, the same way this repo enforces correctness with tests."_
- _"There's no horizontal federal AI law in force — AIDA died with Bill C-27
  in early 2025 — so the operative regime is OSFI's guidance plus PIPEDA. I'd
  design to EDGE now rather than wait for statute."_
- _"Data minimization isn't a slogan here — the stored record is username,
  hash, and timestamps. There is almost nothing to breach, which is the
  cheapest privacy control there is."_

## Sources (verify current status)

- OSFI Guideline E-23 – Model Risk Management (2027)
- OSFI Guideline B-13 – Technology and Cyber Risk Management (2024)
- OSFI Guideline B-10 – Third-Party Risk Management (2024)
- OSFI–FCAC Risk Report: AI Uses and Risks at FRFIs (Sep 2024); FIFAI "A Canadian Perspective on Responsible AI"
- PIPEDA (Personal Information Protection and Electronic Documents Act); Quebec Law 25
- Bill C-27 / AIDA legislative history (LEGISinfo) — lapsed Jan 2025
