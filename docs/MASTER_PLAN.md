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
  - [ ] Wire scheduled public fetches, interval-specific quality gates and persistence.
- [ ] Add idempotent D1 persistence, gap detection and repair.
  - [x] Add immutable hashed batch and candle persistence.
  - [x] Add strict expected-range gap detection and Kraken REST-horizon classification.
  - [ ] Add scheduled gap repair and an approved historical source for data outside Kraken's REST horizon.
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
    - [ ] Add scheduled raw-source capture and immutable persistence.
      - [x] Capture and atomically persist the official listing/delisting indexes and status feeds daily.
      - [ ] Discover and capture exact individual listing, delisting and regional-availability documents.
        - [x] Discover canonical listing-index pages, listing articles and support lifecycle documents from preserved index payloads.
        - [ ] Capture and immutably persist discovered index pages and individual documents.
  - [ ] Persist signed policies/snapshots and connect eligible membership to strategy and backtest orchestration.
- [ ] Add near-real-time external intelligence from official sources, news and Reddit.
  - [x] Define deterministic provenance, latency, source-authority, retention and reaction contracts.
  - [x] Prevent Reddit-only/social-only evidence from creating a risk-on candidate.
  - [x] Allow authoritative severe negative events to pause new risk without submitting an order.
  - [x] Persist immutable intelligence items, corrections and assessments.
  - [x] Add a versioned provider/source registry with licence, attribution, retention and model-use rules.
  - [ ] Add official exchange, regulator, issuer and publisher RSS/webhook adapters.
  - [ ] Add compliant Reddit OAuth collection with adaptive rate limits, deletion handling and minimal storage.
  - [ ] Add dedicated one-minute collection and queue-backed at-least-once processing with idempotency.
  - [ ] Add deterministic entity/topic linking, syndication clustering and manipulation controls.
  - [ ] Integrate `pause-new-risk` into paper-mode risk controls and incident reporting.
  - [ ] Backtest news/social features with original publication and receipt timestamps and no look-ahead.
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
- [ ] Produce repeatable research reports and signed strategy configurations.
  - [x] Add content-addressed research-report v1 with mandatory provenance and benchmarks.
  - [ ] Persist reports and bind approved strategy configurations to authorised signatures/approval records.

## Phase 2 — Aggressive strategy portfolio

- [ ] Complete venue-wide cross-sectional momentum and relative-strength rotation.
- [ ] Add multi-timeframe breakout, volatility-expansion and trend-continuation candidates.
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
