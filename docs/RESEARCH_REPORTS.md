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
- a sorted unique list of exact strategy-evaluation manifest digests, explicitly empty when no walk-forward, holdout or sensitivity manifest was evaluated;
- a sorted unique list of exact external-intelligence backtest comparison digests, explicitly empty when that evidence was not evaluated;
- optional versioned FX-conversion digest;
- canonical warnings; and
- SHA-256 digest of canonical report content.

Reports fail closed for missing/duplicate benchmarks, mismatched cadence, invalid provenance, inconsistent objective references, unsupported currencies, non-finite metrics or generation before the evaluated period ends.

The digest proves content identity, not approval or authenticity. Strategy-backtest run and strategy-evaluation manifest identities are re-runnable evidence references, not ranking, selection or promotion records. A later signed-strategy gate must bind an approved configuration and report digest to an authorised approval record.

The hourly candidate complete-evaluation envelope additionally requires the exact reproduced final-holdout equity curve, the shared baseline identity across walk-forward and sensitivity evidence, the complete deduplicated run set, the walk-forward, sensitivity and execution-stress manifests, all mandatory benchmarks, objective progress, scenario target-attainment/ruin metrics and explicit warnings that the objective is aspirational, complete approved-capital loss is possible, stress testing does not prove live fillability and the candidate is not selected or promoted. Its content digest remains research evidence only.
Complete report persistence reproduces that envelope, chunks the canonical report at valid UTF-8 boundaries with per-chunk SHA-256 identities and requires exact database-verified chunk/byte completion before committing the compact evaluation binding. Exact retries retain the original immutable evidence; reconstruction and digest verification occur before repository success. No approval, ranking, selection or promotion field is introduced.

The exact stress manifest is immutably bound to the persisted final-holdout plan/run/result, report and complete-evaluation identity. Calibration availability, fixed matrix cardinality, report chronology, conflicts and mutation fail closed; this persistence remains research evidence, not live-capacity proof.

The cross-sectional complete-evaluation artifact binds exact immutable walk-forward and sensitivity manifests, the shared final-holdout plan/run/result and the 40-cell execution-stress identity. It requires exact strategy/data/universe/execution/run/manifest provenance, all four benchmarks, AUD objective progress and scenario target-attainment/ruin evidence. Derived evidence records final-holdout return, drawdown, turnover, cost and requested/filled/missed notional plus constrained capital levels and worst stress return, drawdown and missed-fill ratio. Missing warnings, stale chronology, detached metrics or authority-bearing manifest drift fail closed. No winner, ranking, selected-policy, activation or execution field is introduced.

Synthetic fixtures validate arithmetic and report reproducibility only. Promotion still requires validated after-cost walk-forward, final-holdout, sensitivity, universe, capacity and tax evidence.
