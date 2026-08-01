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

Persist accepted committed 60-minute and daily candles as append-only D1 records with deterministic SHA-256 digests. Exact retries are idempotent, but a reused batch or candle identity with different content is a hard conflict. Every candle is additionally required by D1 to match its source batch's venue, symbols, interval and recorded time range. Ordinary updates and deletes are rejected by database triggers so research evidence cannot be silently rewritten.

Kraken REST is not treated as a complete historical archive. Its documented 720-row response includes the current uncommitted row, so gap repair assumes no more than 719 committed intervals remain recoverable. Older gaps must use a separately approved reproducible source, progressive collection or explicit exclusion from research.

## 2026-07-26 — Five-year aggressive mandate

Optimise strategy research for the aspirational objective of growing US$200 toward US$1,000,000 within five years of first authorised live-capital activation. Do not silently substitute a slow multi-decade wealth plan.

The universe is market-cap agnostic and may include approved blue chips, mid-caps, micro-caps and newly listed spot assets. Candidate research may use concentrated positions, up to 100% gross spot exposure, hourly decisions, multiple daily rebalances and maker or taker execution when realistic after-cost evidence supports them.

The user accepts the possible complete loss of the approved allocation. This capital-risk direction does not weaken operational safety: no leverage, debt, negative-balance strategy, automatic top-up, withdrawal authority, transfer authority, wallet signing, permission bypass or access to other funds is permitted.

Promotion requires objective-path reporting, risk-of-ruin and terminal-wealth analysis, realistic execution costs, survivorship-safe universe reconstruction, walk-forward evidence and a signed risk configuration. The target remains aspirational and must never be represented as promised or probable.

## 2026-08-01 — Deterministic execution-aware backtest primitive

Use a pure, runtime-disconnected target-weight engine to model maker/taker fees, spread, adverse selection, taker slippage, square-root price impact, participation limits, minimum orders, cash reserves and explicit missed fills.

Sells execute before buys, cash-constrained buys scale proportionally, and invalid chronology, missing marks, duplicate markets or targets, gross spot targets above 100%, negative cash and short positions fail closed.

Synthetic fixtures prove arithmetic and safety invariants only. Strategy conclusions require time-appropriate venue, pair, universe-tier and equity-scale calibration plus survivorship-safe market evidence. This primitive grants no strategy selection, runtime, deployment or order authority.

## 2026-08-01 — Survivorship-safe dynamic research universe

Use immutable, time-bounded market definitions, lifecycle events and quality observations to reconstruct eligibility strictly from evidence available by each signal time. Classify eligible markets deterministically into established, high-volatility and new-listing tiers, and retain every candidate with explicit reason codes.

TypeScript validation and D1 constraints require lower-case SHA-256 payload digests. Delisting closes a listing era; relisting starts a new era and requires fresh evidence that the market is available in Australia. Synthetic fixtures prove reconstruction invariants only. This research boundary grants no strategy selection, runtime, deployment or order authority.

## 2026-08-01 — Horizon-bound objective and ruin-risk metrics

Use a deterministic constant-compounding reference path for objective progress and report remaining multiple plus required forward rates without treating the path as a forecast.

Separate terminal capital-loss frequency from maximum-drawdown breach frequency. Every scenario must declare a common positive cadence and span exactly the configured five-year objective horizon; equal array length alone is insufficient evidence. Derived non-finite reference values, multiples or compound rates fail closed.

Seeded moving-block bootstrap output is a reproducible scenario-frequency estimate, not a probability promise. It cannot repair survivorship bias, look-ahead leakage, incomplete costs or inadequate market coverage, and grants no strategy-selection or runtime authority.

## 2026-08-01 — Mandatory evidence-bound benchmarks and reports

Every candidate evaluation must include aligned AUD cash, BTC hold, survivorship-safe equal-weight hold and five-year objective-path benchmarks. Tradable benchmarks use AUD. A converted objective path must be built from positive time-aligned FX rates and bind the same lower-case SHA-256 FX source digest recorded in report provenance.

Research reports content-address exact code, data, universe, strategy, execution, objective and benchmark configuration evidence. Objective progress, scenario horizon, probability nesting and percentiles must be internally consistent. A report digest proves content identity only; it grants no approval, selection, activation or order authority.

## 2026-08-01 — Time-correct universe ingestion and AUD valuation

Prepare content-addressed public universe evidence from separately typed metadata, market-quality, official lifecycle and AUD-conversion sources. Definitions and observations may never claim availability before the source fetch that made them knowable. Future-effective official lifecycle events may be retained once published but do not apply before their effective time; snapshot absence never implies delisting.

AUD conversion uses the shortest fresh simple path, rejects missing, multiple, chronologically invalid or numerically invalid paths, and binds every contributing digest. Calibration summaries remain venue-specific evidence and reject mixed venues, duplicate natural identities and conflicting payloads. They do not automatically change policy or grant runtime authority.

## 2026-08-01 — Explicit tax lots and content-addressed exports

Preserve one factual record for every crypto acquisition, disposal, crypto fee, transfer, income, expense or adjustment with a canonical UTC timestamp, the matching Australian local date in a validated Australian IANA time zone, AUD value and source/valuation digests.

Do not choose tax lots automatically. Every disposal must be fully linked to explicit acquisition records through a versioned selection reference before a provisional CGT worksheet is produced. Asset mismatches, later acquisitions, non-reciprocal linked records and over-allocation fail closed.

Export transactions, allocation outcomes and Australian financial-year summaries as deterministic CSV and canonical machine-readable content with one SHA-256 bundle digest. Spreadsheet formula-like text is neutralised. The digest proves content identity only; professional tax review remains mandatory.

## 2026-08-01 — Broad containment, owner-only live recovery

Any authorised responder may stop schedules or activate the kill switch. A responder already authorised for exchange order management may cancel an unexpected open order. Provider-side credential revocation is performed by the owner or provider support.

All SEV-1 and SEV-2 incidents disable live operation and require exchange-authoritative reconciliation, redacted evidence digests, root-cause or capability removal, exact-head validation, paper/shadow regression evidence and no unresolved high-severity issue.

Only the owner may restore live operation. Recovery approval does not increase capital, broaden credentials, approve a new venue or select a different strategy.

