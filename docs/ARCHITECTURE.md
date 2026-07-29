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
- immutable external-intelligence items, append-only corrections, content-addressed entity/syndication linkages and deterministic assessments;
- immutable compact external-intelligence backtest comparison manifests bound to exact replay, baseline-result and gated-result digests;
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

Reviewed pair-level declarations pass through a separate committed-evidence binding before lifecycle preparation. One bounded D1 lookup accepts only fixed status-incident captures or discovered listing/support documents with an immutable commit marker. The reviewed source URL, fetch time and payload SHA-256 must exactly match that committed row, source class must match the capture kind, and the commit must be available by the evidence recording time. Before any lookup or preparation, the binding boundary independently requires canonical document and AUD-pair identities, bounded non-empty declarations, publication no later than capture/recording, and the reviewed source-class event/scope matrix. Future-effective events remain valid after publication. The content-addressed binding retains the capture and commit identities; missing, ambiguous, changed, semantically incompatible or later commits fail closed.

Lifecycle backfill manifests bind the exact committed-evidence and prepared-evidence digests to one complete expected-pair coverage set. Partial sets remain persistable for audit and incremental progress but are explicitly non-authoritative. Only a manifest with exactly one complete row for every expected pair can set `coverage_authoritative`; this proves lifecycle coverage only and does not bypass current-market, quality, strategy, signed-policy or risk gates. D1 verifies membership counts before writing an immutable commit marker.

Market batches and candles use deterministic SHA-256 content digests. Database triggers reject identity reuse with different content and prevent ordinary update or delete operations. Gap detection is performed against explicit expected ranges before strategy research is allowed to rely on stored data.

Universe definitions, lifecycle events and quality observations are also append-only and hashed. Prepared universe evidence is submitted through one transactional D1 batch and is complete only when a final database-verified commit marker proves that every declared source and record membership exists. Historical reconstruction uses source publication and data-availability timestamps so later listings, suspensions, delistings or quality observations cannot leak into an earlier signal. The contract is defined in `docs/MARKET_UNIVERSE.md`.

External-intelligence linkages bind each reviewed topic to exact entity keys and allowed event types, apply append-only corrections as an effective view, remove retracted/deleted evidence, and collapse exact syndicated content to one authority-ranked representative before corroboration. Linkage manifests and clusters are content-addressed.

A separate content-addressed manipulation-evidence stage accepts only exact effective representative content whose reviewed policy permits excerpts or full-content processing. It transiently normalises that content, persists no raw text, compares bounded five-token shingle digests with a reviewed Jaccard threshold and uses deterministic complete-link clusters so transitive similarity cannot inflate a group. Every exact or near-duplicate group contributes one corroboration unit. Rapid near-duplicate publication by multiple publishers is surfaced as a watch-only coordination pattern, not asserted as identity proof. Missing or changed required fingerprints fail closed. Reddit post content, identifiers and content-derived hashes remain excluded from this durable path; content-free transient social watch state remains separate.

External-intelligence batches use deterministic source-contract, correction, policy, assessment and batch digests. Application validation binds every item to an effective source-contract version and reproduces every assessment from the referenced items and policy. Database constraints reject changed identities, enforce chronology and source-contract compatibility, preserve corrections instead of rewriting history and expose a batch only after its declared memberships are complete. Collection and assessment remain isolated from execution by Queue and deterministic reaction boundaries.

Approved RSS adapters re-verify exact payload length and SHA-256 before a bounded strict XML parse. Source-specific manifests constrain canonical origins, item identities, GUIDs, publication chronology, acquisition mode, attribution and retention. SEC, RBA, AUSTRAC and CFTC regulator items remain neutral and non-tradable at ingestion; title text is hashed but not retained or used to infer direction. Bitcoin Core announcements follow the same digest-only boundary under project-limited issuer authority.

External-intelligence backtest comparison manifests re-verify the complete replay and both full result digests before persistence. D1 stores the comparison, replay and result identities plus bounded aggregate differences rather than duplicating potentially large execution/equity arrays in one row. Exact retries preserve the first persistence time; changed identity reuse, updates and deletes fail closed. Research reports bind a sorted unique list of exact comparison identities, including an explicit empty list when external intelligence was not evaluated.

Hourly trend/breakout research runs bind the exact universe-verified plan, execution configuration and complete backtest result into one reproducible content identity. Verification re-runs the execution-aware backtest before persistence. D1 stores a compact immutable manifest of identities and derived aggregate metrics; conflicting retries, updates and deletes fail closed. Research reports bind sorted unique run identities, including an explicit empty list when no strategy run was evaluated. Run identity proves reproducibility only and cannot select or promote a strategy.

Reddit post-level state uses a separate transient boundary and never enters the immutable intelligence ledger or durable Queue. D1 preserves only bounded post identity metadata until the original deletion deadline. Deletes require a transaction-local purge authorization; provider removals and deadline expiry atomically delete transient rows, record only aggregate content-free compliance evidence and invalidate downstream watch state. Failed provider refreshes cannot extend retention.

## AI design

No large language model participates in real-time order decisions. Later adaptive components may draft summaries, classifications or approved deterministic strategy rankings, but their output remains untrusted. The source registry, reaction gates, risk engine and execution policy remain deterministic and authoritative.
