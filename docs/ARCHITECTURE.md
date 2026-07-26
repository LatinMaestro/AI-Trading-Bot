# Architecture

## Deployment model

The production design uses a Cloudflare Worker with scheduled triggers and D1. It is designed to fit within the Workers Free plan during research and low-frequency operation, subject to current provider limits.

```text
Cloudflare Cron
      |
      v
Trading-cycle orchestrator
      |
      +--> public market-data adapter
      +--> immutable market-data persistence and gap checks
      +--> survivorship-safe universe reconstruction
      +--> strategy engine
      +--> risk engine
      +--> execution adapter (disabled unless live gates pass)
      +--> D1 audit and accounting repository
      +--> alerts / health state
```

## Trust boundaries

1. GitHub contains code and non-secret configuration only.
2. Cloudflare stores exchange secrets and the activation secret.
3. The exchange stores capital and enforces API permissions.
4. The bot cannot withdraw or transfer funds.
5. MetaMask and external wallets remain outside the system.

## Runtime modes

- `research`: public data and research endpoints only.
- `paper`: simulated execution with no private exchange API.
- `shadow`: private balances/orders may be read; orders are never placed.
- `validate`: order requests may be submitted with exchange validation/no-execution flags where supported.
- `live`: eligible spot orders may be submitted only when every gate passes.

## Scheduled cycle

1. Acquire a lease in D1 to prevent duplicate concurrent cycles.
2. Load runtime state and verify mode.
3. Discover current approved markets and fetch public committed candles.
4. Persist accepted public-data batches and candles immutably.
5. Detect missing, duplicate, stale, conflicting or unrecoverable market data and fail closed.
6. Reconstruct the Australian-available spot universe from definitions, lifecycle events and quality observations knowable at the signal time.
7. Apply signed tier-specific listing-age, history, spread, turnover, depth, impact, minimum-order and instrument gates.
8. Generate a strategy decision only from eligible universe members and a versioned configuration.
9. Reconcile balances and orders when private access is available.
10. Evaluate hard risk limits.
11. Create an order intent with a deterministic idempotency key.
12. In non-live modes, record the proposed action only.
13. In live mode, verify API permissions, activation secret and execution limits again immediately before submission.
14. Submit, reconcile and record every response.

## Data model

D1 stores:

- system and activation state;
- cycle leases and scheduled-cycle outcomes;
- immutable public market-data batch provenance;
- immutable committed 60-minute and daily OHLCV candles;
- versioned market definitions;
- immutable listing, trading-status, delisting and Australian-availability events;
- immutable market-quality observations for spread, turnover, depth, impact, minimums, valuation and data state;
- strategy decisions;
- order intents, exchange orders and fills;
- balances and equity snapshots;
- risk events and kill-switch state;
- immutable audit events;
- Australian-dollar tax ledger entries.

Market batches and candles use deterministic SHA-256 content digests. Database triggers reject identity reuse with different content and prevent ordinary update or delete operations. Gap detection is performed against explicit expected ranges before strategy research is allowed to rely on stored data.

Universe definitions, lifecycle events and quality observations are also append-only and hashed. Historical reconstruction uses source publication and data-availability timestamps so later listings, suspensions, delistings or quality observations cannot leak into an earlier signal. The contract is defined in `docs/MARKET_UNIVERSE.md`.

## AI design

No large language model participates in real-time order decisions. Later adaptive components may rank approved deterministic strategies or predict market regime, but the risk engine and execution policy remain deterministic and authoritative.
