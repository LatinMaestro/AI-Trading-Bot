# Decision log

## 2026-07-26 — Private repository and hosted-only development

Use `LatinMaestro/AI-Trading-Bot`. Development is performed through GitHub and hosted services rather than requiring the user's computer to run the application.

## 2026-07-26 — Spot-only scope

Exclude leverage, margin, futures, perpetuals, options, borrowing, lending, staking and shorting. The growth objective does not override this boundary.

## 2026-07-26 — No wallet custody

Do not connect MetaMask or request wallet signing authority. The user's ETH on Polygon remains under user control.

## 2026-07-26 — Kraken primary venue

Choose Kraken as the primary implementation because it exposes granular API permissions and key introspection. Higher fees are accepted initially in exchange for enforceable withdrawal exclusion and mature API behaviour.

## 2026-07-26 — Unsafe venue credentials excluded

Do not use a venue for unattended execution when its selected API key grants transfer, withdrawal, address-management or unrestricted account control. A future venue may be reconsidered only after current documentation and programmatic permission checks prove that trading authority can be isolated from custody authority.

## 2026-07-26 — Deterministic baseline before adaptive AI

Begin with transparent strategies, fee-aware backtesting and hard operational controls. Adaptive model selection is a later gated enhancement, not a substitute for evidence.

## 2026-07-26 — Cloudflare foundation

Use Cloudflare Workers and D1 to minimise infrastructure cost while preserving hosted scheduling, secrets, audit storage and deployment controls.

## 2026-07-26 — Immutable market-data ledger

Persist accepted committed 60-minute and daily candles as append-only D1 records with deterministic SHA-256 digests. Exact retries are idempotent, but a reused batch or candle identity with different content is a hard conflict. Ordinary updates and deletes are rejected by database triggers so research evidence cannot be silently rewritten.

Kraken REST is not treated as a complete historical archive. Its documented 720-row response includes the current uncommitted row, so gap repair assumes no more than 719 committed intervals remain recoverable. Older gaps must use a separately approved reproducible source, progressive collection or explicit exclusion from research.

## 2026-07-26 — Five-year aggressive mandate

Optimise strategy research for the aspirational objective of growing US$200 toward US$1,000,000 within five years of first authorised live-capital activation. Do not silently substitute a slow multi-decade wealth plan.

The universe is market-cap agnostic and may include approved blue chips, mid-caps, micro-caps and newly listed spot assets. Candidate research may use concentrated positions, up to 100% gross spot exposure, hourly decisions, multiple daily rebalances and maker or taker execution when realistic after-cost evidence supports them.

The user accepts the possible complete loss of the approved allocation. This capital-risk direction does not weaken operational safety: no leverage, debt, negative-balance strategy, automatic top-up, withdrawal authority, transfer authority, wallet signing, permission bypass or access to other funds is permitted.

Promotion requires objective-path reporting, risk-of-ruin and terminal-wealth analysis, realistic execution costs, survivorship-safe universe reconstruction, walk-forward evidence and a signed risk configuration. The target remains aspirational and must never be represented as promised or probable.

## 2026-07-26 — Conservative deterministic execution model

Use a pure target-weight backtest engine with a strict separation between signal time and later execution time. Model maker and taker fees, observed spread, taker slippage, maker adverse selection, explicit maker non-fill, participation limits, minimum orders, cash reserves and capped square-root price impact.

Do not award automatic spread capture to maker orders. Preserve partial and completely missed executions in the result. Sell reductions before purchases, and scale cash-constrained multi-asset buys proportionally so results do not depend on pair sort order.

The engine and synthetic fixtures validate arithmetic and invariants only. No fee, fill-rate, spread, depth, slippage or impact assumption may support a strategy conclusion until it is versioned and calibrated from time-appropriate venue and pair evidence.

## 2026-07-26 — Objective and ruin-risk scenario analysis

Use a configurable constant-compounding reference path, required-forward-return calculations, target-hit and terminal-target probabilities, terminal-wealth percentiles, maximum-drawdown percentiles and minimum-equity breach probabilities for 50%, 75% and substantially complete loss.

Use deterministic circular block bootstrap only as a dependence-preserving scenario generator. Store the input return series, block length, scenario count, horizon and seed. Scenario frequencies are sensitivity evidence, not forecasts. Promotion still requires after-cost walk-forward returns, final holdout evidence and regime-aware calibration.
