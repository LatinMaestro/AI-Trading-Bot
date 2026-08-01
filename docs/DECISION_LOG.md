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

## 2026-08-01 — Atomic committed universe evidence

Persist each prepared universe-ingestion batch through one transactional nine-statement D1 batch. The content-addressed header declares source, definition, lifecycle-event and quality-observation counts; a database-enforced commit marker is accepted only when those memberships exactly match.

Headers, memberships and commit markers are immutable. Once committed, no new membership may be appended, while an exact retry remains idempotent. Conflicting identity reuse, venue-mismatched membership and partial writes fail closed. A commit marker proves persistence completeness only and grants no strategy-selection, runtime, deployment or order authority.

## 2026-08-01 — Content-addressed Kraken public quality evidence

Use Kraken's official `assetVersion=1` AssetPairs, Ticker and Depth contracts for research-universe source evidence. Hash the exact successful response text and retain its public URL and fetch time before typed parsing.

Reject redirects, unexpected media types, legacy or ambiguous pair keys, malformed envelopes and numeric values, incomplete requested ticker sets, crossed markets, unordered books, unsafe times and non-finite arithmetic. Derive quote turnover from 24-hour base volume and VWAP. Derive spread and conservative two-sided capacity from one coherent L2 book. Candidate impact remains unavailable when displayed depth cannot fill both sides.

This slice stops before scheduled persistence. Complete observations still require committed candle counts, annualised volatility, fresh AUD conversion and official lifecycle evidence. It adds no private endpoint, credential, strategy-selection or order authority.

## 2026-08-01 — Bounded scheduled Kraken universe collection

Run content-addressed public AssetPairs, Ticker and rotating Depth collection inside the lease-protected scheduled cycle before strategy evaluation. Space every HTTP attempt, apply bounded retry and timeout controls, enforce the response-size limit while streaming, and persist only through the database-verified atomic universe boundary.

Missing or ambiguous AUD valuation excludes the affected pair. Malformed, oversized, redirected or conflicting evidence fails the slot. Actual request attempts, selected and skipped counts, and the committed batch identity enter cycle audit evidence.

Until committed D1 candle counts and volatility are joined, observations retain an ineligible history state. The approved BTC/AUD and ETH/AUD strategy path remains separate; this public collection adds no private API, credential, strategy-selection or order authority.


## 2026-08-01 — Signal-time D1 candle-history evidence

Join the bounded Kraken public-universe cycle to immutable committed D1 candles using only evidence recorded and closed by the scheduled signal time. Query 60-minute and 1,440-minute counts and contiguity, retain at most the latest 366 daily closes, and require that sample to end at the latest committed daily candle.

Missing, incomplete, gapped, stale, shifted, future-available or non-finite history fails closed. Compute annualised volatility only from verified contiguous closes. Bind exact history and AUD-conversion provenance into the quality digest, restrict history loading to the bounded selected rotation, and reject material Ticker/Depth time skew.

This evidence supports research-universe quality assessment only. It does not change the approved BTC/AUD and ETH/AUD strategy path or grant strategy-selection, deployment, private-API or order authority.


## 2026-08-01 — Allowlisted official lifecycle evidence

Accept lifecycle declarations only when they bind an exact content digest to a Kraken-owned listing article, support article or status incident/API document. Source class controls permitted event types and geographic scope: regional restrictions cannot become global delistings, and global listing announcements do not prove Australian availability.

Do not derive lifecycle events from free text with a language model or keyword heuristic. Reviewed declarations state canonical pair, event type, scope, effective time and publication time. Future-effective events are knowable once published but apply to reconstruction only at their effective time.

Audit listing, trading-status and Australian-availability coverage independently for every expected pair, and reject declarations outside that audited set. Missing coverage blocks survivorship-safe venue-wide claims. Historical backfill and scheduled immutable raw-source capture remain separate work.

## 2026-08-01 — Daily immutable Kraken lifecycle source capture

At the 00:00 UTC scheduled slot, capture the fixed Kraken asset-listing index, delistings index, status incidents feed and scheduled-maintenance feed before public universe evaluation. Use public HTTPS only, bounded timeout/retry/spacing controls, strict media types, a one MiB streaming ceiling and exact UTF-8 byte round-tripping.

Store each distinct exact payload text once, keyed by its SHA-256 and original byte length. Preserve every fetch as a separate immutable capture binding source kind, exact URL, fetch time, media type and bounded cache headers to that payload. The one MiB ceiling remains below D1's documented two MB string/row limit and permits one bounded statement per payload without JSON expansion.

Persist payloads, capture headers and database-verified commit markers in one D1 transactional batch; reject changed identity reuse, commits before fetch time and ordinary mutation. Raw capture does not create lifecycle events and uses no free-text AI extraction. Individual listing, delisting and regional-availability documents still require deterministic discovery, exact capture and reviewed pair-level declarations. This public evidence capability adds no credential, private API, account, wallet, fund or order authority.

## 2026-08-01 — Deterministic Kraken lifecycle document discovery

Discover candidate lifecycle documents only from the exact preserved Kraken listing and delisting index payloads after verifying their SHA-256 identities again. Parse bounded quoted anchor `href` attributes outside comments and raw-text elements, and accept only source-specific canonical Kraken Blog listing articles, listing-index pagination pages and Kraken Support article targets.

Bind every target to its exact index capture and payload digest, deduplicate and sort deterministically, and content-address the complete discovery result. Reject non-HTTPS, untrusted, queried, fragmented, encoded, cross-index or excessively large link sets.

Do not infer lifecycle meaning from support titles, link text or URL words. Support targets remain generic until reviewed, captured and explicitly classified. This discovery step creates no lifecycle declarations and adds no private endpoint, credential, account, wallet, fund or order capability.


## 2026-07-27 — Near-real-time external intelligence boundary

Collect official announcements, approved news and compliant Reddit observations through webhook, stream or scheduled polling adapters with explicit publication, receipt, availability and assessment times. “Live” means measured near-real-time delivery; source publication and provider delivery delays are never hidden.

An authoritative severe negative event may pause new risk while deterministic market, account and portfolio checks run. Positive news requires authoritative or independent reputable corroboration and can create only a research candidate. Reddit-only and rumour-only evidence remains a watch signal regardless of volume. External intelligence never submits or approves an order.

Reddit access must use approved API access, truthful OAuth identity, current rate limits, minimal permitted retention, deletion handling and no model-training permission. Publisher content requires a versioned licence/retention/attribution contract. Language-model output is an untrusted research draft and cannot cross the deterministic order boundary.


## 2026-07-27 — Immutable external-intelligence evidence and source contracts

Persist each external-intelligence slice as one content-addressed D1 batch containing versioned source contracts, immutable items, append-only corrections, deterministic assessment records, exact memberships and a final database-verified commit marker. Exact retries are idempotent; changed natural identities, source-contract mismatches, invalid chronology or incomplete memberships fail closed.

Every source contract binds provider and publisher identity, allowed acquisition modes, content licence digest, attribution, retention, deletion handling, effective dates and explicit model-use prohibition. Reddit full-content storage remains disabled by default, finite retention and deletion handling are mandatory, and Reddit-only evidence cannot cross the watch boundary.

Corrections, retractions and deletions create new immutable records rather than rewriting prior evidence. Assessments must reproduce exactly from referenced items and policy before persistence. This slice adds no provider connection, credential, collector, queue, private exchange API or order authority.
