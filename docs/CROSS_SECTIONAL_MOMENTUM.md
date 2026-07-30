# Cross-sectional momentum research candidate

## Status

`cross-sectional-momentum-v0.1.0` is a deterministic research-only candidate. It is not selected, runtime-connected, paper-active or live-capable. The current runtime market scope remains BTC/AUD and ETH/AUD; this module does not change it.

## Evidence boundary

Each decision requires:

- one exact content-addressed universe snapshot identity;
- a sorted, unique, canonical set of eligible AUD spot pairs;
- exactly one complete contiguous hourly close history for every eligible pair;
- a common closed-hour signal timestamp across the entire cross-section; and
- an optional current long position with exact entry chronology.

The candidate fails closed when membership and histories differ, histories are missing, duplicated, non-hourly, invalid or misaligned, the snapshot identity is malformed, or position chronology is future-dated or unaligned.

The current slice consumes an exact eligible membership contract but does not itself load or verify the signed persisted universe snapshot. A later research orchestrator must perform that point-in-time verification and bind the resulting membership artifact before invoking this pure decision function.

## Baseline hypothesis

For each eligible pair, the baseline calculates:

- 24-hour, 168-hour and 720-hour close-to-close momentum;
- a weighted momentum score using 20%, 30% and 50% weights;
- long-window drawdown;
- 24-hour and 720-hour annualised realised volatility; and
- short-versus-long volatility expansion.

An entry requires positive momentum at all three horizons and a weighted score above the configured floor. Eligible assets are ranked deterministically by weighted momentum, with canonical pair order resolving exact ties.

The baseline targets one position at 95% gross exposure and otherwise AUD cash. It applies a 24-hour minimum hold and requires a five-percentage-point score lead before rotating to a new leader. A position that becomes universe-ineligible exits to AUD without same-signal replacement. These values are versioned hypotheses, not approved parameters.

## Non-authority boundary

Every decision is content-addressed and hard-codes:

- candidate status `research-only-unselected`;
- runtime scope unchanged;
- selection, activation and execution authority `none`.

The module cannot submit or approve an order, alter runtime configuration, select a strategy or bypass market-data, universe, liquidity, impact, external-intelligence, signed-policy or risk gates.

## Signal-time backtest binding

Research plans bind every decision to an exact, content-addressed
`universe-signal-time-membership-v1` artifact. The closed-candle decision
time must equal the membership decision time, and the plan preserves the
snapshot, signed-policy and membership digests.

Each verified decision is translated into at most one execution-aware
target and retains position-entry chronology across frames. A held asset
that leaves the signed universe exits to AUD without a same-signal
replacement. The resulting steps use the
`run-universe-bound-backtest-v1` contract so fees, spread, slippage,
impact, participation and missed-fill assumptions remain outside the
strategy decision.

Plans and research runs remain content-addressed,
`research-only-unselected`, runtime-disconnected and incapable of
selection, activation or order authority.

## Remaining evidence

Synthetic tests prove deterministic mechanics and fail-closed invariants only. Promotion evidence still requires:

- authoritative survivorship-safe venue-wide historical data;
- calibrated fees, spread, slippage, missed fills and price impact;
- walk-forward, final-holdout and parameter-sensitivity evaluation;
- benchmarks, target-attainment, drawdown, terminal-wealth and ruin analysis;
- capacity testing across the five-year equity path; and
- a separately reviewed and signed strategy configuration.
