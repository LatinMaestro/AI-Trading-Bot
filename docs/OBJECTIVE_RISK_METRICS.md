# Objective-path and scenario-risk metrics

## Scope

`src/research/objectiveMetrics.ts` provides deterministic calculations for the five-year objective and scenario analysis. It does not forecast returns, select strategies, access an exchange or enable live trading.

## Objective path

The reference path compounds from the configured initial equity to the configured target over the configured horizon. For the mandate, this is US$200 to US$1,000,000 over 60 months.

Progress output includes:

- reference equity at elapsed time;
- actual-to-reference ratio;
- remaining target multiple;
- required forward monthly and annual compound rates; and
- `ahead`, `behind`, `on-path`, `met`, `expired` or `ruined` status.

USD objective reporting and AUD accounting must remain explicitly separated. Currency conversion inputs must be versioned before combining them in reports.

## Scenario analysis

Scenario paths must:

- use unique identifiers;
- start at the configured initial equity;
- contain non-negative finite equity values;
- declare the same positive cadence;
- span exactly the configured objective horizon; and
- contain at least one return period.

The analyser reports:

- frequency of ever reaching and terminally retaining the target;
- terminal loss frequencies at 50%, 75% and a configurable substantial-loss threshold, defaulting to 95%;
- maximum-drawdown breach frequencies at the same thresholds;
- terminal-wealth percentiles; and
- maximum-drawdown percentiles.

Terminal loss and path drawdown are separate measures. A path may suffer a severe drawdown and later recover.

## Moving-block bootstrap

The seeded moving-block bootstrap resamples consecutive blocks of historical period returns and produces reproducible scenario equity paths. Consecutive returns inside each sampled block are retained to preserve some short-range dependence.

The bootstrap output is a scenario frequency estimate, not a probability forecast. A research report must version:

- the exact after-cost return series;
- data, universe and strategy versions;
- explicit period cadence and exact objective horizon;
- block length, scenario count and seed;
- walk-forward and final-holdout boundaries; and
- all excluded periods or assets.

Block length and source history require explicit research justification. Resampling cannot repair survivorship bias, look-ahead leakage, unrealistic fills or inadequate market coverage.

## Promotion boundary

These calculations may support research reports only after they consume validated after-cost strategy returns. Synthetic fixtures prove arithmetic and fail-closed behaviour; they do not establish profitability, target attainability or live suitability.

The implementation rejects non-finite derived reference values, remaining multiples and required compound rates rather than publishing numerically meaningless evidence.
