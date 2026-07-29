# Strategy research plan

## Research objective

The research programme must optimise for the aspirational five-year US$200-to-US$1,000,000 objective defined in `docs/FIVE_YEAR_AGGRESSIVE_MANDATE.md`. It must not quietly substitute a low-turnover multi-decade plan merely because that produces a smoother equity curve.

The target requires extreme compound returns and may result in complete loss of the approved capital. Strategy reports must therefore evaluate both target-attainment opportunity and risk of ruin after realistic execution costs.

## Why the first baseline remains deterministic

A transparent deterministic baseline makes defects, leakage, cost assumptions and parameter fragility easier to identify than an opaque model. It is a benchmark and control experiment, not the final intended risk profile.

With only US$200, minimum order sizes, spread and fees can dominate results. As equity grows, capacity and price impact become more important. Every strategy must model both conditions.

## Dynamic market-cap-agnostic universe

Universe membership must be reconstructed from time-appropriate venue metadata rather than a present-day asset list. The system may consider any approved Australian-available spot asset, including blue chips, mid-caps, micro-caps and newly listed assets.

The universe is divided into separately evaluated lanes:

1. **Established:** sufficient daily and hourly history for full walk-forward evaluation.
2. **High volatility:** established enough for evaluation but exhibiting materially elevated volatility or momentum.
3. **New listing:** limited history, separately modelled listing-date, liquidity-discovery and delisting risks.

Each lane requires explicit online status, listing date, supported quote/AUD valuation, precision, minimums, spread, liquidity, price-impact and data-quality evidence. Leveraged, inverse and derivative-wrapper tokens are excluded.

The deterministic contract is defined in `docs/MARKET_UNIVERSE.md`. Every signal-time snapshot must use only definitions and quality observations available by that time and lifecycle events both effective and published by that time. Suspended, Australian-disabled and delisted markets remain in the evidence set but are ineligible; a later relisting starts a new listing era. Tier boundaries and market-quality limits are signed policy inputs, not fixed claims about market behaviour. Every evaluated run must bind the exact verified `signedPolicySha256` and persisted `snapshotSha256` available at its signal time; recomputed, unsigned or later snapshots are not interchangeable evidence.

Backtests must load that exact persisted snapshot by digest, re-verify the signed policy and manifest, and prove that persistence and freshness precede the decision. Every step carries one content-addressed membership artifact. Positive target weights outside its sorted eligiblePairs fail closed, while omitted or zero targets remain available to reduce or exit positions that later became ineligible. Complete membership identities are retained in result provenance.

Runtime decisions use the same membership artifact selected by one exact configured snapshot digest. Only the sorted intersection of configured pairs and verified eligible membership reaches the deterministic strategy. The proposed decision, policy, snapshot and membership identities form one content-addressed binding retained by the cycle audit; a missing selector or changed binding fails closed.

## Baseline A — venue-wide relative-strength rotation

For each established or high-volatility candidate:

1. Load complete committed daily and hourly candles for the applicable research window.
2. Apply time-appropriate universe membership and data-quality gates.
3. Calculate multi-horizon momentum, trend strength, volatility expansion, drawdown and liquidity features.
4. Rank candidates cross-sectionally rather than assuming BTC, ETH or SOL are always the only eligible assets.
5. Test one-asset and small-portfolio concentration policies up to 100% gross spot exposure.
6. Test hourly evaluation and multiple daily rebalance policies with cooldown and hysteresis variants.
7. Use AUD or an approved low-risk quote asset only when no candidate has positive expected after-cost edge.

The existing narrow daily momentum implementation remains a regression baseline until this wider strategy is implemented.

## Candidate B — hourly Donchian/EMA momentum trend/breakout

The first separately versioned breakout candidate is defined in `docs/HOURLY_TREND_BREAKOUT.md`. It uses committed hourly candles, prior-candle Donchian entry/exit channels, an hourly EMA trend gate and positive hourly momentum. It permits one long position at a time and otherwise targets AUD cash.

The initial policy uses 168-hour entry, 72-hour exit, 200-hour EMA and 168-hour momentum windows with 90% target exposure. These are research hypotheses, not selected parameters. A held position is preserved until an exit gate breaches, and an exit returns to cash for at least the current signal rather than rotating immediately. This provides a deterministic low-turnover trend/breakout control for later after-cost walk-forward comparison.

The candidate now has research-only orchestration that validates both configured histories, binds each decision to exact verified signal-time universe membership, preserves explicit AUD-cash and eligibility-loss exit decisions, and passes only re-verified content-addressed plans into the existing execution-aware backtest engine. It is not connected to runtime decisions, paper trading or live execution. Promotion still requires authoritative historical data, calibrated execution assumptions, walk-forward and final-holdout evidence, parameter sensitivity, mandatory benchmarks, ruin analysis and a signed configuration.

## Candidate strategy families

Research separately before combining:

- multi-timeframe breakout and volatility expansion;
- trend continuation with rapid leadership rotation;
- high-volatility momentum;
- new-listing momentum and post-listing stabilisation;
- short-horizon mean reversion where spread and fill evidence supports it;
- regime-dependent allocation among already approved deterministic strategies.

Do not blend candidates into an ensemble until each has independent walk-forward and final holdout evidence.

## Execution-aware backtesting

Every strategy must model:

- current and historical maker/taker fee schedules where reproducible;
- bid/ask spread rather than close-price fantasy fills;
- post-only non-fill and adverse-selection risk;
- taker slippage and market impact;
- partial fills, cancellations, missed entries and ambiguous responses;
- venue precision, tick size, minimum volume and minimum quote cost;
- fee reserves and prevention of negative balances;
- growing capacity from US$200 toward the objective path;
- listing, suspension, delisting and unavailable-market behaviour;
- Australian-dollar conversion and tax-event generation.

The initial pure calculation contract is defined in `docs/BACKTEST_EXECUTION_MODEL.md`. Its deterministic engine preserves fees, spread, slippage, adverse selection, capacity, price impact and missed fills, but its synthetic assumptions are not research evidence. Each run must replace them with versioned, time-appropriate calibration data before results may support strategy promotion.

## Evaluation requirements

Every candidate strategy must include:

- no look-ahead or survivorship leakage;
- expanding or rolling walk-forward evaluation;
- untouched final holdout data;
- AUD cash, BTC hold, equal-weight hold and five-year objective-path benchmarks;
- after-fee and after-slippage compound return;
- target-attainment frequency under approved historical and resampling tests;
- median and percentile terminal wealth;
- probability of 50%, 75% and substantially complete capital loss;
- turnover, maximum drawdown, time under water and recovery behaviour;
- parameter sensitivity and block/bootstrap or other approved dependence-preserving resampling;
- results across bull, bear, sideways, liquidity-shock and exchange-outage regimes;
- capacity and price-impact sensitivity at progressively larger equity levels.

Resampling output is a scenario estimate, not a forecast or guarantee.

## Adaptive model phases

Later phases may use a contextual bandit or a small supervised model to choose among pre-approved strategies. The model must not directly create unconstrained orders, bypass the deterministic risk engine or use paid inference APIs unless separately approved.

## Rejection rules

Reject a strategy that:

- derives most performance from assets that were not actually tradable at the simulated time;
- relies on survivorship-biased universe membership, one lucky listing or one short regime without stable evidence;
- loses its advantage after realistic fees, spread, slippage, missed fills and price impact;
- requires unavailable liquidity or impossible fills;
- creates negative balances, hidden leverage or exposure beyond approved capital;
- has unstable parameters or collapses in the final holdout;
- has a target-attainment result driven only by a tiny number of irreproducible paths;
- cannot scale as equity grows;
- cannot be reproduced from versioned data, universe membership, code and configuration.
