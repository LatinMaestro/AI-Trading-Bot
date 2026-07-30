# Master build plan

## Phase 0 — Governance and fail-closed foundation

- [x] Create project control documents.
- [x] Define security, venue and live-activation boundaries.
- [x] Scaffold Cloudflare Worker, D1 schema, Kraken adapter interfaces, strategy and risk modules.
- [x] Add baseline CI and forbidden-capability checks.
- [x] Define the five-year aggressive, market-cap-agnostic research mandate.
- [ ] Obtain green exact-head CI and merge the foundation pull request.

## Phase 1 — Market data and deterministic research

- [x] Implement Kraken asset-pair discovery and pair normalisation.
- [x] Add scheduled-cycle leases and order-intent idempotency primitives.
- [ ] Ingest validated daily and hourly OHLC data.
  - [x] Define supported 60-minute and 1,440-minute storage intervals.
  - [x] Wire scheduled public fetches, interval-specific quality gates and persistence.
- [ ] Add idempotent D1 persistence, gap detection and repair.
  - [x] Add immutable hashed batch and candle persistence.
  - [x] Add strict expected-range gap detection and Kraken REST-horizon classification.
  - [ ] Add scheduled gap repair and an approved historical source for data outside Kraken's REST horizon.
    - [x] Scan the exact current 719-committed-row REST window after scheduled persistence, perform at most one bounded overlapping repair capture per pair/interval, and fail closed if any repairable gap remains.
    - [x] Approve Kraken's official downloadable historical OHLCVT archive as the reproducible account-free source beyond the REST horizon, with content-addressed capture and no forward-filling.
    - [ ] Capture and hash exact complete/quarterly archives, validate the BTC/AUD and ETH/AUD CSV members, reconcile REST overlap, and persist derived candles immutably.
      - [x] Add bounded digest-verified sparse CSV validation, exact committed-REST overlap reconciliation, chunked immutable candle/membership persistence and a database-verified commit marker.
      - [x] Add a manual contents-read-only hosted workflow that transiently downloads the exact complete archive, rejects unsafe ZIP membership, validates the four approved CSV members and emits a seven-day digest-only capture manifest.
      - [ ] Run the hosted capture after Actions capacity returns, review the actual archive/member digests, reconcile committed REST overlap and execute the four immutable backfills.
- [ ] Build a dynamic market-cap-agnostic spot universe from current Australian venue metadata.
  - [x] Define immutable versioned market definitions, lifecycle events and quality observations.
  - [x] Reconstruct established, high-volatility and new-listing tiers at historical signal times.
  - [x] Preserve listing, suspension, resumption, delisting, relisting and Australian-availability history.
  - [x] Enforce instrument, freshness, spread, turnover, depth, impact, minimum-order, data-quality and history gates.
  - [x] Prepare deterministic source-provenance ingestion batches.
  - [x] Require explicit official lifecycle evidence; never infer delisting from snapshot absence.
  - [x] Resolve fresh AUD valuation paths and produce tier calibration evidence summaries.
  - [x] Persist prepared metadata, quality, conversion and lifecycle batches atomically with verified commit markers.
  - [x] Wire scheduled venue metadata, quality and conversion fetches into the persistence boundary.
    - [x] Add content-addressed Kraken AssetPairs, Ticker and Depth clients with strict quality parsers.
    - [x] Add bounded rotation, retry/timeout controls, fresh AUD conversion and pre-strategy atomic persistence.
    - [x] Connect committed candle-count and volatility evidence to collected observations.
  - [ ] Establish complete lifecycle-source coverage and signed policy calibration by venue, period and equity scale.
    - [x] Add an allowlisted official-source manifest, future-effective event handling and deterministic coverage audit.
    - [ ] Backfill complete listing, trading-status, delisting and Australian-availability history.
      - [x] Persist immutable partial/complete coverage manifests and keep partial history non-authoritative.
    - [ ] Add scheduled raw-source capture and immutable persistence.
      - [x] Capture and atomically persist the official listing/delisting indexes and status feeds daily.
      - [ ] Discover and capture exact individual listing, delisting and regional-availability documents.
        - [x] Discover canonical listing-index pages, listing articles and support lifecycle documents from preserved index payloads.
        - [ ] Capture and immutably persist discovered index pages and individual documents.
          - [x] Add bounded exact-document capture and immutable D1 persistence linked to discovery provenance.
          - [x] Wire committed-source lookup, recursive index-page discovery and scheduled orchestration.
    - [x] Bind reviewed lifecycle declarations to exact database-committed source payloads before evidence preparation.
      - [x] Re-validate canonical identities, chronology, source-class event types and geographic scope at the committed-evidence boundary.
  - [x] Persist signed policies/snapshots and connect eligible membership to strategy and backtest orchestration.
    - [x] Verify expiring P-256 policy signatures and immutably persist content-addressed snapshots bound to exact committed ingestion evidence.
    - [x] Re-verify exact persisted snapshot availability and membership at decision time, then bind every backtest step and target to that evidence.
    - [x] Bind the same verified membership artifact to runtime strategy-decision orchestration.
    - [x] Persist complete content-addressed runtime decisions with immutable cycle bindings and exact-retry verification.
- [ ] Add near-real-time external intelligence from official sources, news and Reddit.
  - [x] Define deterministic provenance, latency, source-authority, retention and reaction contracts.
  - [x] Prevent Reddit-only/social-only evidence from creating a risk-on candidate.
  - [x] Allow authoritative severe negative events to pause new risk without submitting an order.
  - [x] Persist immutable intelligence items, corrections and assessments.
  - [x] Add a versioned provider/source registry with licence, attribution, retention and model-use rules.
  - [ ] Add official exchange, regulator, issuer and publisher RSS/webhook adapters.
    - [x] Add registry-bound bounded feed polling and authenticated webhook payload acquisition.
    - [x] Add a scheduled SEC press-release RSS manifest and deterministic metadata-only normaliser.
    - [x] Add a scheduled RBA media-release RSS manifest and deterministic metadata-only normaliser.
    - [x] Add a scheduled AUSTRAC media-release RSS manifest and deterministic metadata-only normaliser with retirement monitoring.
    - [x] Add a scheduled Bitcoin Core announcement RSS manifest and deterministic digest-only normaliser.
    - [x] Add a scheduled Ethereum Geth GitHub Releases API manifest and deterministic digest-only normaliser.
    - [x] Add a scheduled CFTC general press-release RSS manifest and deterministic digest-only normaliser.
    - [x] Add a one-minute Kraken active-maintenance Status API manifest and deterministic digest-only normaliser.
    - [ ] Add further approved exchange/issuer/news manifests, source-specific parsing, provider signature implementations and deployed endpoints.
  - [ ] Add compliant Reddit OAuth collection with adaptive rate limits, deletion handling and minimal storage.
    - [x] Add OAuth-only watchlist transport with truthful runtime identity, adaptive header budgets and a maximum 48-hour deletion contract.
    - [x] Add transient minimal post normalisation, bounded `/api/info` deletion checks, retention purge planning and content-free compliance audits.
    - [x] Add purge-enforced transient persistence and downstream watch-state invalidation.
    - [ ] Supply approved hosted credentials and deploy the Reddit collector.
  - [ ] Add dedicated one-minute collection and queue-backed at-least-once processing with idempotency.
    - [x] Bind an inactive-by-default Preview minute Cron, Queue/DLQ producer-consumer and D1 persistence runtime.
    - [x] Generate a content-addressed Preview activation manifest from exact reviewed licence evidence and document owner-gated activation and rollback.
    - [ ] Provision approved hosted Preview resources, install an exact reviewed source contract and activate collection.
    - [x] Add deterministic bounded queue envelopes, per-message acknowledgement/retry and source-level stale outcomes.
    - [x] Persist conditional cache validators durably with monotonic conflict controls.
    - [ ] Bind approved source manifests, minute Cron, Queue/DLQ and the deployed consumer.
  - [x] Add deterministic entity/topic linking, syndication clustering and manipulation controls.
    - [x] Add reviewed entity/topic rules, exact-content syndication clustering and correction-safe representative selection.
    - [x] Add permitted-content near-duplicate/repost clustering and coordinated-manipulation evidence.
  - [x] Integrate `pause-new-risk` into paper-mode risk controls and incident reporting.
  - [x] Backtest news/social features with original publication, receipt, availability and assessment timestamps and no look-ahead.
    - [x] Add content-addressed complete-snapshot replay with reaction expiry, latency evidence and deterministic intent gates.
    - [x] Bind every backtest request to its exact replay frame and suppress paused additions before fill modelling.
    - [x] Persist content-addressed comparative research outputs.
- [ ] Build fee-, spread-, slippage-, missed-fill- and price-impact-aware backtest engine.
  - [x] Add a deterministic pure target-weight rebalancing engine.
  - [x] Attribute maker/taker fees, spread, slippage, adverse selection and square-root price impact.
  - [x] Model participation caps, minimum orders, cash reserves and proportional buy scaling.
  - [x] Preserve partial and completely missed execution outcomes.
  - [ ] Calibrate assumptions by venue, pair, universe tier, equity scale and historical period.
  - [ ] Add exchange-specific precision, tick-size and multi-event order-lifecycle simulation.
- [ ] Add benchmark comparisons: AUD cash, BTC hold, equal-weight hold and the five-year constant-compounding objective path.
  - [x] Add deterministic benchmark builders and aligned return/drawdown summaries.
  - [x] Keep USD objective references separate from AUD comparisons unless FX provenance is supplied.
  - [ ] Calibrate cash returns, prices, historical equal-weight membership and FX inputs.
- [ ] Add target-attainment, terminal-wealth and risk-of-ruin analysis.
  - [x] Add objective-path, progress-status and required-forward-rate calculations.
  - [x] Add terminal-wealth, target-attainment and loss/drawdown scenario summaries.
  - [x] Add reproducible seeded moving-block bootstrap primitives.
  - [ ] Integrate validated walk-forward, holdout, benchmark and sensitivity inputs.
    - [x] Add content-addressed ordered walk-forward/final-holdout and same-period parameter-sensitivity manifests.
    - [x] Persist immutable manifests with exact run memberships and bind their identities into research-report provenance.
    - [x] Add a fail-closed complete final-holdout envelope binding reproduced strategy equity, every evaluation run, mandatory benchmarks, objective progress and scenario ruin evidence without selection.
- [ ] Produce repeatable research reports and signed strategy configurations.
  - [x] Add content-addressed research-report v1 with mandatory provenance, benchmarks and explicit external-intelligence comparison identities.
  - [x] Persist reproducible content-addressed hourly candidate runs and bind their identities into research reports.
  - [x] Bind immutable hourly evaluation-manifest identities into research reports.
  - [x] Content-address the complete hourly final-holdout research evaluation with explicit aspirational-objective, complete-loss and non-promotion warnings.
  - [x] Persist immutable complete-evaluation reports with database-verified bounded chunk commits.
  - [ ] Bind approved strategy configurations to authorised signatures/approval records.
    - [x] Add independently trust-anchored, public-key-only P-256 verification contracts for exact signed configurations and external authorisation statements without committing a selection, approval record, private key or activation authority.
    - [x] Persist verified signed configurations and external authorisation statements immutably with exact committed readiness/evaluation binding, version-identity protection and no activation authority.
    - [x] Add immutable role-scoped signer trust anchors, finite validity, rotation lineage and revocation evidence; require active exact trust before signed-record persistence.
    - [x] Load only an exact signed-configuration digest at an explicit decision time; re-verify active trust, known revocation, configuration/readiness expiry and compact immutable evaluation/report bindings without selection or execution authority.
    - [x] Persist the content-addressed point-in-time verification artifact immutably with independent D1 chronology, revocation-state and evidence-binding enforcement.
    - [x] Add a content-addressed non-activating selection-review proposal that references exact verification and external-authorisation evidence, revalidates role-separated trust and retains no selection, activation or execution authority.
    - [x] Persist exact selection-review proposals immutably with independent D1 verification, authorisation, chronology, role separation, revocation, capital, warning and non-authority enforcement.
    - [x] Load immutable proposals by exact digest at review time, revalidate current trust/revocation/expiry state and bind non-activating signed review receipts to the resulting point-in-time verification digest.
    - [x] Persist exact review-time proposal-verification artifacts and signed review receipts immutably with independent D1 trust, chronology, disposition, identity and non-authority enforcement.
    - [x] Load only exact persisted receipt digests at an explicit owner-decision time, revalidate current evidence and create a content-addressed pending owner decision proposal with no selection or activation authority.
    - [x] Persist exact owner-decision-time receipt verifications and pending proposals immutably with independent D1 chronology, trust, revocation, identity, idempotency and zero-authority enforcement.
    - [x] Load exact persisted owner decision-proposal digests at an explicit owner-review time and produce only an unsigned null-decision template with no selection or activation authority.
  - [x] Add a deterministic Gate B–E readiness assessment that reports authoritative research gaps and external promotion dependencies without selection or approval authority.
  - [x] Persist canonical readiness inputs, assessments and ordered gates immutably; database-bind evidence-present evaluation, calibration and stress identities without promotion authority.

## Phase 2 — Aggressive strategy portfolio

- [ ] Complete venue-wide cross-sectional momentum and relative-strength rotation.
  - [x] Add a deterministic research-only multi-horizon ranking candidate over exact eligible AUD pairs with one-position/AUD-cash semantics, cooldown, hysteresis and zero runtime authority.
  - [x] Bind the candidate to verified signal-time signed-universe membership and execution-aware backtesting.
  - [x] Retain exact hourly histories, replay research runs and content-address ordered walk-forward/final-holdout plus exact-evidence sensitivity manifests without runtime promotion.
- [ ] Add multi-timeframe breakout, volatility-expansion and trend-continuation candidates.
  - [x] Add a pure hourly Donchian/EMA/momentum trend-breakout candidate with one-position/AUD-cash semantics and no runtime promotion.
  - [x] Bind the candidate to exact signal-time universe membership and content-addressed execution-aware backtest plans without runtime promotion.
- [ ] Add separate high-volatility and new-listing strategy lanes.
- [ ] Research short-horizon mean reversion separately after realistic execution modelling.
- [ ] Research external-intelligence features only after provenance, latency and manipulation controls are validated.
- [ ] Test concentrated one-asset and small-portfolio configurations up to 100% gross spot exposure.
- [ ] Test hourly decisions, multiple daily rebalances and maker/taker execution policies.
- [ ] Add volatility targeting and regime-dependent risk allocation without forcing conservative exposure.
- [ ] Reject candidates that fail walk-forward, final holdout, survivorship, capacity or parameter-stability gates.
- [ ] Implement regime classification without external paid AI APIs.
- [ ] Add a strategy ensemble only when it improves out-of-sample five-year objective metrics after costs.

## Phase 3 — Paper execution and accounting

- [ ] Implement paper order book, partial fills and cancellations.
- [ ] Model maker/taker fees, spread, slippage, missed fills, price impact and minimum order sizes.
- [ ] Reconcile simulated positions and cash every cycle.
- [ ] Produce Australian-dollar tax-lot and disposal records.
  - [x] Add deterministic transaction-record and explicit lot-allocation contracts.
  - [x] Add content-addressed CSV/JSON exports and Australian financial-year summaries.
  - [ ] Persist immutable tax records from fills and reconcile them with exchange exports.
  - [ ] Complete professional review of treatment, lot selection, fees, discounts and losses.
- [ ] Add performance, objective-path, drawdown, exposure, turnover and ruin-risk reporting.
- [ ] Demonstrate that aggressive strategies cannot create a negative balance or use more than approved capital.

## Phase 4 — Private operations dashboard

- [ ] Add authenticated private dashboard.
- [ ] Show mode, health, strategy version, positions, pending orders and risk state.
- [ ] Show actual equity against the five-year objective path without presenting it as a forecast.
- [ ] Show probabilities and historical frequencies of substantial or complete capital loss.
- [ ] Show source freshness, ingestion latency, intelligence coverage and rejected/stale evidence.
- [ ] Show all actions required before live activation.
- [ ] Add user-operated emergency stop and credential-revocation guidance.
- [ ] Add export of complete audit and tax records.

## Phase 5 — Scoped exchange integration

- [ ] Implement Kraken authentication and permission introspection.
- [ ] Prove that withdrawal, address-management, deposit and earn permissions are absent.
- [ ] Implement balances, open/closed orders and ledger retrieval.
- [ ] Implement validate-only spot orders.
- [ ] Implement post-only and approved taker-capable spot order creation and cancellation.
- [ ] Implement idempotency, reconciliation and ambiguous-response recovery.
- [ ] Complete an independent security review.

## Phase 6 — Shadow and canary gates

- [ ] Run at least 90 days of paper evidence or a shorter period only with equivalent representative evidence approved in the review gates.
- [ ] Run shadow mode against the actual scoped account.
- [ ] Complete failure injection for API outages, stale data, duplicate schedules, partial fills and D1 errors.
- [ ] Complete tax/accounting review.
- [ ] Approve one signed aggressive strategy configuration and its exact risk envelope.
- [ ] Request explicit canary activation approval.
- [ ] Activate only the approved canary amount.

## Phase 7 — Graduated autonomous operation

- [ ] Require minimum observation periods and evidence before capital increases.
- [ ] Preserve the signed strategy's hard drawdown, loss, permission and reconciliation limits.
- [ ] Add drift detection and automatic return to paper/shadow mode.
- [x] Define severity-based incident, credential-rotation, kill-switch and recovery runbooks.
- [ ] Test runbooks, alert delivery, exchange-side revocation and quarterly rotation.
- [ ] Maintain provider, market-universe, intelligence-source, capacity and fee reviews.
- [ ] Prevent automatic capital top-ups even when the system is behind the five-year path.

## Phase 8 — Adaptive models

- [ ] Add adaptive strategy selection only after deterministic baselines are stable.
- [ ] Train without external paid model APIs where practicable.
- [ ] Version data, features, code, model and decision policy.
- [ ] Require champion/challenger testing and automatic rollback.
- [ ] Never permit a model to bypass the risk engine or execution limits.
- [ ] Never train on Reddit or publisher content without explicit rights and approved provenance.
- [ ] Optimise adaptive selection for after-cost objective attainment and ruin risk, not headline return alone.

## Phase 9 — Objective tracking

- [ ] Report progress against US$200 and US$1,000,000 over the five-year horizon without forecasts presented as promises.
- [ ] Show the year-by-year reference path, required remaining multiple and required forward compound rate.
- [ ] Show drawdown, after-fee return, terminal-wealth distribution, risk of ruin, capacity and tax-adjusted estimates.
- [ ] Attribute deposits and withdrawals separately so they cannot be mistaken for trading performance.
- [ ] Preserve user-controlled withdrawal at the exchange interface; the bot never receives withdrawal authority.
