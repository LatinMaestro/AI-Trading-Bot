# Research benchmarks and reports

## Required benchmarks

Every candidate report includes aligned equity series for:

- AUD cash using versioned period returns;
- BTC buy-and-hold;
- equal-weight buy-and-hold without retrospective survivor selection;
- the five-year constant-compounding objective path.

Strategy, AUD cash, BTC and equal-weight series must use one reporting currency. The USD objective path remains separate unless a versioned FX-conversion digest is supplied. Unlike currencies are not directly compared.

## Benchmark controls

- Timestamps must be strictly increasing and identical to the strategy horizon/cadence.
- Prices, returns and equity must be finite and non-negative; period returns must exceed -100%.
- Equal-weight membership and source data must be time-appropriate and survivorship-safe.
- Source SHA-256 digests are sorted and deduplicated.
- Reports show terminal excess, return difference and drawdown difference only for comparable currencies.

## Research report v1

`prepareResearchReport` creates a deterministic content-addressed report containing:

- evaluation split and exact period;
- strategy and four required benchmark series;
- return/drawdown summaries and comparisons;
- objective progress and scenario-risk metrics;
- code, data, universe, strategy, execution, objective and benchmark configuration digests;
- a sorted unique list of exact strategy-backtest run digests, explicitly empty when no strategy run was evaluated;
- a sorted unique list of exact external-intelligence backtest comparison digests, explicitly empty when that evidence was not evaluated;
- optional versioned FX-conversion digest;
- canonical warnings; and
- SHA-256 digest of canonical report content.

Reports fail closed for missing/duplicate benchmarks, mismatched cadence, invalid provenance, inconsistent objective references, unsupported currencies, non-finite metrics or generation before the evaluated period ends.

The digest proves content identity, not approval or authenticity. Strategy-backtest run identities are re-runnable evidence references, not promotion records. A later signed-strategy gate must bind an approved configuration and report digest to an authorised approval record.

Synthetic fixtures validate arithmetic and report reproducibility only. Promotion still requires validated after-cost walk-forward, final-holdout, sensitivity, universe, capacity and tax evidence.
