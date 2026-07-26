# Current status

Last verified: 27 July 2026 (Australia/Brisbane)

## Repository stack

- Repository: `LatinMaestro/AI-Trading-Bot`
- Draft stack: #1 foundation → #2 market data → #3 idempotency → #4 candles → #5 aggressive mandate → #6 backtest → #8 universe → #9 objective risk → #11 reports → #12 ingestion → #13 tax → #14 security → #15 universe persistence → #17 Kraken public quality → #20 Kraken universe join.
- #7, #10 and #16 were closed as superseded duplicates.
- All 15 active pull requests remain draft and unmerged.
- Deployment, credentials, funds and wallet connection: none.

## Mandate and boundaries

- Objective: aspirational US$200 → US$1,000,000 within five years; approximately 449.28% annual or 15.25% monthly compound growth required.
- Research: market-cap agnostic; concentrated, high-volatility, high-turnover spot candidates permitted when after-cost evidence supports them.
- Mandatory reporting: target attainment, terminal wealth, drawdown, capacity and substantial/complete-loss frequencies.
- Non-negotiable: spot only; no debt, leverage, derivatives, transfers, withdrawals, wallet signing, automatic top-up or access to other funds.
- Live mode remains disabled and client-gated.

## Venue direction

- Primary foundation: Kraken, subject to granular permission verification and withdrawal exclusion.
- CoinJar and CoinSpot remain comparison candidates only if restricted trading scopes support complete reconciliation without transfer authority.

## Verified slices

- Foundation: 12 tests; fail-closed live state; forbidden-capability scan; strict TypeScript checks.
- Market contracts: canonical AUD symbols, venue precision/minimums, committed contiguous fresh candles.
- Idempotency: 32 tests; exclusive leases, retry auditability and unique logical order intents.
- Candle persistence: 7 tests; migrations 0001–0003; immutable hashed batches/candles and gap classification.
- Aggressive mandate: one consistent five-year strategy/risk direction.
- Backtest: 8 tests; explicit fees/spread/slippage/impact/non-fills; no negative cash, shorts or excess capital use.
- Dynamic universe: 14 tests; migrations 0001–0005; immutable no-lookahead lifecycle and quality evidence.
- Objective risk: 5 tests; required-forward rates, terminal loss, drawdown and seeded block resampling.
- Benchmarks/reports: 5 tests; mandatory cash/BTC/equal-weight/objective comparisons and content-addressed report v1.
- Universe ingestion: 5 tests; deterministic source batches, explicit lifecycle evidence and fresh AUD valuation paths.
- Tax exports: 6 tests; factual transaction archives, explicit lot allocations, AU financial years and safe deterministic exports.
- Security runbooks: credential rotation/revocation, SEV-1–3 playbooks, kill/recovery gates and redacted evidence rules.
- Universe persistence: migration 0006; database-verified commit markers; exact retries; conflict rollback; venue-bound memberships; fixed nine-statement D1 batching independent of universe size.
- Kraken public quality: content-addressed AssetPairs/Ticker/Depth evidence; strict display-pair and L2 parsing; quote turnover, spread, two-sided depth and candidate impact; unavailable impact remains explicit.
- Kraken universe join: bounded pair/depth work; exact candle coverage; fresh AUD conversion; deterministic quality manifest; fixed-count atomic persistence; eight branch tests plus seven passing representative isolated tests and strict source TypeScript validation.

## External blocker

GitHub Actions private-repository capacity remains unavailable until 1 August 2026. Exact-head jobs fail before steps or logs. Do not merge #1–#6, #8, #9, #11–#15, #17 or #20 until fresh exact-head checks pass and the stack merges in order.

## Next unblocked work

1. Invoke the joined Kraken contract from scheduled cycles using D1-backed committed-candle, AUD-conversion and lifecycle evidence providers.
2. Persist immutable tax records from fills and reconcile exchange exports.
3. Integrate walk-forward, holdout, benchmark and sensitivity inputs.
4. Persist reports and bind approved strategy configurations to authorised approval records.
5. Implement alert delivery, exchange-side revocation and incident drills.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
