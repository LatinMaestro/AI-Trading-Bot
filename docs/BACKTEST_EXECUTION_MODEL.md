# Backtest execution and cost model

## Scope

This Phase 1 slice defines a deterministic, pure TypeScript calculation engine for testing target-weight spot strategies against explicit execution assumptions.

It does not fetch market data, choose assets, place exchange orders, create credentials, deploy infrastructure or activate capital. Strategy code supplies time-ordered target allocations; the engine applies a reproducible execution model and returns an after-cost equity curve, executions, positions and cost attribution.

The engine is a calculation primitive, not evidence that any strategy can meet the five-year objective. Research conclusions remain prohibited until every assumption is calibrated from time-appropriate venue and market data.

## Input contract

Each backtest step contains:

- the timestamp when the strategy signal became knowable;
- a strictly later execution timestamp;
- one canonical market record per required pair;
- the mid price in Australian dollars;
- the contemporaneous bid/ask spread in basis points;
- available quote-volume capacity in Australian dollars;
- target spot weights from 0% to 100%; and
- a maker or taker execution policy for each target.

Execution timestamps must be strictly increasing. A held position must have a valid mark at every step. Duplicate markets, duplicate targets, missing target markets, non-finite values, negative costs and gross target weights above 100% fail closed.

An intelligence-aware run must bind exactly one verified replay frame to every step. The frame decision time must equal the signal time. Partial coverage, duplicate frame reuse, malformed evidence identities and replay/frame digest mismatch fail closed.

The separation between signal time and execution time prevents a strategy from using the same observation as both the decision input and a guaranteed fill. Historical data construction must still prove that every feature and universe-membership record was available at signal time.

## Execution sequence

For each step the engine:

1. marks existing positions at the supplied mid prices;
2. calculates target notionals from pre-trade equity;
3. creates sell requests for reductions and exits;
4. executes sells before buys so rotations can fund replacement positions;
5. calculates capacity- and cash-constrained buy limits;
6. scales multiple buy requests proportionally when fees or the cash reserve make the full target set unaffordable;
7. removes buy requests before fill modelling when the bound frame contains active `pause-new-risk` evidence, while preserving sells;
8. records each suppression separately from filled, partially filled and missed executions; and
9. marks the resulting portfolio and updates drawdown.

The engine never creates a negative cash balance, negative asset position, short exposure or more than 100% gross spot target exposure.

## Fee, spread and slippage model

All rates are configurable in basis points and must be versioned with a research run.

### Taker execution

A taker buy pays, and a taker sell loses:

- half of the observed bid/ask spread;
- configured taker slippage; and
- modelled price impact.

The applicable taker fee is charged on executed notional.

### Maker execution

The initial maker model deliberately does not award an automatic half-spread profit. A maker fill is charged:

- the configured maker fee;
- configured adverse-selection cost; and
- modelled price impact.

A deterministic maker fill-rate assumption between 0 and 1 controls how much of the requested notional may fill. The unfilled amount is retained as missed notional rather than silently treated as executed.

This is intentionally conservative. Any future spread-capture credit requires order-book and queue-position evidence and must be introduced as a separately reviewed model.

## Capacity and price impact

Filled reference notional is limited by:

- requested target-change notional;
- available quote volume multiplied by the configured maximum participation rate;
- the maker fill-rate assumption for maker orders;
- held units for sells;
- available cash after the configured reserve for buys; and
- the configured minimum order value.

The initial impact function is:

`impact bps = min(maximum impact bps, coefficient bps × sqrt(filled reference notional / available quote volume))`

The square-root form makes costs rise as a trade consumes more of the measured market capacity. Its coefficient and cap are assumptions, not universal facts. They must be calibrated separately by venue, pair, universe tier, equity scale and historical period.

## Cost attribution and outputs

Every execution records:

- requested, filled and missed notional;
- fill status;
- side and execution style;
- reference mid and modelled execution price;
- units;
- fee cost;
- spread cost;
- slippage or adverse-selection cost; and
- impact cost and impact basis points.

The result includes:

- initial and final equity;
- after-cost total return;
- maximum drawdown;
- turnover relative to average equity;
- the complete execution ledger;
- the equity curve;
- final positions; and
- aggregate fees, spread, slippage, impact and missed-fill notional.

Intelligence-aware output additionally records every gated frame and suppressed buy request with signal/execution time, pair, style, requested AUD notional and exact pause-evidence identities. A content-addressed comparison runs identical steps with and without intelligence gates and reports equity/return deltas, suppression counts/notional and observed pause/research-candidate frame counts.

## Required calibration before strategy conclusions

A research run may not label its results realistic unless it versions and evidences:

- the venue and historical maker/taker fee schedule applicable at each simulated time;
- pair- and time-specific spread observations;
- quote-volume or depth measurements at the relevant decision horizon;
- maker fill rates and adverse selection from reproducible evidence;
- taker slippage and impact coefficients across order sizes;
- venue precision, tick size, minimum volume and minimum quote cost;
- listing, suspension and delisting state at signal and execution time;
- Australian-dollar valuation paths; and
- stress scenarios with wider spreads, lower depth, worse fills and higher fees.

Synthetic fixtures validate arithmetic and invariants only. They do not validate profitability, target-attainment probability or live suitability.

## Known limitations and next work

This slice does not yet model:

- order-book queue position;
- intra-bar order expiry, cancellation or replacement;
- exchange-specific tick and volume quantisation;
- partial-fill timing across multiple events;
- ambiguous exchange responses;
- dynamic historical universe membership;
- tax-lot generation;
- walk-forward orchestration;
- five-year target-attainment or risk-of-ruin resampling.

Those remain separate plan items. The paper execution phase must later reconcile this research model against a full simulated order lifecycle.

## Validation evidence

The focused test harness proves:

- costless buy-and-hold control behaviour;
- explicit taker fee, spread, slippage and impact attribution;
- maker partial and completely missed fills;
- thin-market participation limits and square-root impact;
- sell-before-buy rotations;
- preservation of a cash reserve and non-negative balances;
- proportional multi-asset buy scaling; and
- rejection of look-ahead timestamps, gross exposure above 100% and missing marks.
