# Hourly trend/breakout research candidate

## Status

`hourly-trend-breakout-v0.1.0` is a deterministic research candidate. It is not a selected, promoted, paper-active or live-capable strategy. The existing daily momentum implementation remains the runtime regression baseline until comparative research and every promotion gate pass.

## Baseline policy

- committed 60-minute candles only;
- 168-hour prior Donchian entry channel;
- 72-hour prior Donchian exit channel;
- 200-hour exponential moving average;
- positive 168-hour close-to-close momentum;
- 90% target exposure with the balance remaining in AUD;
- no more than one open directional asset;
- no same-candle rotation after an exit.

Every channel excludes the current closed signal candle. An entry requires the latest close to exceed the prior entry high, remain above the EMA and have positive momentum. Among simultaneous entrants, the highest sum of breakout strength, EMA distance and momentum wins, with canonical pair order breaking exact ties.

An existing position is retained while it remains above its exit channel, EMA and momentum gates. A breach returns the target to AUD cash for that signal; another asset cannot replace it until a later signal. This intentionally creates a low-turnover regression candidate rather than assuming rapid rotation improves after-cost results.

Every decision carries an immutable copy of the exact policy values used, so parameter variants cannot share a strategy version without retaining their complete configuration evidence.

All pair histories must be internally contiguous, bounded to the approved research horizon and close at the same hourly decision timestamp. Candle timestamps identify interval opens, so the bound decision time is exactly one hour after the final committed candle timestamp. Every signal and decision carries that closed-hour timestamp; mixed-time rankings fail closed.

## Universe-bound execution-aware backtest

Research plans bind every decision to one independently verified, content-addressed signal-time universe membership artifact. Both configured BTC/AUD and ETH/AUD histories must remain valid even when one pair is ineligible, preventing malformed excluded data from bypassing evidence checks. Entries are evaluated only across the configured pairs present in exact eligible membership; no eligible pair produces an explicit AUD-cash decision, while a held pair that loses eligibility produces an exit without same-signal rotation.

Each bound decision retains the exact policy, snapshot, signed-policy and membership identities plus the prior target. Complete decisions and the entire plan are content-addressed and independently re-verified before the existing execution-aware engine models fees, spread, slippage, adverse selection, participation, price impact and missed fills. This is research orchestration only and does not promote or connect the candidate to runtime selection.

## Research boundary

The policy values are versioned hypotheses, not evidence of profitability. Before promotion, this candidate requires:

- exact signal-time universe membership;
- research-grade historical hourly candles;
- walk-forward and untouched final-holdout evaluation;
- fee, spread, slippage, missed-fill and price-impact calibration;
- parameter sensitivity across entry, exit, EMA and momentum windows;
- AUD cash, BTC hold, equal-weight and five-year objective benchmarks;
- drawdown, terminal wealth, target-attainment and ruin-risk analysis;
- capacity tests from the initial allocation through the objective path;
- a persisted research report and separately authorised signed configuration.

Each completed candidate evaluation is bound into one reproducible research-run envelope containing the exact plan, execution assumptions and complete result identities. Verification re-runs the universe-bound execution-aware backtest and rejects any changed plan, configuration, result or outer digest. D1 retains only the immutable compact run manifest; research reports reference sorted unique run digests.

The module produces targets only. It does not submit or approve orders, activate paper/live mode, connect credentials or weaken any market-data, liquidity, intelligence, risk or execution gate.
