# Architecture

## Deployment model

The production design uses Cloudflare Workers, scheduled triggers, Queues and D1. It is designed to fit within approved service limits during research and low-frequency operation; minute-level external-intelligence collection requires a separately deployed collector and current provider-limit review.

```text
Cloudflare Cron / approved webhooks and streams
      |
      +--> minute intelligence collector --> Queue --> deterministic assessment
      |
      v
Trading-cycle orchestrator
      |
      +--> public market-data adapter
      +--> immutable lifecycle-source capture
      +--> immutable market-data persistence and gap checks
      +--> survivorship-safe universe reconstruction
      +--> committed external-intelligence assessments
      +--> strategy engine
      +--> risk engine
      +--> execution adapter (disabled unless live gates pass)
      +--> D1 audit and accounting repository
      +--> alerts / health state
```

## Trust boundaries

1. GitHub contains code and non-secret configuration only.
2. Cloudflare stores exchange secrets, provider credentials and the activation secret.
3. Approved intelligence providers and publishers remain external trust domains whose latency, licences and availability are measured rather than assumed.
4. The exchange stores capital and enforces API permissions.
5. The bot cannot withdraw or transfer funds.
6. MetaMask and external wallets remain outside the system.

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
4. Load only committed external-intelligence assessments available by the decision timestamp. External intelligence may pause new risk or create a research candidate; it cannot submit or approve an order.
5. Discover current approved markets and fetch public committed candles.
6. Persist accepted public-data batches and candles immutably.
7. Detect missing, duplicate, stale, conflicting or unrecoverable market data and fail closed.
8. Reconstruct the Australian-available spot universe from definitions, lifecycle events and quality observations knowable at the signal time.
9. Apply signed tier-specific listing-age, history, spread, turnover, depth, impact, minimum-order and instrument gates.
10. Generate a strategy decision only from eligible universe members and a versioned configuration.
11. Reconcile balances and orders when private access is available.
12. Evaluate hard risk limits.
13. Create an order intent with a deterministic idempotency key.
14. In non-live modes, record the proposed action only.
15. In live mode, verify API permissions, activation secret and execution limits again immediately before submission.
16. Submit, reconcile and record every response.

## Data model

D1 stores:

- system and activation state;
- cycle leases and scheduled-cycle outcomes;
- deduplicated exact Kraken lifecycle payloads keyed by SHA-256;
- immutable Kraken lifecycle fetch records and database-verified commit markers;
- immutable discovered lifecycle document captures bound to their exact discovery and committed index provenance;
- immutable public market-data batch provenance;
- immutable committed 60-minute and daily OHLCV candles;
- versioned market definitions;
- immutable listing, trading-status, delisting and Australian-availability events;
- immutable market-quality observations for spread, turnover, depth, impact, minimums, valuation and data state;
- content-addressed universe-ingestion batch headers, source digests, record memberships and verified commit markers;
- versioned external-intelligence source contracts covering provider, publisher, licence, attribution, retention, deletion and model-use rules;
- immutable external-intelligence items, append-only corrections and deterministic assessments;
- content-addressed external-intelligence ingestion batches, memberships and database-verified commit markers;
- purge-enforced transient Reddit post metadata with non-extendable deletion deadlines;
- content-free aggregate Reddit watch state, retention audits and invalidation events;
- strategy decisions;
- order intents, exchange orders and fills;
- balances and equity snapshots;
- risk events and kill-switch state;
- immutable audit events;
- Australian-dollar tax ledger entries.

Each distinct lifecycle payload is stored once as exact validated UTF-8 text with its original byte length and SHA-256. Every scheduled observation remains a separate immutable capture binding source kind, exact allowlisted URL, fetch time, media type and bounded response metadata to that payload. D1 permits a final capture commit marker only when the payload-backed capture exists and the commit does not predate the fetch. Raw captures do not create lifecycle declarations; reviewed pair-level events remain a separate, explicit evidence boundary.

Discovered lifecycle pages and documents use a separate immutable capture table over the shared content-addressed payload store. Each header records the discovery digest and the exact committed index capture/payload that produced the canonical target. Database triggers enforce source-class compatibility, provenance completion, natural-identity consistency, commit chronology and immutability. Bounded capture batches persist only after all selected public documents succeed.

Market batches and candles use deterministic SHA-256 content digests. Database triggers reject identity reuse with different content and prevent ordinary update or delete operations. Gap detection is performed against explicit expected ranges before strategy research is allowed to rely on stored data.

Universe definitions, lifecycle events and quality observations are also append-only and hashed. Prepared universe evidence is submitted through one transactional D1 batch and is complete only when a final database-verified commit marker proves that every declared source and record membership exists. Historical reconstruction uses source publication and data-availability timestamps so later listings, suspensions, delistings or quality observations cannot leak into an earlier signal. The contract is defined in `docs/MARKET_UNIVERSE.md`.

External-intelligence batches use deterministic source-contract, correction, policy, assessment and batch digests. Application validation binds every item to an effective source-contract version and reproduces every assessment from the referenced items and policy. Database constraints reject changed identities, enforce chronology and source-contract compatibility, preserve corrections instead of rewriting history and expose a batch only after its declared memberships are complete. Collection and assessment remain isolated from execution by Queue and deterministic reaction boundaries.

Reddit post-level state uses a separate transient boundary and never enters the immutable intelligence ledger or durable Queue. D1 preserves only bounded post identity metadata until the original deletion deadline. Deletes require a transaction-local purge authorization; provider removals and deadline expiry atomically delete transient rows, record only aggregate content-free compliance evidence and invalidate downstream watch state. Failed provider refreshes cannot extend retention.

## AI design

No large language model participates in real-time order decisions. Later adaptive components may draft summaries, classifications or approved deterministic strategy rankings, but their output remains untrusted. The source registry, reaction gates, risk engine and execution policy remain deterministic and authoritative.
