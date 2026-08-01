# Risk policy

## Purpose

The user accepts that the complete explicitly approved trading allocation may be lost in pursuit of the five-year objective. The system must therefore permit aggressive capital-risk research without allowing software, credential or provider failures to create a larger loss, debt, unauthorised transfer or access to unrelated assets.

The authoritative objective and strategy interpretation is in `docs/FIVE_YEAR_AGGRESSIVE_MANDATE.md`.

## Non-negotiable operational limits

These limits apply to every strategy and cannot be relaxed by a high return target:

- spot positions only;
- no leverage, margin, derivatives, borrowing, lending, staking or shorting;
- no negative-balance or liability-creating strategy;
- no withdrawal, transfer, deposit, address-management or wallet-signing authority;
- approved venue, account and universe only;
- no automatic capital top-up;
- no order when data, permissions, balances, prior orders or reconciliation state are stale, incomplete, inconsistent or ambiguous;
- every order must satisfy venue precision, minimums, idempotency and maximum price-deviation rules;
- the risk engine remains authoritative over every strategy or model.

## Aggressive research envelope

Research and paper modes must test materially more aggressive candidates than the conservative foundation baseline, including:

- up to 100% gross spot exposure, retaining only any cash required for fees and settlement;
- a single concentrated asset or a small portfolio of the strongest ranked assets;
- venue-wide, market-cap-agnostic spot eligibility, including micro-caps and newly listed assets that pass explicit liquidity and data gates;
- hourly decisions and multiple portfolio changes per day;
- maker or taker execution when the expected after-cost edge justifies the cost and fill risk;
- wider drawdown tolerance and faster rotation than the initial foundation limits;
- separate candidate configurations for established assets, high-volatility assets and newly listed assets.

Nominal token price is not a risk measure. Liquidity, spread, depth, turnover, volatility, listing history, price impact and data integrity are authoritative.

## Current implementation defaults

The existing foundation limits remain fail-closed implementation defaults until the backtest, paper and review gates approve a signed aggressive configuration. They must not be treated as the final strategy mandate or used to justify a slow multi-decade plan.

Current defaults are:

- maximum 90% gross crypto exposure;
- minimum 10% AUD cash buffer;
- one active directional asset;
- maximum one rebalance in 24 hours;
- post-only limit orders by default;
- maximum 2% price deviation from the current validated reference price;
- 5% daily loss pause;
- 10% rolling seven-day loss pause;
- 15% high-water-mark drawdown kill switch;
- 12% trailing adverse-move forced exit.

Changing the live-capable values requires a reviewed decision-log entry, a signed strategy configuration and the applicable activation gate. Research may test much wider values without enabling live execution.

## Required aggressive-risk analysis

Each candidate must report:

- probability and historical frequency of 50%, 75% and substantially complete capital loss;
- maximum drawdown and time under water;
- target-attainment probability and terminal-wealth percentiles;
- sensitivity to single-asset concentration, turnover, spread, slippage and missed fills;
- capacity limits as equity grows from the initial allocation;
- performance during exchange outages, suspensions, delistings and liquidity shocks;
- results under candidate portfolio drawdown responses, including 25%, 40%, 60% and 80% thresholds.

A backtest reaching US$1,000,000 is insufficient if it depends on unavailable assets, survivorship bias, impossible fills, hidden leverage, fragile parameters or unbounded operational risk.

## Position sizing

A promoted configuration may use concentrated or full spot exposure only when:

- the asset and pair pass the applicable universe, liquidity and data-quality gates;
- modelled spread, fees, slippage and price impact leave positive expected edge;
- sufficient exchange balance remains to pay fees and avoid a negative account balance;
- the exact concentration and exit policy are versioned and approved;
- the resulting risk remains limited to the approved trading capital.

## Drawdown response

Every promoted strategy must define deterministic warning, pause, risk-reduction and kill states. Aggressive configurations may tolerate materially deeper market drawdowns than the foundation default, but may not disable observability, reconciliation, incident alerts or the exchange-side kill procedure.

A reset after an operational kill state or an unapproved live drawdown threshold remains an explicit user decision.

## Capital increases

No automatic capital top-up is permitted. Each increase requires explicit approval after reviewing live performance, target-path progress, drawdown, risk of ruin, operational incidents, fees, slippage and tax-record completeness.