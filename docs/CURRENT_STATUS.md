# Current status

Last verified: 26 July 2026 (Australia/Brisbane)

## Repository state

- Repository: `LatinMaestro/AI-Trading-Bot`
- Foundation pull request: #1, `agent/phase-0-foundation` into `main`
- Market-data pull request: #2, `agent/phase-1-market-data-contracts` into `agent/phase-0-foundation`
- Idempotency pull request: #3, `agent/phase-1-cycle-idempotency` into `agent/phase-1-market-data-contracts`
- Candle-persistence pull request: #4, `agent/phase-1-candle-persistence` into `agent/phase-1-cycle-idempotency`
- All four pull requests are draft and intentionally unmerged.
- Live deployment: none
- Credentials: none
- Funds: none
- Wallet connection: none

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

## External validation blocker

GitHub Actions runs currently fail before any job step starts and provide no job log. The account's private-repository Actions capacity is known to be unavailable until 1 August 2026. Full `npm install`, Wrangler-generated binding types and `wrangler deploy --dry-run` therefore remain unverified on GitHub exact heads.

Do not merge pull requests #1, #2, #3 or #4 until fresh exact-head CI runs complete successfully and the stack is merged in order.

## Work permitted while Actions is unavailable

Continue focused, non-live work that can be validated without GitHub Actions, preferably as additional stacked draft branches:

1. Fee/slippage-aware backtest specification and pure calculation modules.
2. Tax-record export schema and synthetic fixtures.
3. Security and incident runbooks.
4. Lease heartbeats before any private exchange operation is introduced.
5. Scheduled public-data ingestion and automated gap repair after the persistence contract receives exact-head validation.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
