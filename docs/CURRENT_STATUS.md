# Current status

Last verified: 26 July 2026 (Australia/Brisbane)

## Repository state

- Repository: `LatinMaestro/AI-Trading-Bot`
- Foundation pull request: #1, `agent/phase-0-foundation` into `main`
- Market-data pull request: #2, `agent/phase-1-market-data-contracts` into `agent/phase-0-foundation`
- Idempotency pull request: #3, `agent/phase-1-cycle-idempotency` into `agent/phase-1-market-data-contracts`
- All three pull requests are draft and intentionally unmerged.
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

- 32 tests pass across the complete stacked head.
- D1 integration tests apply both current migrations successfully.
- Global cycle leases are exclusive, expiring and owner-guarded.
- Completed scheduled slots cannot execute twice; failed or stale attempts can be retried with an incremented attempt count.
- Order request fingerprints are stable across equivalent Kraken aliases and decimal formatting.
- The database permits only one order intent for a logical request fingerprint.
- Failed cycles are auditable and lease-release failures cannot mask the original cycle error.

## External validation blocker

GitHub Actions runs currently fail before any job step starts and provide no job log. The account's private-repository Actions capacity is known to be unavailable until 1 August 2026. Full `npm install`, Wrangler-generated binding types and `wrangler deploy --dry-run` therefore remain unverified on GitHub exact heads.

Do not merge pull requests #1, #2 or #3 until fresh exact-head CI runs complete successfully and the stack is merged in order.

## Work permitted while Actions is unavailable

Continue focused, non-live work that can be validated without GitHub Actions, preferably as additional stacked draft branches:

1. Immutable market-candle persistence, provenance and gap repair.
2. Fee/slippage-aware backtest specification and pure calculation modules.
3. Tax-record export schema and synthetic fixtures.
4. Security and incident runbooks.
5. Lease heartbeats before any private exchange operation is introduced.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
