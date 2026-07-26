# Current status

Last verified: 26 July 2026 (Australia/Brisbane)

## Repository state

- Repository: `LatinMaestro/AI-Trading-Bot`
- Foundation pull request: #1, `agent/phase-0-foundation` into `main`
- Market-data pull request: #2, `agent/phase-1-market-data-contracts` into `agent/phase-0-foundation`
- Idempotency pull request: #3, `agent/phase-1-cycle-idempotency` into `agent/phase-1-market-data-contracts`
- Candle-persistence pull request: #4, `agent/phase-1-candle-persistence` into `agent/phase-1-cycle-idempotency`
- Five-year aggressive-mandate pull request: #5, `agent/five-year-aggressive-mandate` into `agent/phase-1-candle-persistence`
- All five pull requests are draft and intentionally unmerged.
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
- CoinJar Exchange is now a priority comparison candidate rather than blanket-excluded: current documentation separates a trade-capable `trades` scope from transfer-capable `allaccess`.
- CoinJar cannot be implemented for live use until the required balance, order, fill and reconciliation reads are proven available under `trades`, all transfer-capable functions are proven absent and unattended use is permitted.
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
- D1 integration tests apply the first two migrations successfully.
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
- Agent instructions, product specification, risk policy, master plan, review gates, strategy research, venue research and decision log now use one consistent five-year mandate.
- The strategy plan now includes established, high-volatility and new-listing research lanes, venue-wide relative strength, breakout, volatility-expansion and separately evaluated mean-reversion candidates.
- The mandate explicitly accepts possible complete loss of the approved capital while preserving operational safety boundaries.
- No source code, dependency, migration, credential, deployment, exchange access, wallet integration, funds or executable order capability changed in PR #5.

## External validation blocker

GitHub Actions runs currently fail before any job step starts and provide no job log. The account's private-repository Actions capacity is known to be unavailable until 1 August 2026. Full `npm install`, Wrangler-generated binding types and `wrangler deploy --dry-run` therefore remain unverified on GitHub exact heads.

Do not merge pull requests #1, #2, #3, #4 or #5 until fresh exact-head CI runs complete successfully and the stack is merged in order.

## Highest-priority unblocked work

Continue focused, non-live work that can be validated without GitHub Actions, preferably as additional stacked draft branches:

1. Define and implement the fee-, spread-, slippage-, missed-fill- and price-impact-aware backtest calculation contract.
2. Define dynamic venue-wide universe tiers and survivorship-safe historical membership records.
3. Add objective-path, terminal-wealth and risk-of-ruin pure calculation modules.
4. Add tax-record export schema and synthetic fixtures.
5. Add security and incident runbooks.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.