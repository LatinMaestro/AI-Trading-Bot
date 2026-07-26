# Current status

Last verified: 26 July 2026 (Australia/Brisbane)

## Repository state

- Repository: `LatinMaestro/AI-Trading-Bot`
- Foundation pull request: #1, `agent/phase-0-foundation` into `main`
- Market-data pull request: #2, `agent/phase-1-market-data-contracts` into `agent/phase-0-foundation`
- Idempotency pull request: #3, `agent/phase-1-cycle-idempotency` into `agent/phase-1-market-data-contracts`
- Candle-persistence pull request: #4, `agent/phase-1-candle-persistence` into `agent/phase-1-cycle-idempotency`
- Five-year aggressive-mandate pull request: #5, `agent/five-year-aggressive-mandate` into `agent/phase-1-candle-persistence`
- Execution-aware backtest pull request: #6, `agent/phase-1-execution-backtest` into `agent/five-year-aggressive-mandate`
- Survivorship-safe universe pull request: #8, `agent/phase-1-survivorship-universe` into `agent/phase-1-execution-backtest`
- Objective-risk pull request: #9, `agent/phase-1-objective-risk-metrics` into `agent/phase-1-survivorship-universe`
- Benchmark/report pull request: #11, `agent/phase-1-benchmarks-reports` into `agent/phase-1-objective-risk-metrics`
- Pull requests #7 and #10 were closed as superseded duplicates.
- All nine active pull requests are draft and intentionally unmerged.
- Live deployment: none
- Credentials: none
- Funds: none
- Wallet connection: none

## Authoritative strategy direction

- The aspirational objective is US$200 to US$1,000,000 within five years of first authorised live-capital activation.
- The reference path requires approximately 449.28% compound growth per year or 15.25% compound growth per month.
- Research is market-cap agnostic and may consider approved blue chips, mid-caps, micro-caps and newly listed spot assets.
- Concentrated positions, up to 100% gross spot exposure, hourly decisions and multiple daily rebalances may be researched.
- Reports must include target-attainment, terminal-wealth, drawdown, capacity and probabilities of substantial or complete capital loss.
- Aggressive capital risk does not weaken spot-only, no-debt, no-withdrawal, no-transfer, no-wallet and fail-closed operational controls.
- Current conservative implementation limits remain active until a signed aggressive configuration passes all promotion and live gates.

## Venue direction

- Kraken remains the primary foundation adapter because granular permissions and key introspection support withdrawal exclusion.
- CoinJar Exchange is a priority comparison candidate only after its restricted trade scope proves sufficient for balance, order, fill and reconciliation access without transfer authority.
- CoinSpot remains a secondary comparison candidate pending the same permission, data and reconciliation evidence.
- Final venue selection must compare actual fees, spread, depth, price impact, market coverage and API reliability without weakening credential safety.

## Verified foundation checks

- 12 Node tests pass for strategy selection, risk limits, live fail-closed behaviour, monotonic Kraken nonces, committed-candle parsing and executable-order rejection.
- Strict TypeScript source checking passes with interface-compatible Worker/D1 declarations.
- Forbidden-capability scan passes.
- Preview and production configuration both remain `paper` mode with live trading disabled.

## Verified market-data checks

- Approved Australian spot markets are discovered from Kraken's public pair metadata rather than assumed.
- Canonical `BTC/AUD`, `ETH/AUD` and `SOL/AUD` symbols map separately to exchange request symbols.
- Missing, duplicate or non-online approved pairs fail closed.
- Venue precision, tick size and order minimums are parsed as runtime contract data.
- Daily candles must be committed, finite, internally consistent, contiguous, UTC aligned and fresh before strategy evaluation.

## Verified idempotency checks

- 32 tests pass across the complete idempotency stacked head.
- D1 integration tests apply migrations `0001` and `0002` successfully.
- Global cycle leases are exclusive, expiring and owner-guarded.
- Completed scheduled slots cannot execute twice; failed or stale attempts can be retried with an incremented attempt count.
- Order request fingerprints are stable across equivalent Kraken aliases and decimal formatting.
- The database permits only one order intent for a logical request fingerprint.
- Failed cycles are auditable and lease-release failures cannot mask the original cycle error.

## Verified candle-persistence checks

- 7 focused Node 22 tests pass for immutable candle persistence and gap planning.
- The test harness applies migrations `0001`, `0002` and `0003` in order using SQLite.
- Exact duplicate batches and candles are idempotent.
- Reused batch identities with changed provenance and reused candle identities with changed OHLCV content fail closed.
- Stored batch and candle rows reject ordinary update and delete operations.
- Batch and candle SHA-256 values are deterministic.
- Leading, internal and trailing gaps are detected against explicit expected ranges.
- Gaps crossing Kraken's documented REST retention horizon are split into unavailable and repairable portions.
- Strict TypeScript source checking passes for the new pure and D1-facing modules using interface-compatible D1 declarations.

## Verified aggressive-mandate checks

- The objective arithmetic and year-by-year reference path were independently checked.
- Agent instructions, product specification, risk policy, master plan, review gates, strategy research, venue research and decision log use one five-year mandate.
- The mandate accepts possible complete loss of the approved allocation while preserving operational safety boundaries.

## Verified execution-backtest checks

- 8 focused Node 22 tests pass for costless controls, execution-cost attribution, maker non-fills, participation limits, rotations, proportional buy scaling and fail-closed chronology.
- Strict TypeScript source checking passes for the backtest modules.
- The engine cannot create negative cash, negative positions, shorts or exposure beyond approved capital.
- Synthetic assumptions are not accepted as profitability evidence.

## Verified dynamic-universe checks

- 14 focused Node 22 tests pass across pure reconstruction and SQLite-backed evidence constraints.
- Migrations `0001` through `0005` apply sequentially in SQLite.
- Definitions, lifecycle events and market-quality observations are immutable, idempotent and no-lookahead.
- Suspended, Australian-disabled and delisted assets remain in history; relisting begins a new listing era.
- Tier, instrument, valuation, data, minimum-order, turnover, depth, spread and impact failures remain visible as reason codes.

## Verified objective-risk checks

- 5 focused Node 22 tests pass for objective milestones, required-forward rates, target/loss/drawdown summaries, seeded block resampling and fail-closed inputs.
- Strict TypeScript source checking passes for `src/research/objectiveMetrics.ts`.
- Terminal loss and maximum drawdown are reported separately.
- Scenario frequencies remain non-predictive and require validated after-cost walk-forward and holdout inputs.

## Verified benchmark/report checks

- 5 focused Node 22 tests pass for cash/BTC benchmark arithmetic, unrebalanced equal-weight hold, currency separation, deterministic report hashing and fail-closed report inputs.
- Strict TypeScript source checking passes for the benchmark and report modules.
- Required benchmarks are AUD cash, BTC hold, survivorship-safe equal-weight hold and the five-year objective path.
- Benchmark cadence must match the strategy exactly; unlike currencies are not directly compared without versioned FX provenance.
- Research-report v1 binds evaluation split, period, strategy, benchmarks, objective/risk metrics, warnings and code/data/universe/configuration digests into a canonical SHA-256 digest.
- The digest proves content identity, not approval or profitability.

## External validation blocker

GitHub Actions runs currently fail before any job step starts and provide no job log. The account's private-repository Actions capacity is known to be unavailable until 1 August 2026. Full dependency installation, Wrangler-generated binding types and deployment dry-runs remain unverified on GitHub exact heads.

Do not merge pull requests #1, #2, #3, #4, #5, #6, #8, #9 or #11 until fresh exact-head CI runs complete successfully and the stack is merged in order.

## Highest-priority unblocked work

1. Add scheduled universe ingestion, lifecycle-source provenance and Australian-dollar valuation/calibration contracts.
2. Add Australian tax-record export schema and synthetic fixtures.
3. Add security and incident runbooks.
4. Integrate validated walk-forward, holdout, benchmark and sensitivity inputs.
5. Persist reports and bind approved strategy configurations to authorised approval records.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
