# Objective path and ruin-risk analysis

- The reference path compounds from the configured initial equity to target equity over the configured horizon.
- Progress reports show reference equity, actual/reference ratio, remaining multiple and required monthly/annual compound return.
- Required returns become unavailable when equity is zero or the horizon has expired below target; they are never presented as forecasts.
- Scenario analysis reports target reached at any point, target retained at termination, terminal-wealth percentiles and maximum-drawdown percentiles.
- Loss-risk probabilities use the minimum equity reached in each path: 50% loss, 75% loss and a configurable substantially-complete-loss threshold defaulting to 95%.
- Deterministic circular block bootstrap preserves contiguous return blocks better than independent-period resampling and is reproducible from a stored seed.
- Every path must begin at the configured initial equity and contain finite, non-negative values.
- Bootstrap returns must be finite and greater than -100%; generated paths cannot create debt or negative equity.
- Scenario frequencies are sensitivity estimates, not forecasts or guarantees.
- Promotion still requires survivorship-safe data, after-cost returns, walk-forward/final holdout evidence, regime tests, parameter stability and calibrated execution assumptions.
