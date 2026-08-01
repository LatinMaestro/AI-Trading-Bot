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
      +--> immutable market-data persistence and gap checks
      +--> immutable lifecycle-source capture
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
4. Load only committed external-intelligence assessments available by the decision timestamp. Intelligence may pause new risk or create a research candidate; it cannot submit or approve an order.
5. Discover current approved markets and fetch public committed candles.
6. Persist accepted public-data batches and candles immutably.
7. Detect missing, duplicate, stale, conflicting or unrecoverable market data and fail closed.
8. Reconstruct the time-correct eligible research universe using only definitions, lifecycle events and quality evidence available by signal time.
9. Generate a strategy decision from a versioned configuration; exclude every ineligible market.
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
- immutable public market-data batch provenance;
- immutable committed 60-minute and daily OHLCV candles;
- immutable market definitions, lifecycle events and quality observations;
- content-addressed universe-ingestion batch headers, source and record memberships, and database-verified commit markers;
- deduplicated exact Kraken lifecycle payloads keyed by SHA-256;
- immutable Kraken lifecycle fetch records and database-verified commit markers;
- immutable discovered lifecycle document captures bound to exact discovery and committed-index provenance;
- versioned external-intelligence source contracts covering provider, publisher, licence, attribution, retention, deletion and model-use rules;
- immutable external-intelligence items, append-only corrections, content-addressed entity/syndication linkages and deterministic assessments;
- purge-enforced transient Reddit post metadata with non-extendable deletion deadlines;
- content-free aggregate Reddit watch state, retention audits and invalidation events;
- content-addressed external-intelligence ingestion batches, memberships and database-verified commit markers;
- strategy decisions;
- order intents, exchange orders and fills;
- balances and equity snapshots;
- risk events and kill-switch state;
- immutable audit events;
- Australian-dollar tax ledger entries.

External-intelligence linkages bind each reviewed topic to exact entity keys and allowed event types, apply verified append-only corrections as an effective view, remove retracted/deleted evidence, and collapse exact syndicated content to one authority-ranked representative before corroboration. Linkage manifests and clusters are content-addressed.

A separate content-addressed manipulation-evidence stage accepts only exact effective representative content whose reviewed policy permits excerpts or full-content processing. It transiently normalises that content, persists no raw text, compares bounded five-token shingle digests with a reviewed Jaccard threshold and uses deterministic complete-link clusters so transitive similarity cannot inflate a group. Every exact or near-duplicate group contributes one corroboration unit. Rapid near-duplicate publication by multiple publishers is surfaced as a watch-only coordination pattern, not asserted as identity proof. Missing, changed or pre-linkage fingerprints fail closed. Reddit post content, identifiers and content-derived hashes remain excluded from this durable path; content-free transient social watch state remains separate.

Market batches and candles use deterministic SHA-256 content digests. Database triggers bind each candle to matching source-batch metadata and range, reject identity reuse with different content, and prevent ordinary update or delete operations. Gap detection is performed against explicit expected ranges before strategy research is allowed to rely on stored data.

Universe definitions, lifecycle events and quality observations are append-only, carry lower-case SHA-256 payload digests, and use D1 checks and triggers to reject mutation or identity reuse. Prepared universe evidence is submitted through one transactional nine-statement D1 batch. A database commit marker is accepted only after every declared source and record membership exists; committed membership is then frozen, while exact retries remain idempotent. The universe module is a research-only boundary: it reconstructs eligibility without granting strategy-selection, runtime or order authority.

Each distinct lifecycle payload is stored once as exact validated UTF-8 text with its original byte length and SHA-256. Every scheduled observation remains a separate immutable capture binding source kind, exact allowlisted URL, fetch time, media type and bounded response metadata to that payload. D1 permits a final capture commit marker only when the payload-backed capture exists and the commit does not predate the fetch. Raw captures do not create lifecycle declarations; reviewed pair-level events remain a separate, explicit evidence boundary.

Discovered lifecycle pages and documents use a separate immutable capture table over the shared content-addressed payload store. Each header records the discovery digest and the exact committed index capture/payload that produced the canonical target. Application validation reproduces payload and capture identities; database constraints independently enforce canonical source paths, safe cache headers, source-class compatibility, provenance completion, natural-identity consistency, commit chronology, retry identity and immutability. Bounded capture batches persist only after every selected public document succeeds.

Reddit post-level state uses a separate transient boundary and never enters the immutable intelligence ledger or durable Queue. D1 preserves only bounded post identity metadata until the original deletion deadline. Deletes require a batch-local purge authorization; provider removals and deadline expiry atomically delete transient rows, record only aggregate content-free compliance evidence and invalidate downstream watch state. Failed provider refreshes cannot extend retention.

External-intelligence batches use deterministic source-contract, correction, policy, assessment and batch digests. Application validation binds every item to an effective source-contract version and reproduces every assessment from referenced items and policy. Database constraints reject changed identities, enforce chronology and source-contract compatibility, preserve corrections instead of rewriting history and expose a batch only after declared memberships are complete.

## AI design

No large language model participates in real-time order decisions. Later adaptive components may draft summaries, classifications or approved deterministic strategy rankings, but their output remains untrusted. The source registry, reaction gates, risk engine and execution policy remain deterministic and authoritative.
