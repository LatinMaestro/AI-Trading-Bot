# Current status

Last verified: 27 July 2026 (Australia/Brisbane)

## Repository stack

- Repository: `LatinMaestro/AI-Trading-Bot`
- Draft stack: #1 foundation → #2 market data → #3 idempotency → #4 candles → #5 aggressive mandate → #6 backtest → #8 universe → #9 objective risk → #11 reports → #12 ingestion → #13 tax → #14 security → #15 universe persistence → #17 Kraken public quality → #19 scheduled universe cycle → #21 stored history evidence → #23 official lifecycle contracts → #25 lifecycle raw capture → #27 lifecycle document discovery.
- #7, #10, #16, #18, #20, #22, #24 and #26 were closed as superseded, reset or duplicate work.
- All 19 active pull requests remain draft and unmerged.
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
- Exact-head CI for #23, #25 and #27 remains blocked before workflow steps.
- Capturing and persisting discovered individual documents and complete pair-level historical backfill remain pending.
- Missing, gapped, stale or insufficient history remains non-complete; dynamic-universe eligibility is not yet authoritative for strategy selection.
- No private API, credential, fund, wallet or live-order capability changed.

## External blocker

GitHub Actions private-repository capacity remains unavailable until 1 August 2026. Exact-head jobs fail before steps or logs.

Do not merge #1–#6, #8, #9, #11–#15, #17, #19, #21, #23, #25 or #27 until fresh exact-head checks pass and the stack merges in order.

## Next unblocked work

1. Capture and immutably persist discovered listing-index pages and individual lifecycle documents.
2. Complete reviewed Kraken lifecycle historical backfill and bind declarations to committed payloads.
3. Persist signed universe policies/snapshots and connect eligible membership to strategy/backtest orchestration.
4. Persist immutable tax records from fills and reconcile exchange exports.
5. Integrate walk-forward, holdout, benchmark and sensitivity inputs.
6. Persist reports and authorised strategy-approval records.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
