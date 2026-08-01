# Master build plan

## Phase 0 — Governance and fail-closed foundation

- [x] Create project control documents.
- [x] Define security, venue and live-activation boundaries.
- [x] Scaffold Cloudflare Worker, D1 schema, Kraken adapter interfaces, strategy and risk modules.
- [x] Add baseline CI, forbidden-capability checks and current-tree secret scanning.
- [x] Define the five-year aggressive, market-cap-agnostic research mandate.
- [x] Obtain green exact-head CI and merge the foundation pull request.
- [x] Add security-operations and incident-response runbooks with owner-only recovery gates.
- [ ] Record quarterly revocation, backup/restore, alert and kill-switch drill evidence.

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
  - [x] Define immutable time-bounded market definitions, lifecycle events and quality observations.
  - [x] Add deterministic established, high-volatility and new-listing research tiers.
  - [x] Reconstruct listing, suspension, delisting, relisting and Australian availability without look-ahead.
  - [x] Enforce spread, liquidity, price-impact, order-minimum, data-quality and instrument-type gates.
  - [x] Add content-addressed ingestion, fresh AUD-valuation and venue-specific calibration contracts.
  - [x] Persist each prepared universe batch atomically with verified commit markers and frozen memberships.
  - [ ] Ingest authoritative venue metadata and official lifecycle evidence on schedule.
    - [x] Add content-addressed Kraken AssetPairs, Ticker and Depth clients with strict fail-closed quality parsers.
    - [x] Schedule bounded rotating public collection and atomic persistence with incomplete history explicitly marked ineligible.
    - [x] Join committed candle and volatility evidence from D1 at the exact signal time.
    - [x] Add an allowlisted official-source manifest, future-effective event handling and deterministic coverage audit.
    - [ ] Backfill complete listing, trading-status, delisting and Australian-availability history.
    - [x] Add scheduled raw-source capture and immutable persistence.
      - [x] Discover canonical listing-index pages, listing articles and support lifecycle documents from preserved index payloads.
      - [x] Add bounded exact-document capture and immutable D1 persistence linked to discovery provenance.
      - [x] Wire committed-source lookup, recursive index-page discovery and scheduled orchestration.
    - [ ] Complete authoritative lifecycle coverage and promote only signed, evidence-complete universe snapshots.
  - [ ] Support complete Australian-dollar valuation paths for every researched pair.
  - [ ] Persist signed universe policies and content-addressed snapshots.
- [ ] Add near-real-time external intelligence from official sources, news and Reddit.
  - [x] Define deterministic provenance, latency, source-authority, retention and reaction contracts.
  - [x] Prevent Reddit-only/social-only evidence from creating a risk-on candidate.
  - [x] Allow authoritative severe negative events to pause new risk without submitting an order.
  - [x] Persist immutable intelligence items, corrections and assessments.
  - [x] Add a versioned provider/source registry with licence, attribution, retention and model-use rules.
  - [x] Add registry-bound bounded feed polling and authenticated webhook payload acquisition.
  - [ ] Add approved source manifests, source-specific parsing, provider signature implementations and deployed endpoints.
    - [x] Add a scheduled SEC press-release RSS manifest and deterministic metadata-only normaliser.
    - [x] Add a scheduled RBA media-release RSS manifest and neutral metadata normaliser.
    - [x] Add a one-minute Kraken active-maintenance Status API manifest and deterministic digest-only normaliser.
    - [ ] Add further approved source manifests, source-specific parsing, provider signature implementations and deployed endpoints.
  - [ ] Add compliant Reddit OAuth collection with adaptive rate limits, deletion handling and minimal storage.
    - [x] Add OAuth-only watchlist acquisition with truthful runtime identity, active-contract checks, shared capture identity, adaptive header budgets and a maximum 48-hour deletion contract.
    - [x] Add minimal transient post normalisation and provider-deletion/retention reconciliation.
    - [x] Add purge-enforced transient persistence and downstream invalidation.
    - [ ] Supply approved hosted credentials and deploy the Reddit collector.
  - [x] Add deterministic bounded queue envelopes, per-message acknowledgement/retry and source-level stale outcomes.
  - [x] Persist conditional cache validators durably with monotonic conflict controls.
  - [ ] Bind approved source manifests, minute Cron, Queue/DLQ and the deployed consumer.
  - [ ] Add deterministic entity/topic linking, syndication clustering and manipulation controls.
  - [ ] Integrate `pause-new-risk` into paper-mode risk controls and incident reporting.
  - [ ] Backtest news/social features with original publication and receipt timestamps and no look-ahead.
- [ ] Research external-intelligence features only after provenance, latency and manipulation controls are validated.

- [ ] Build fee-, spread-, slippage-, missed-fill- and price-impact-aware backtest engine.
  - [x] Add a deterministic pure target-weight rebalancing engine.
  - [x] Attribute maker/taker fees, spread, slippage, adverse selection and square-root price impact.
  - [x] Model participation caps, minimum orders, cash reserves and proportional buy scaling.
  - [x] Preserve partial and completely missed execution outcomes.
  - [ ] Calibrate assumptions by venue, pair, universe tier, equity scale and historical period.
  - [ ] Add exchange-specific precision, tick-size and multi-event order-lifecycle simulation.
- [ ] Add benchmark comparisons: AUD cash, BTC hold, equal-weight hold and the five-year constant-compounding objective path.
  - [x] Add deterministic aligned equity-series builders and comparisons.
  - [x] Bind converted objective paths to time-aligned FX rates and their source digest.
  - [x] Add content-addressed research-report v1 provenance.
  - [ ] Populate reports from authoritative walk-forward, holdout and sensitivity evidence.
- [ ] Add target-attainment, terminal-wealth and risk-of-ruin analysis.
  - [x] Add objective-path, progress-status and required-forward-rate calculations.
  - [x] Add terminal-wealth, target-attainment and loss/drawdown scenario summaries.
  - [x] Add reproducible seeded moving-block bootstrap primitives.
  - [x] Bind scenario cadence and horizon exactly to the five-year objective.
  - [ ] Integrate validated walk-forward, holdout, benchmark and sensitivity inputs.
- [ ] Produce repeatable research reports and signed strategy configurations.

## Phase 2 — Aggressive strategy portfolio

- [ ] Complete venue-wide cross-sectional momentum and relative-strength rotation.
- [ ] Add multi-timeframe breakout, volatility-expansion and trend-continuation candidates.
- [ ] Add separate high-volatility and new-listing strategy lanes.
- [ ] Research short-horizon mean reversion separately after realistic execution modelling.
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
- [ ] Add incident runbooks and periodic credential rotation.
- [ ] Maintain provider, market-universe, intelligence-source, capacity and fee reviews.
- [ ] Prevent automatic capital top-ups even when the system is behind the five-year path.

## Phase 8 — Adaptive models

- [ ] Add adaptive strategy selection only after deterministic baselines are stable.
- [ ] Train without external paid model APIs where practicable.
- [ ] Version data, features, code, model and decision policy.
- [ ] Require champion/challenger testing and automatic rollback.
- [ ] Never permit a model to bypass the risk engine or execution limits.
- [ ] Optimise adaptive selection for after-cost objective attainment and ruin risk, not headline return alone.

## Phase 9 — Objective tracking

- [ ] Report progress against US$200 and US$1,000,000 over the five-year horizon without forecasts presented as promises.
- [ ] Show the year-by-year reference path, required remaining multiple and required forward compound rate.
- [ ] Show drawdown, after-fee return, terminal-wealth distribution, risk of ruin, capacity and tax-adjusted estimates.
- [ ] Attribute deposits and withdrawals separately so they cannot be mistaken for trading performance.
- [ ] Preserve user-controlled withdrawal at the exchange interface; the bot never receives withdrawal authority.
- [ ] Never train on Reddit or publisher content without explicit rights and approved provenance.
