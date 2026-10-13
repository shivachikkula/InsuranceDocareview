# Insurance Claims Review

An AI-assisted claims review system. Claimants file claims and upload documents. An automated pipeline checks each claim with deterministic rules and a Claude agent, then flags discrepancies. Human reviewers make every decision, and large claims need a second approver.

```
 Angular 21 SPA ──► NestJS API ──► BullMQ queue ──► Review worker
 (claimant portal,   (auth, claims,                  1. Rules engine (dates, limits, duplicates, required docs)
  reviewer queue,     documents,                     2. Claude agent (reads PDFs/photos, uses tools, cites evidence)
  approvals)          decisions, audit)              3. Cross-checks on AI-extracted values (in code)
                         │                           4. Routing → PENDING_INFO | MANUAL_REVIEW | READY_FOR_APPROVAL
                         ▼
                PostgreSQL (Prisma) · local file storage (swap for S3) · Redis
```

**Design rules**
- The AI never approves or rejects. At best it routes a claim to `READY_FOR_APPROVAL`, which still needs a reviewer's click.
- Arithmetic, dates, limits and duplicate checks run in code (`apps/api/src/review/rules.engine.ts`). The model reads documents and makes judgments.
- Every AI finding must cite a document, page and quote. Citations to documents that don't exist are dropped.
- If the AI call fails, is declined or returns invalid output, the claim goes to manual review with an `AI_REVIEW_UNAVAILABLE` finding.
- Claimant text and document contents are treated as untrusted. The prompt tells the model to report embedded instructions as `PROMPT_INJECTION_ATTEMPT`.
- Claimants never see risk scores or findings. Reviewers can't decide their own claims. The final approver must be a different person from the reviewer.
- Every step is written to `AuditLog`, including reviewer verdicts on each finding and whether the reviewer overrode the AI.

## Quick start

Requires Node 22.12+ (or 24+), Docker (or local PostgreSQL 16 and Redis 7), and an Anthropic API key.

```bash
docker compose up -d                       # PostgreSQL + Redis
npm run setup                              # installs both apps (also runs prisma generate)
cp apps/api/.env.example apps/api/.env     # then set ANTHROPIC_API_KEY
npm run db:migrate && npm run db:seed
npm run dev:api                            # http://localhost:3000/api
npm run dev:web                            # http://localhost:4200 (proxies /api)
```

Demo users (password `Password123!`):

| User | Role |
|---|---|
| alice@example.com | Claimant: AUTO-100234 and HOME-200871 (active) |
| bob@example.com | Claimant: HLTH-300552 (lapsed) |
| rita@insurer.example, raj@insurer.example | Reviewer |
| anna@insurer.example | Approver |
| admin@insurer.example | Admin (all staff screens) |

Sample documents for policy AUTO-100234 are in `samples/`. Regenerate them with `python samples/generate_samples.py`.
- `samples/clean/`: consistent claim form, invoice ($4,850, Main Street Collision) and photo.
- `samples/suspicious/`: the invoice predates the incident, totals $6,350 against $4,850 claimed, includes an unrelated windshield and comes from a watchlisted shop (QuickFix Auto Body).

File both with incident date 2026-09-14 and amount 4850. Uploading the same file twice, even across claims, triggers `DOCUMENT_REUSED`.

## Claim lifecycle

```
DRAFT ─submit─► SUBMITTED ─► PROCESSING ─┬─► PENDING_INFO ─(claimant uploads, resubmits)─► SUBMITTED
                                         ├─► MANUAL_REVIEW ──────┐
                                         └─► READY_FOR_APPROVAL ─┤ reviewer: approve / reject / request info
                                                                 ├─► APPROVED            (amount < FINAL_APPROVAL_AMOUNT)
                                                                 ├─► PENDING_FINAL_APPROVAL ─ approver ─► APPROVED | REJECTED
                                                                 ├─► REJECTED
                                                                 └─► PENDING_INFO
```

Routing (`apps/api/src/review/routing.ts`) sends a claim to `MANUAL_REVIEW` if any of these hold: a HIGH finding, a MEDIUM or HIGH rule failure, AI risk ≥ `MANUAL_REVIEW_RISK_SCORE`, amount ≥ `MANUAL_REVIEW_AMOUNT`, the AI didn't recommend approval, or the AI review was unavailable. Missing required documents (per line of business) send it to `PENDING_INFO` first.

## The AI agent

`apps/api/src/agent/claim-review.agent.ts` uses the Anthropic TypeScript SDK's tool runner:

- **Input:** claim facts, rule results, and every document attached natively (PDFs as `document` blocks, photos as `image` blocks). No separate OCR step.
- **Tools:** `get_policy_terms`, `get_claim_history`, `check_provider`. The provider check is a stub in `provider-check.service.ts`; wire it to your licensing registry or SIU watchlist.
- **Output:** structured output (`output_config.format`) validated against the Zod schema in `review.schema.ts`. It covers recommendation, risk score, summary, extracted fields with document and page, findings with evidence, document total and incident date. Code then compares the extracted total and date against the claim.
- **Model:** `ANTHROPIC_MODEL` (default `claude-opus-5-5`) with effort `AI_EFFORT` (default `high`). Server-side refusal fallback (`fallbacks: "default"`) is on, so a declined request is retried on a fallback model instead of failing. The system prompt is prompt-cached.

The reviewer screen shows findings next to the documents. Clicking a finding's evidence opens the cited document at the cited page. Reviewers mark each finding *Valid* or *False positive*. The queue shows the false-positive rate and how often reviewers override the AI. Those verdicts are the dataset for tuning the prompt.

## Configuration (`apps/api/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | – | PostgreSQL connection |
| `REDIS_HOST` / `REDIS_PORT` | localhost / 6379 | BullMQ |
| `JWT_SECRET` | – | Signs demo-login tokens |
| `STORAGE_DIR` | ./storage | Uploaded documents (dev only) |
| `ANTHROPIC_API_KEY` | – | Claude API key |
| `ANTHROPIC_MODEL` / `AI_EFFORT` | claude-opus-5-5 / high | Model and effort level |
| `MANUAL_REVIEW_AMOUNT` | 10000 | Claims at or above this always get manual review |
| `FINAL_APPROVAL_AMOUNT` | 25000 | Claims at or above this need a second approver |
| `MANUAL_REVIEW_RISK_SCORE` | 60 | AI risk score that forces manual review |
| `LATE_FILING_DAYS` | 30 | Filing-delay rule |

## Project layout

```
apps/api/                     NestJS 12 (ESM), Prisma 7, BullMQ
  prisma/schema.prisma        User, Policy, Claim, ClaimDocument, AiReview, Finding, AuditLog
  src/agent/                  Claude agent, prompt, output schema, provider check
  src/review/                 rules engine, routing, pipeline service, queue worker
  src/claims/                 REST API, workflow state machine (separation of duties)
  src/auth/                   JWT login + global role guard
apps/web/                     Angular 21, Angular Material, signals, standalone components
  src/app/features/claimant/  my claims, new claim, upload + submit
  src/app/features/reviewer/  queue with stats, claim review workbench, document viewer
samples/                      demo claim documents
```

`npm test` runs both apps' unit tests: rules, routing, workflow, agent output handling (mocked client), and pipes.

## Before production

- **Identity:** replace the demo login with your IdP (OIDC/SAML) and map groups to roles.
- **Storage:** move `StorageService` to S3 or Azure Blob with encryption at rest, add a virus scan on upload (marked TODO), and set retention rules.
- **Data protection:** a BAA or data-processing agreement for health claims, PII minimisation, and log redaction.
- **Evaluation:** build a labelled set of past claims (known clean and known fraud) and measure flag precision and recall before changing the prompt, model or thresholds. Add reviewer overrides to it.
- **Policy admin integration:** load policies from your policy system instead of the seeded table.
- **Live updates:** the UI polls while a claim is processing. Switch to SSE or WebSockets backed by Redis pub/sub when you run several API instances.
- **Operations:** rate limiting, request size limits at the gateway, monitoring of queue depth, AI failure rate and token usage (stored on each `AiReview`).
