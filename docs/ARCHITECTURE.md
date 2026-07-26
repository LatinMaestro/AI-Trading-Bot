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
      +--> immutable lifecycle-source capture
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
3. At the daily 00:00 UTC slot, capture and atomically persist the fixed official Kraken listing/delisting indexes and status feeds. Any incomplete or malformed capture set fails the slot.
4. Discover current approved markets and fetch public committed candles.
5. Persist accepted public-data batches and candles immutably.
6. Detect missing, duplicate, stale, conflicting or unrecoverable market data and fail closed.
7. Reconstruct the Australian-available spot universe from definitions, lifecycle events and quality observations knowable at the signal time.
8. Apply signed tier-specific listing-age, history, spread, turnover, depth, impact, minimum-order and instrument gates.
9. Generate a strategy decision only from eligible universe members and a versioned configuration.
10. Reconcile balances and orders when private access is available.
11. Evaluate hard risk limits.
12. Create an order intent with a deterministic idempotency key.
13. In non-live modes, record the proposed action only.
14. In live mode, verify API permissions, activation secret and execution limits again immediately before submission.
15. Submit, reconcile and record every response.

## Data model

D1 stores:

- system and activation state;
- cycle leases and scheduled-cycle outcomes;
- deduplicated exact Kraken lifecycle payloads keyed by SHA-256;
- immutable Kraken lifecycle fetch records and database-verified commit markers;
- immutable public market-data batch provenance;
- immutable committed 60-minute and daily OHLCV candles;
- versioned market definitions;
- immutable listing, trading-status, delisting and Australian-availability events;
- immutable market-quality observations for spread, turnover, depth, impact, minimums, valuation and data state;
- content-addressed universe-ingestion batch headers, source digests, record memberships and verified commit markers;
- strategy decisions;
- order intents, exchange orders and fills;
- balances and equity snapshots;
- risk events and kill-switch state;
- immutable audit events;
- Australian-dollar tax ledger entries.

Each distinct lifecycle payload is stored once as exact validated UTF-8 text with its original byte length and SHA-256. Every scheduled observation remains a separate immutable capture binding source kind, exact allowlisted URL, fetch time, media type and bounded response metadata to that payload. D1 permits a final capture commit marker only when the payload-backed capture exists and the commit does not predate the fetch. Raw captures do not create lifecycle declarations; reviewed pair-level events remain a separate, explicit evidence boundary.

Market batches and candles use deterministic SHA-256 content digests. Database triggers reject identity reuse with different content and prevent ordinary update or delete operations. Gap detection is performed against explicit expected ranges before strategy research is allowed to rely on stored data.

Universe definitions, lifecycle events and quality observations are also append-only and hashed. Prepared universe evidence is submitted through one transactional D1 batch and is complete only when a final database-verified commit marker proves that every declared source and record membership exists. Historical reconstruction uses source publication and data-availability timestamps so later listings, suspensions, delistings or quality observations cannot leak into an earlier signal. The contract is defined in `docs/MARKET_UNIVERSE.md`.

## AI design

No large language model participates in real-time order decisions. Later adaptive components may rank approved deterministic strategies or predict market regime, but the risk engine and execution policy remain deterministic and authoritative.