# Current status

Last verified: 26 July 2026 (Australia/Brisbane)

## Repository state

- Repository: `LatinMaestro/AI-Trading-Bot`
- Foundation pull request: #1, `agent/phase-0-foundation` into `main`
- Market-data pull request: #2, `agent/phase-1-market-data-contracts` into `agent/phase-0-foundation`
- Both pull requests are draft and intentionally unmerged.
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
- Exact-head review corrected non-monotonic nonce generation, inclusion of Kraken's uncommitted final OHLC candle and an exposed executable-order adapter path.

## Verified market-data checks

- 25 tests pass across the stacked Phase 1 branch.
- Approved Australian spot markets are discovered from Kraken's public pair metadata rather than assumed.
- Canonical `BTC/AUD`, `ETH/AUD` and `SOL/AUD` symbols map separately to exchange request symbols.
- Missing, duplicate or non-online approved pairs fail closed.
- Venue precision, tick size and order minimums are parsed as runtime contract data.
- Daily candles must be committed, finite, internally consistent, contiguous, UTC aligned and fresh before strategy evaluation.

## External validation blocker

GitHub Actions runs currently fail before any job step starts and provide no job log. The account's private-repository Actions capacity is known to be unavailable until 1 August 2026. Full `npm install`, Wrangler-generated binding types and `wrangler deploy --dry-run` therefore remain unverified on GitHub exact heads.

Do not merge pull requests #1 or #2 until fresh exact-head CI runs complete successfully and the stacked base is merged in order.

## Work permitted while Actions is unavailable

Continue focused, non-live work that can be validated without GitHub Actions, preferably as stacked draft branches or documentation/research slices:

1. D1 cycle-lease and idempotency design/tests.
2. Historical market-data provenance, persistence and gap repair.
3. Fee/slippage-aware backtest specification and pure calculation modules.
4. Tax-record export schema and synthetic fixtures.
5. Security and incident runbooks.

Do not deploy, request credentials, create an exchange account, move funds or enable live execution.
