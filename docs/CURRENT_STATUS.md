# Current status

Last verified: 26 July 2026 (Australia/Brisbane)

## Repository state

- Repository: `LatinMaestro/AI-Trading-Bot`
- Foundation pull request: #1, `agent/phase-0-foundation` into `main`
- State: draft and intentionally unmerged
- Live deployment: none
- Credentials: none
- Funds: none
- Wallet connection: none

## Verified foundation checks

- 12 Node tests pass for strategy selection, risk limits, live fail-closed behaviour, monotonic Kraken nonces, committed-candle parsing and executable-order rejection.
- Strict TypeScript source checking passes with Worker/D1 declarations.
- Forbidden-capability scan passes.
- The D1 migration applies successfully and creates the expected tables and indexes.
- Preview and production Cloudflare configuration both parse with `TRADING_MODE=paper` and `LIVE_TRADING_ENABLED=false`.
- Exact-head review corrected two exchange defects before merge: non-monotonic nonce generation and inclusion of Kraken's uncommitted final OHLC candle.

## External validation blocker

GitHub Actions runs currently fail before any job step starts and provide no job log. The account's private-repository Actions capacity is known to be unavailable until 1 August 2026. Full `npm install`, Wrangler-generated binding types and `wrangler deploy --dry-run` therefore remain unverified on GitHub exact head.

Do not merge pull request #1 until a fresh exact-head CI run completes successfully.

## Work permitted while Actions is unavailable

Continue focused, non-live work that can be validated without GitHub Actions, preferably as stacked draft branches or documentation/research slices:

1. Phase 1 market-data contracts, fixtures and pair normalisation.
2. D1 cycle-lease and idempotency design/tests.
3. Fee/slippage-aware backtest specification and pure calculation modules.
4. Tax-record export schema and synthetic fixtures.
5. Security and incident runbooks.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
