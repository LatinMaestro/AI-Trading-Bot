# Master build plan

## Phase 0 — Governance and fail-closed foundation

- [x] Create project control documents.
- [x] Define security, venue and live-activation boundaries.
- [x] Scaffold Cloudflare Worker, D1 schema, Kraken adapter interfaces, strategy and risk modules.
- [x] Add baseline CI and forbidden-capability checks.
- [ ] Obtain green exact-head CI and merge the foundation pull request.

## Phase 1 — Market data and deterministic research

- [x] Implement Kraken asset-pair discovery and pair normalisation.
- [x] Add scheduled-cycle leases and order-intent idempotency primitives.
- [ ] Ingest validated daily and hourly OHLC data.
- [ ] Add idempotent D1 persistence, gap detection and repair.
- [ ] Build fee/slippage-aware backtest engine.
- [ ] Add benchmark comparisons: AUD cash, BTC hold and equal-weight hold.
- [ ] Produce repeatable research reports and signed strategy configurations.

## Phase 2 — Strategy portfolio

- [ ] Complete momentum rotation baseline.
- [ ] Add volatility targeting and trend-strength filter.
- [ ] Research mean-reversion and breakout candidates separately.
- [ ] Reject candidates that fail walk-forward or stability gates.
- [ ] Implement regime classification without external paid AI APIs.
- [ ] Add strategy ensemble only when it improves out-of-sample results.

## Phase 3 — Paper execution and accounting

- [ ] Implement paper order book, partial fills and cancellations.
- [ ] Model maker/taker fees, spread, slippage and minimum order sizes.
- [ ] Reconcile simulated positions and cash every cycle.
- [ ] Produce Australian-dollar tax-lot and disposal records.
- [ ] Add performance, drawdown, exposure and turnover reporting.

## Phase 4 — Private operations dashboard

- [ ] Add authenticated private dashboard.
- [ ] Show mode, health, strategy version, positions, pending orders and risk state.
- [ ] Show all actions required before live activation.
- [ ] Add user-operated emergency stop and credential-revocation guidance.
- [ ] Add export of complete audit and tax records.

## Phase 5 — Scoped exchange integration

- [ ] Implement Kraken authentication and permission introspection.
- [ ] Prove that withdrawal, address-management, deposit and earn permissions are absent.
- [ ] Implement balances, open/closed orders and ledger retrieval.
- [ ] Implement validate-only spot orders.
- [ ] Implement post-only limit order creation and cancellation.
- [ ] Implement idempotency, reconciliation and ambiguous-response recovery.
- [ ] Complete an independent security review.

## Phase 6 — Shadow and canary gates

- [ ] Run at least 90 days of paper evidence or a shorter period only with equivalent representative evidence approved in the review gates.
- [ ] Run shadow mode against the actual scoped account.
- [ ] Complete failure injection for API outages, stale data, duplicate schedules, partial fills and D1 errors.
- [ ] Complete tax/accounting review.
- [ ] Request explicit canary activation approval.
- [ ] Activate only the approved canary amount.

## Phase 7 — Graduated autonomous operation

- [ ] Require minimum observation periods and evidence before capital increases.
- [ ] Preserve hard drawdown and loss limits.
- [ ] Add drift detection and automatic return to paper/shadow mode.
- [ ] Add incident runbooks and periodic credential rotation.
- [ ] Maintain provider and fee reviews.

## Phase 8 — Adaptive models

- [ ] Add adaptive strategy selection only after deterministic baselines are stable.
- [ ] Train without external paid model APIs where practicable.
- [ ] Version data, features, code, model and decision policy.
- [ ] Require champion/challenger testing and automatic rollback.
- [ ] Never permit a model to bypass the risk engine or execution limits.

## Phase 9 — Objective tracking

- [ ] Report progress against US$200 and US$1,000,000 without forecasts presented as promises.
- [ ] Show required remaining multiple, drawdown, after-fee return and tax-adjusted estimates.
- [ ] Preserve user-controlled withdrawal at the exchange interface; the bot never receives withdrawal authority.
