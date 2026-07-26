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

## 2026-07-26 — Survivorship-safe dynamic universe

Store market definitions, lifecycle events and market-quality observations as immutable hashed records. Reconstruct membership using only definitions and observations available by the historical signal time and lifecycle events both effective and published by that time.

Retain suspended, Australian-disabled and delisted markets in history rather than deleting them from the research dataset. Treat a documented relisting as a new listing era. Conflicting simultaneous states, changed immutable identities and missing chronology fail closed.

Classify eligible assets into established, high-volatility or new-listing lanes using a signed policy. Nominal unit price and current survival do not confer eligibility. Every lane remains subject to instrument, Australian availability, valuation, data-quality, minimum-order, turnover, depth, spread and impact gates.

## 2026-07-26 — Objective and ruin-risk scenario metrics

Use a deterministic constant-compounding reference path for objective progress. Report remaining multiple and required forward rates without treating the path as a forecast.

Separate terminal capital-loss frequency from maximum-drawdown breach frequency. Summarise target attainment, terminal wealth and drawdown percentiles over equal-horizon, equal-cadence scenarios.

Use only seeded, versioned moving-block bootstrap scenarios when resampling is approved. Resampling output is a scenario frequency estimate, not a probability promise, and cannot repair biased universes, look-ahead leakage or unrealistic execution inputs.

## 2026-07-26 — Mandatory benchmarks and content-addressed reports

Every candidate report must include aligned AUD cash, BTC hold, equal-weight hold and objective-path series. Tradable benchmarks share the strategy currency; the USD objective remains separate unless a versioned FX-conversion digest is supplied.

Research-report v1 binds strategy and benchmark series, objective/ruin metrics, evaluation split, exact period, warnings and code/data/universe/configuration provenance into a canonical SHA-256 digest.

The digest proves content identity only. Live approval still requires a separately authorised signed strategy configuration and approval record after validated walk-forward, final-holdout, sensitivity, capacity and tax evidence.

## 2026-07-26 — Universe ingestion and AUD valuation provenance

Prepare scheduled universe evidence as deterministic content-addressed batches. Keep venue metadata, market-quality measurements, official lifecycle announcements and AUD conversion observations as separate source classes with independent fetch times and payload digests.

Do not infer a delisting from a pair being absent from one venue snapshot. Listing, suspension, resumption, delisting and Australian-availability events require explicit official evidence and valid publication chronology.

Convert quote-currency market metrics to AUD only through a fresh, knowable and unambiguous valuation path. Missing, stale or multiple shortest paths fail closed. Calibration summaries are evidence only; they do not automatically alter signed universe limits.

## 2026-07-26 — Explicit tax lots and content-addressed exports

Preserve one factual record for every crypto acquisition, disposal, crypto fee, transfer, income, expense or adjustment with UTC time, Australian local date, AUD value and source/valuation digests.

Do not choose tax lots automatically. Every disposal must be fully linked to explicit acquisition records through a versioned selection reference before a provisional CGT worksheet is produced. Asset mismatches, later acquisitions and over-allocation fail closed.

Export transactions, allocation outcomes and Australian financial-year summaries as deterministic CSV and canonical machine-readable content with one SHA-256 bundle digest. Spreadsheet formula-like text is neutralised. The digest proves content identity only; professional tax review remains mandatory.

## 2026-07-26 — Containment authority and explicit live recovery

Use severity-based incident handling with immediate live disablement for suspected compromise, unexpected or ambiguous orders, unexplained balance drift, immutable-record conflicts and material provider failures.

Containment authority is intentionally broad: an operator may disable schedules, activate the kill switch, revoke affected credentials or cancel unexpected open orders. Restoration authority is narrow: live operation requires complete exchange-authoritative reconciliation, corrective evidence, paper/shadow regression checks and explicit user approval.

Treat every exposed secret as compromised even if it is later deleted. Preserve redacted evidence digests, never secrets. Restore D1 only through an isolated verified recovery that preserves immutable audit, market, universe and tax evidence. Live-recovery approval never authorises a capital increase, broader permission, new venue or different strategy.

## 2026-07-26 — Database-verified universe ingestion commits

Persist each prepared universe-ingestion result through one transactional D1 batch containing the batch header, source digests, immutable definitions/events/observations, record memberships and a final commit marker.

The database permits the commit marker only when actual source and record membership counts match the content-addressed header. Exact retries are idempotent. Changed identity reuse aborts, and transaction rollback prevents orphaned provenance. Ordinary updates and deletes of batch evidence are prohibited.

Only committed batches are complete research evidence. This persistence boundary does not yet fetch scheduled Kraken metadata, ticker/depth quality or AUD conversion inputs and adds no private API or order capability.

## 2026-07-26 — Content-addressed Kraken public quality evidence

Use Kraken's official `assetVersion=1` AssetPairs, Ticker and Depth contracts for scheduled universe source evidence. Hash the exact successful response text and retain its public URL and fetch time before typed parsing.

Reject legacy or ambiguous pair keys, malformed envelopes, incomplete requested ticker sets, crossed markets, unordered books, unsafe times and non-finite arithmetic. Derive quote turnover from 24-hour base volume and VWAP. Derive spread and two-sided capacity from one coherent L2 book. Report candidate impact as unavailable when displayed depth cannot fill both sides rather than inventing a favourable value.

This slice deliberately stops before scheduled persistence. Complete observations still require committed candle counts, annualised volatility, fresh AUD conversion and lifecycle evidence. No private endpoint, credential or order path is added.

## 2026-07-26 — Lease-protected scheduled public universe collection

After the global cycle lease and scheduled-slot claim, fetch Australian Kraken metadata and tickers, rotate a bounded order-book window every 15 minutes, derive fresh AUD-valued quality observations and atomically commit the batch before strategy evaluation.

Use the content-addressed client and quality contracts rather than duplicate parsing. Apply bounded retry, timeout, response-size and request-spacing controls, and record actual HTTP attempts plus the committed batch digest in the cycle audit.

Never infer lifecycle events from current snapshots. Until committed history and volatility evidence are joined, collected observations remain history-incomplete and dynamic-universe eligibility is not authoritative for strategy selection. No private or live-order capability is added.

## 2026-07-26 — Bounded committed universe evidence join

Join the bounded public pair set with exact committed daily/hourly candle counts, latest committed timestamps, annualised volatility and fresh AUD conversion evidence before authoritative persistence.

Require exact pair coverage, complete and knowable history, limited ticker/depth skew, sufficient two-sided displayed depth and lifecycle evidence constrained to the selected set. Missing, stale, mismatched or ambiguous evidence aborts the batch.

Bind only used ticker, depth, candle and conversion evidence into a deterministic quality-manifest digest, then submit one complete input to the fixed nine-statement atomic repository. The scheduled cycle must switch from its history-gap collection path only after D1-backed evidence providers are connected.
