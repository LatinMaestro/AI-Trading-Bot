# Current status

Last verified: 28 July 2026 (Australia/Brisbane)

## Repository stack

- Repository: `LatinMaestro/AI-Trading-Bot`
- Draft stack: #1 foundation → #2 market data → #3 idempotency → #4 candles → #5 aggressive mandate → #6 backtest → #8 universe → #9 objective risk → #11 reports → #12 ingestion → #13 tax → #14 security → #15 universe persistence → #17 Kraken public quality → #19 scheduled universe cycle → #21 stored history evidence → #23 official lifecycle contracts → #25 lifecycle raw capture → #27 lifecycle document discovery → #28 external intelligence contracts → #29 external intelligence persistence → #30 external intelligence acquisition adapters → #31 minute intelligence queue pipeline → #32 Kraken Status incident intelligence → #33 durable external-intelligence cache → #34 discovered lifecycle document capture → #35 scheduled recursive lifecycle document cycle → #36 SEC press-release RSS intelligence → #37 RBA media-release RSS intelligence → #38 Kraken active-maintenance intelligence → #39 Reddit OAuth transport.
- #7, #10, #16, #18, #20, #22, #24 and #26 were closed as superseded, reset or duplicate work.
- All 31 active pull requests remain draft and unmerged.
- `main` remains a one-line placeholder.
- Deployment, credentials, funds and wallet connection: none.

## Mandate and boundaries

- Objective: aspirational US$200 → US$1,000,000 within five years; approximately 449.28% annual or 15.25% monthly compound growth required.
- Research: market-cap agnostic; concentrated, high-volatility, high-turnover spot candidates permitted when after-cost evidence supports them.
- Non-negotiable: spot only; no debt, leverage, derivatives, transfers, withdrawals, wallet signing, automatic top-up or access to other funds.
- Live mode remains disabled and client-gated.

## Verified slices

- Foundation, market contracts, cycle/order idempotency and immutable candle persistence.
- Aggressive mandate, execution-aware backtest, survivorship-safe universe and objective-risk metrics.
- Mandatory benchmarks, content-addressed reports, AUD-valued universe ingestion and atomic batch persistence.
- Australian tax exports and security/incident runbooks.
- Kraken public quality: content-addressed AssetPairs/Ticker/Depth evidence and strict ticker/L2 quality calculations.
- Scheduled universe cycle: bounded 15-minute depth rotation, fresh AUD paths, retry/timeout/size controls and atomic persistence before strategy evaluation.
- Five focused orchestration tests and strict TypeScript checking pass in an isolated Node 22 harness.
- The cycle audit records committed batch digest, selected/skipped pair counts and actual HTTP attempts.
- Lifecycle events are never inferred from snapshots.
- Stored history evidence: transactional aggregate counts/contiguity, bounded trailing volatility, signal-time availability, skew rejection and quality-manifest binding.
- Official lifecycle contracts: allowlisted Kraken listing, delisting, status-incident and Australian-availability sources; deterministic coverage gaps; future-effective events; and relisting-era Australian reset.
- PR #25 adds daily capture of fixed listing/delisting indexes and status feeds, full-body timeout and streaming limits, exact UTF-8/SHA-256 evidence, deduplicated immutable D1 payloads, commit markers and scheduled orchestration.
- PR #25 strict TypeScript validation and 11/11 focused capture/persistence tests pass in an isolated hosted Node 22 harness.
- PR #27 discovers canonical Kraken Blog listing articles and pagination plus generic Kraken Support lifecycle documents from exact preserved index captures, verifies payload identity, binds discovery provenance and applies bounded source-specific host/path rules without semantic extraction.
- PR #27 strict TypeScript validation and 5/5 focused discovery tests pass in an isolated hosted Node 22 harness.
- PR #28 defines near-real-time official/news/Reddit provenance, latency and deterministic reaction gates. Authoritative severe negative events may pause new risk; corroborated positive events create research candidates only; Reddit-only evidence remains watch-only.
- PR #28 strict TypeScript validation and 7/7 focused reaction-gate tests pass in an isolated hosted Node 22 harness.
- PR #29 adds versioned source contracts for provider, publisher, acquisition mode, licence, attribution, retention, deletion and model-use rules; immutable intelligence items; append-only corrections; deterministic assessment reproduction; content-addressed ingestion batches; and database-verified commit markers.
- PR #29 strict source TypeScript validation plus focused hosted runtime and SQLite validation pass, including exact-retry idempotency, ten-statement atomic persistence, source-contract revocation, relational batch closure, post-commit membership immutability and incomplete-commit rejection.
- PR #30 adds registry-bound bounded feed polling and authenticated webhook payload acquisition for approved official, regulator, issuer and publisher sources. It enforces source-contract origin/mode/effective-date checks, conditional polling, bounded transient retry, redirect/media-type/body-size/query rejection, full streamed-body deadlines, exact byte digests and explicit request/receipt/availability latency.
- PR #30 strict source TypeScript validation and 7/7 focused adapter tests pass in an isolated hosted Node 22 harness.
- PR #31 adds bounded content-addressed queue envelopes for normalised intelligence evidence, consumer-side deterministic assessment reproduction, per-message acknowledgement/retry and minute-source orchestration that exposes source failures as stale or delayed.
- PR #31 excludes raw provider bytes and binary content, binds every queued item to the exact acquisition payload digest and receipt chronology, and advances cache validators only after successful enqueue or confirmed no-change/no-item processing.
- PR #31 strict TypeScript validation and 7/7 focused queue/collector tests pass in an isolated hosted Node 22 harness.
- PR #32 binds Kraken's official unresolved-incidents JSON endpoint to an exact digest-only minute source, verifies payload bytes and SHA-256, and normalises only structured Statuspage severity/status fields.
- PR #32 maps only structured `major` and `critical` unresolved incidents to authoritative negative `network-incident` evidence; `minor` and `none` remain neutral. Raw update bodies are hashed but not retained or queued.
- PR #32 strict TypeScript validation and 6/6 focused tests pass in an isolated hosted Node 22 harness.
- PR #33 adds D1-backed conditional ETag/Last-Modified cache state with bounded canonical validation, monotonic observation time, exact-retry support and same-time conflict rejection.
- PR #33 verifies every cache write by reading back the stored state; stale writes fail visibly instead of silently replacing newer validators.
- PR #33 strict source TypeScript validation and 3/3 focused Node 22/SQLite tests pass in an isolated hosted harness.
- PR #34 adds exact bounded HTML capture for discovered Kraken listing pages, listing documents and support lifecycle documents, with canonical target enforcement, redirect/media/size/UTF-8 controls, deterministic discovery provenance and retry-safe batches of at most ten targets.
- PR #34 adds immutable D1 document-capture headers and commit markers linked to the exact committed index capture and payload that discovered each target; exact retries are idempotent and changed identities, incomplete provenance, mutation and commits before fetch fail closed.
- PR #34 repository-equivalent strict TypeScript validation and 8/8 focused Node 22/SQLite tests pass in an isolated hosted harness.
- PR #35 advances lifecycle discovery from the current fixed indexes plus the latest committed capture of each listing-index page, selects exact provenance deterministically, skips committed source references and captures at most ten documents in the daily lifecycle slot before universe evaluation.
- PR #35 allows a captured listing-index page to serve as provenance only after its immutable document capture is committed, rotates through at most 32 latest page captures and 8 MiB of exact payloads per daily run, records the recursive frontier and capture counts in cycle audit detail, and performs no document work outside the daily slot.
- PR #35 focused strict TypeScript validation and 13/13 focused Node/SQLite tests pass in an isolated hosted harness.
- PR #36 adds a scheduled authoritative SEC press-release RSS manifest, runtime contact-bearing User-Agent enforcement and deterministic bounded metadata normalisation with exact payload verification, canonical SEC links, matching GUIDs and publication/receipt chronology.
- PR #36 retains identity, source URL, chronology and digests but no titles or raw XML; every item is neutral `other` evidence scoped to non-tradable `SEC.REGULATOR`, so it cannot pause risk, create a positive candidate or submit/approve an order.
- PR #36 isolated hosted strict TypeScript validation and 18/18 focused tests pass, including 5/5 SEC parser tests.
- PR #37 adds a reusable strict RSS parser plus an exact scheduled RBA media-release manifest with WAF-aware source documentation, required attribution, digest-only retention and canonical release identity/chronology.
- PR #37 emits only neutral `macro` evidence under non-tradable `AUD.MACRO`; it retains no titles or raw XML and cannot pause risk, create a positive candidate or submit/approve an order.
- PR #37 isolated hosted strict TypeScript validation and 24/24 focused tests pass, including 6/6 RBA source tests.
- PR #38 binds Kraken's official programmatic active-maintenance Status API endpoint to an account-free minute source with exact payload/page identity, active-state, schedule-chronology and update-identity validation.
- PR #38 retains names and update bodies only through digests; `maintenance`, `none` and `minor` impacts remain neutral, while only structured `major` or `critical` impact may request `pause-new-risk` under non-tradable `KRAKEN.VENUE` scope.
- PR #38 isolated hosted strict TypeScript validation and 31/31 focused tests pass, including 7/7 active-maintenance tests. Live endpoint identity/media type and documented programmatic access were verified; full live replay remains pending because direct hosted access returned an access-block HTML response.
- PR #39 adds a bounded OAuth-only Reddit listing transport with truthful runtime User-Agent identity, exact approved subreddit targets, credential non-retention and adaptive header-derived pacing that preserves a 10% free-tier reserve.
- PR #39 enforces metadata-only use, required deletion handling, no model-training use and at most 48-hour retention; invalid prior rate state, redirects, oversized/non-JSON responses, malformed limits and non-listing payloads fail closed.
- PR #39 isolated hosted strict TypeScript validation and 39/39 focused tests pass, including 8/8 Reddit transport tests. Post normalization, deletion sweeps/corrections and approved deployed OAuth credentials remain pending.
- Exact-head GitHub Actions for #23, #25, #27, #28, #29, #30, #31, #32, #33, #34, #35, #36, #37, #38 and #39 remain blocked or pending before workflow steps.
- A truthful runtime SEC contact, additional approved issuer/news manifests/parsers/signatures, deployed minute Cron and Queue/DLQ bindings, Reddit post normalization and deletion sweeps/corrections, approved hosted Reddit OAuth credentials, entity linking and paper-mode risk integration remain pending.
- Missing, gapped, stale, delayed or insufficient evidence remains non-authoritative for strategy selection.
- No private API, credential, fund, wallet or live-order capability changed.

## External blocker

GitHub Actions private-repository capacity remains unavailable until 1 August 2026. Exact-head jobs fail before steps or logs.

Do not merge #1–#6, #8, #9, #11–#15, #17, #19, #21, #23, #25, #27, #28, #29, #30, #31, #32, #33, #34, #35, #36, #37, #38 or #39 until fresh exact-head checks pass and the stack merges in order.

## Next unblocked work

1. Add minimal Reddit post normalization plus provider-deletion sweeps and append-only corrections; keep deployment blocked until approved OAuth credentials are supplied through hosted secrets.
2. Add another account-free approved issuer or news source manifest and deterministic parser; keep deployed SEC collection blocked until a truthful public contact is configured.
3. Bind minute Cron, Queue/DLQ and the deployed external-intelligence consumer.
4. Complete reviewed Kraken lifecycle historical backfill and bind declarations to committed payloads.
5. Persist signed universe policies/snapshots and connect eligible membership to strategy/backtest orchestration.
6. Persist immutable tax records from fills and reconcile exchange exports.
7. Integrate walk-forward, holdout, benchmark and sensitivity inputs.

Do not deploy, request credentials, create provider accounts, accept paid terms, move funds or enable live execution.