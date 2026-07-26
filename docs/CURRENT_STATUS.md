# Current status

Last verified: 27 July 2026 (Australia/Brisbane)

## Repository stack

- Repository: `LatinMaestro/AI-Trading-Bot`
- Draft stack: #1 foundation → #2 market data → #3 idempotency → #4 candles → #5 aggressive mandate → #6 backtest → #8 universe → #9 objective risk → #11 reports → #12 ingestion → #13 tax → #14 security → #15 universe persistence → #17 Kraken public quality → #19 scheduled universe cycle → #20 committed-evidence join.
- #7, #10, #16 and #18 were closed as superseded or reset duplicates.
- All 16 active pull requests remain draft and unmerged.
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
- Committed-evidence join: exact candle coverage, knowable/fresh timestamps, annualised volatility, candidate-order depth/impact, used FX provenance and lifecycle-pair bounds before fixed nine-statement persistence.
- PR #19 has five focused orchestration tests; PR #20 contains eight branch tests. Seven representative join tests and strict source TypeScript checking passed in an isolated Node 22 harness.
- The cycle audit records committed batch digest, selected/skipped pair counts and actual HTTP attempts.
- Lifecycle events are never inferred from snapshots.
- Dynamic-universe eligibility remains non-authoritative until PR #20's joined contract is invoked by the scheduled cycle with D1-backed evidence providers.
- No private API, credential, fund, wallet or live-order capability changed.

## External blocker

GitHub Actions private-repository capacity remains unavailable until 1 August 2026. Exact-head jobs fail before steps or logs.

Do not merge #1–#6, #8, #9, #11–#15, #17, #19 or #20 until fresh exact-head checks pass and the stack merges in order.

## Next unblocked work

1. Invoke the committed-evidence join from the scheduled cycle using D1-backed candle, conversion and lifecycle providers.
2. Establish complete official lifecycle-source coverage.
3. Persist immutable tax records from fills and reconcile exchange exports.
4. Integrate walk-forward, holdout, benchmark and sensitivity inputs.
5. Persist reports and authorised strategy-approval records.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
