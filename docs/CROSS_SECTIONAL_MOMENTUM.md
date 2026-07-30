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
target, retains the exact hourly-close histories used to produce it and
retains position-entry chronology across frames. Verification reruns the
deterministic decision from those histories. A held asset that leaves the
signed universe exits to AUD without a same-signal replacement. The
resulting steps use the
`run-universe-bound-backtest-v1` contract so fees, spread, slippage,
impact, participation and missed-fill assumptions remain outside the
strategy decision.

Plans and reproducible research runs retain the full backtest
configuration and remain content-addressed,
`research-only-unselected`, runtime-disconnected and incapable of
selection, activation or order authority.

## Evaluation orchestration

Content-addressed manifests bind ordered walk-forward training and
validation runs to one strictly later final holdout. Every referenced run
is independently replayed against its retained configuration and exact
plan evidence before inclusion.

Parameter-sensitivity manifests require unique policies, exactly one
baseline and identical configuration, hourly histories, signal-time
membership, market and execution evidence across variants. Variant order
does not affect manifest identity. The manifests deliberately contain no
ranking, winner or selected-policy field and grant no selection,
activation or execution authority.

## Immutable research persistence

Research-run persistence replays the exact retained plan, configuration
and universe-bound engine result before preparing a write. D1 stores the
canonical run plus its plan, configuration, result, policy and exact
signal-time evidence digests. The database independently enforces the
research-only, unchanged-runtime and zero-authority fields; exact retries
preserve first persistence while identity conflicts, mutation and deletion
fail closed.

Evaluation persistence reproduces the complete walk-forward or sensitivity
manifest. Ordered member rows must reference already-persisted runs and
match the exact run, plan, result, policy and evidence identities embedded
in the canonical manifest. A separate immutable commit marker is accepted
only after every declared member exists in canonical order. Persistence
does not rank, select, promote or connect the candidate to runtime.

## Execution and capacity stress

A fixed, content-addressed stress matrix replays the exact final-holdout
plan and run at A$200, A$1,000, A$10,000, A$100,000 and A$1,000,000.
Each capital level is evaluated under baseline, all-maker, all-taker,
double-spread, quarter-liquidity, quarter-maker-fill,
double-taker-slippage and severe-combined scenarios.

The calibration artifact binds the baseline plan and run, its source
digests, availability and expiry, and the complete matrix. Every result
retains transformed configuration, step and result digests plus return,
drawdown, turnover, cost, requested/filled/missed notional and constrained
execution counts. Verification reruns all 40 cells and requires the
A$200 baseline to reproduce the exact final-holdout result.

The stress manifest remains `research-only-unselected`, changes no runtime
scope and grants no selection, activation or execution authority. Synthetic
or expired calibration evidence cannot satisfy production research gates.

## Canonical complete evaluation

The complete-evaluation artifact binds the exact immutable walk-forward
and sensitivity manifests, final-holdout plan/run/result and 40-cell
execution-stress manifest to one canonical `research-report-v1`.

The report requires AUD cash, BTC hold, equal-weight hold and the
five-year objective path; reproduces the final-holdout strategy equity,
return and drawdown; and content-addresses objective-progress and scenario
ruin evidence. A derived execution/capacity summary records turnover,
costs, requested/filled/missed notional, constrained capital levels and
worst stress return, drawdown and missed-fill ratio.

Exact strategy, data, universe, execution, run and manifest provenance is
mandatory. Missing warnings, stale report chronology, evidence drift or
metrics detached from the final holdout fail closed. The artifact contains
no winner or selected-policy field, leaves runtime scope unchanged and
grants no selection, activation or execution authority.

## Remaining evidence

Synthetic tests prove deterministic mechanics and fail-closed invariants only. Promotion evidence still requires:

- authoritative survivorship-safe venue-wide historical data;
- production-calibrated fees, spread, slippage, missed fills and price impact;
- completed walk-forward, final-holdout and parameter-sensitivity results;
- authoritative benchmark, target-attainment, terminal-wealth and ruin inputs;
- persisted canonical complete-evaluation and report evidence; and
- a separately reviewed and signed strategy configuration.
