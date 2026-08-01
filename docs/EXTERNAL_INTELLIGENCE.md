# Near-real-time external intelligence

## Objective

The bot is intended to remain continuously informed by official exchange and issuer announcements, regulators, mainstream and specialist news, Reddit and other approved public sources.

“Live” means near-real-time within the delivery limits of each source. It does not mean zero latency. Every observation records publication time, receipt time, availability time, assessment time and the measured delays between them. The system must expose delayed, stale or unavailable sources rather than presenting them as current.

## Delivery tiers

1. **Webhook or stream** — preferred when an approved provider offers authenticated push delivery.
2. **Priority minute polling** — used for official feeds, high-priority news feeds and approved Reddit watchlists when push delivery is unavailable.
3. **Normal scheduled polling** — used for lower-priority research sources and historical enrichment.
4. **Backfill** — separate from live decisions and never allowed to leak later knowledge into earlier research timestamps.

Cloudflare Cron can support a dedicated every-minute collector. Queue-backed processing will isolate collection from classification, deduplicate at-least-once delivery and allow independent retries. Provider publication and delivery delays remain outside the bot’s control.

## Source authority

- `official-exchange`, `regulator` and `issuer` sources are authoritative only for claims within their own scope.
- `mainstream-news` and `specialist-news` sources are reputable corroborating sources according to a versioned source registry.
- `reddit` is a social-attention and early-rumour source. It is not authoritative evidence.

Multiple articles from the same publisher count as one publisher. Syndicated copies, reposts and quote-only stories must not create false corroboration.

## Reaction boundary

External intelligence may produce only:

- `ignore`;
- `watch`;
- `research-candidate`; or
- `pause-new-risk`.

It never submits or approves an order.

An authoritative severe negative event such as a delisting, trading halt, security incident, regulatory action or network incident may immediately pause new risk while the deterministic risk engine verifies portfolio impact. Two independent reputable negative sources may also pause new risk when no authoritative source is yet available.

Positive news may become a research candidate only after authoritative or independent reputable corroboration. It must then pass market-data freshness, spread, liquidity, impact, portfolio, strategy and signed-policy gates. Reddit-only or rumour-only evidence remains a watch signal regardless of volume or sentiment.

## Reddit compliance

Reddit access must use an approved Reddit Data API or another expressly permitted Reddit product. The collector must:

- use the required OAuth identity and truthful user agent;
- obey current response headers, rate limits, backoff and access terms;
- avoid unauthenticated or evasive scraping;
- store only data permitted and necessary for the approved use case;
- support deletion and retention obligations;
- never mark Reddit content as permitted for model training;
- keep full-content storage disabled by default; and
- preserve source attribution when content is shown to a user.

Reddit posts and comments may support attention, novelty, topic velocity, cross-community spread and rumour detection. They cannot independently create a risk-on candidate or a live order.

## Reddit OAuth acquisition boundary

Reddit collection uses a separate OAuth-only transport rather than the generic publisher-feed adapter. An enabled Reddit source contract must bind the exact `https://oauth.reddit.com/` origin, the Reddit Data API terms, required attribution, metadata-only storage, deletion handling, model-training prohibition and a finite retention limit no longer than 48 hours.

The runtime must supply an approved OAuth access token and a truthful canonical User-Agent containing the actual Reddit username. Neither value enters capture evidence or durable state. Targets are exact canonical `/r/{subreddit}/new?limit=100&raw_json=1` endpoints; redirects, unauthenticated traffic, non-JSON media, inconsistent lengths, invalid listings and bodies over one MiB fail closed.

As rechecked against Reddit's official documentation on 2 August 2026, eligible free access is limited to 100 queries per minute per OAuth client ID, averaged over a ten-minute window. The transport converts `X-Ratelimit-Used`, `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` into bounded integer milliquery state, preserves a ten-percent reserve, spaces requests by at least one second and defers without network access while the prior budget remains active. HTTP 429 requires a bounded `Retry-After` and produces an explicit rate-limited outcome without retaining the response body.

Capture identity uses the shared external-intelligence payload contract and binds source, contract, mode, chronology, exact payload digest, byte length and media type. Full listing bytes remain transient and carry a deletion deadline only. Minimal post normalisation and bounded OAuth info sweeps discard titles, bodies, authors and provider permalinks. Missing, provider-removed, deleted or expired posts produce immediate purge actions. Dedicated transient D1 persistence requires explicit per-operation deletion authorization, preserves the first deletion deadline, purges expired rows even when Reddit is unavailable and invalidates downstream aggregate watch state after removal. Immutable retention audits and watch-state events contain source-level counts and state only. Approved account terms and deployed credentials remain separate work. Reddit evidence remains social/watch-only and cannot approve or submit an order.

## News and official-source compliance

Every collector requires a versioned source contract covering:

- provider and publisher identity;
- delivery method and polling limits;
- content licence and retention class;
- attribution requirements;
- publication and update semantics;
- canonical external identity;
- deletion/correction handling; and
- permitted model use.

Licensed APIs, provider webhooks and publisher RSS/Atom feeds are preferred. Search-engine snippets, copied articles and unsupported scraping are not authoritative source content.

## Evidence and latency

Each item binds:

- source kind, authority, publisher and canonical URL;
- provider external ID;
- acquisition mode;
- topic and canonical asset symbols;
- structured event type and stance;
- publication, receipt and availability times;
- exact payload and permitted-content digests;
- credibility and extraction confidence;
- source-specific content-storage policy; and
- explicit prohibition on model training.

Assessments preserve accepted and rejected item IDs, independent publisher count, source-class counts, maximum publication-to-receipt delay, age at assessment, warnings and a deterministic SHA-256 identity.

Dashboards and research reports must show latency distributions and the percentage of items rejected for staleness, late receipt, low credibility or ambiguity.

## Model boundary

A language model may later produce summaries, topic suggestions or classification drafts for research, subject to source terms. Model output is untrusted and cannot directly change exposure, approve an event, sign a strategy configuration or submit an order.

The real-time boundary remains deterministic: source allowlist, timestamps, identity, corroboration, event severity, freshness, market quality, risk policy and execution policy.

## Manipulation controls

- Social volume is normalised by source and community rather than treated as raw truth.
- Bot-like repetition, copied text and coordinated reposts are clustered before publisher/community counts are used.
- Account age, moderation state or engagement metrics may be recorded only where permitted and must not be treated as identity proof.
- Sudden attention without reputable corroboration cannot increase exposure.
- Conflicting authoritative reports fail closed and trigger operator review.
- Corrections and deleted content create new immutable evidence states; history is not rewritten.

## Persistence boundary

The persistence boundary stores versioned source contracts, immutable items, append-only corrections and deterministic assessments in content-addressed ingestion batches. Exact retries are idempotent. Changed item, provider-event, assessment or batch identities fail closed, and a batch becomes usable only after its membership, evidence-digest and chronology checks produce an immutable commit marker.

## Acquisition adapter boundary

Registry-bound feed and webhook acquisition is a transport boundary, not a classification or trading boundary.

- Polling accepts only an enabled, effective source-contract version whose source origin and acquisition mode match the target.
- Official, regulator, issuer and approved publisher targets may use `minute-poll`, `scheduled-poll` or authenticated `webhook` delivery as permitted by their contract. Reddit is rejected and remains reserved for the separate approved OAuth collector.
- Polling uses canonical HTTPS targets, rejects credential or signature query parameters, rejects redirects and unsupported media types, and applies one bounded retry for transient network, timeout, HTTP 408, HTTP 429 and server failures.
- `Retry-After` is respected but bounded. Conditional `ETag` and `Last-Modified` requests preserve explicit not-modified observations instead of fabricating new content.
- One bounded deadline remains active through response headers, streamed-body receipt and payload hashing. Bodies above one MiB, empty bodies and invalid declared lengths fail closed.
- Webhook payloads require POST, an approved media type and a provider-specific signature verifier before they become available for downstream processing.
- Every accepted payload records request start, receipt, availability, response latency, availability latency, exact byte length, SHA-256, cache validators, source-contract digest and a deterministic capture identity.
- Raw bytes are transient unless the exact source contract permits full-content retention. Model-training permission remains false.

The adapter output still requires source-specific RSS, Atom, JSON Feed or provider-event parsing, canonical item identity, publication-time extraction, retention enforcement, immutable batch persistence and deterministic assessment before it can influence research state.

## SEC press-release RSS boundary

The SEC press-release RSS feed is an approved lower-priority regulator source using `scheduled-poll`, not a zero-delay or minute-level claim. Its source contract binds the exact official feed, SEC origin, publisher/provider identities, digest-only retention, attribution, licence snapshot and explicit model-training prohibition.

The parser re-verifies payload length and SHA-256, accepts exactly one bounded UTF-8 RSS root without document-type or custom-entity declarations, and requires canonical SEC press-release links, matching GUIDs and publication times no later than receipt. It retains deterministic identity, chronology and digests but not titles or raw XML.

Every item remains a neutral `other` event scoped to the non-tradable `SEC.REGULATOR` marker until a separately reviewed deterministic entity/event linker exists. It cannot pause new risk, create a positive research candidate, approve an order or submit an order. Automated requests require a truthful contact-bearing User-Agent supplied at runtime; no contact address is committed.

## RBA media-release RSS boundary

The official RBA media-release RSS feed is an approved scheduled regulator source. Its contract requires digest-only retention, RBA attribution, the published copyright terms and no model training.

The parser reproduces capture and payload identities, accepts one bounded UTF-8 RSS root and canonical RBA media-release identifiers, and retains only deterministic identity, chronology and digests. Titles and raw XML are transient. Items remain neutral `macro` evidence under non-tradable `AUD.MACRO`; they cannot pause new risk, create positive candidates or grant order authority.



## Bitcoin Core announcement RSS boundary

Bitcoin Core's official security and release announcement feed is an approved lower-priority issuer source using `scheduled-poll`. The source contract binds the exact project feed and origin, digest-only retention, the reviewed website licence snapshot and model-training prohibition.

The parser reproduces active source-contract and capture identities, re-verifies payload length and SHA-256 through the bounded strict RSS boundary, accepts only canonical dated Bitcoin Core announcement URLs, matching GUIDs and strict publication chronology, and enforces the project's five-item feed bound. It retains deterministic identities, source URLs, chronology and content digests, but never titles or raw XML.

Every item is neutral `other` evidence under non-tradable `BTC.CORE`. It cannot pause new risk, create a positive candidate, approve an order or submit an order.

## AUSTRAC media-release RSS boundary

AUSTRAC's official media-release RSS feed is an approved lower-priority Australian regulator source using `scheduled-poll`. AUSTRAC documents RSS-reader polling and licenses its own website material for attributed reuse. The source contract binds the exact official feed and AUSTRAC origin, digest-only retention, required attribution, the reviewed copyright snapshot and model-training prohibition.

The parser reproduces active source-contract and capture identities, re-verifies payload length and SHA-256 through the bounded strict RSS boundary, and accepts only official canonical AUSTRAC release paths, exact matching GUIDs and strict publication chronology. It retains deterministic identities, source URLs, chronology and content digests, but never titles or raw XML.

Every item is neutral `regulatory-action` evidence under the non-tradable `AUSTRAC.REGULATOR` scope until a separately reviewed deterministic entity/event linker exists. It cannot pause new risk, create a positive candidate, approve an order or submit an order. AUSTRAC has announced that the RSS feed will be withdrawn in favour of email subscriptions; collection must expose any feed failure as stale/unavailable and must not silently scrape the website as a replacement.

## Kraken active-maintenance boundary

Kraken's official Status API active-maintenance endpoint is an approved account-free official-exchange source using `minute-poll`. Kraken documents the endpoint specifically for programmatic access. The source contract binds the exact API origin and endpoint, digest-only retention, transient payload handling and explicit model-training prohibition.

The parser reproduces capture and payload identities, enforces a one MiB payload ceiling, validates the exact Kraken Status page identity, bounded provider identifiers, active `in_progress` or `verifying` state, maintenance-window chronology, unique update identities and canonical provider timestamps. Provider names and update bodies contribute only to digests and are not retained or queued.

Statuspage `maintenance`, `none` and `minor` impacts remain neutral. Only structured `major` or `critical` impact becomes authoritative negative `market-structure` evidence under non-tradable `KRAKEN.VENUE` scope and may request `pause-new-risk`; it still cannot approve or submit an order. Unknown impact or state values fail closed. The deployed minute collector remains pending.

## Planned implementation

1. [x] Persist immutable intelligence items and assessments.
2. [x] Add the versioned provider/source registry and retention rules.
3. [x] Add registry-bound bounded feed polling and authenticated webhook payload acquisition.
4. [ ] Add approved source manifests, source-specific parsing, provider signature implementations and deployed endpoints.
   - [x] Add a scheduled SEC press-release RSS manifest and deterministic metadata-only normaliser.
   - [x] Add a scheduled RBA media-release RSS manifest and neutral metadata normaliser.
   - [x] Add a scheduled AUSTRAC media-release RSS manifest and neutral metadata normaliser with retirement monitoring.
   - [x] Add a scheduled Bitcoin Core announcement RSS manifest and neutral metadata normaliser.
   - [x] Add a one-minute Kraken active-maintenance Status API manifest and deterministic digest-only normaliser.
   - [ ] Add further approved source manifests, source-specific parsing, provider signature implementations and deployed endpoints.
5. [ ] Add compliant Reddit OAuth collection with adaptive rate limiting.
   - [x] Add OAuth-only watchlist acquisition with truthful runtime identity, active-contract checks, shared capture identity, adaptive rate-limit state and a maximum 48-hour deletion contract.
   - [x] Add minimal transient post normalisation and provider-deletion/retention reconciliation.
   - [x] Add purge-enforced transient persistence and downstream invalidation.
   - [ ] Supply approved hosted credentials and deploy the collector.
6. [ ] Add minute-level collectors and queue-backed deduplicated processing.
   - [x] Bind the existing minute collector and idempotent consumer to paper-only Cron, Queue/DLQ and D1 runtime configuration.
   - [x] Generate a content-addressed paper activation manifest from exact reviewed evidence and document owner-gated activation and rollback.
   - [ ] Provision hosted paper resources and deploy only after a reviewed milestone approval.
7. [x] Add deterministic entity/topic linking, syndication clustering and correction handling.
   - [x] Add reviewed entity/topic rules, exact-content syndication clustering and correction-safe representative selection.
   - [x] Add permitted-content near-duplicate/repost clustering and coordinated-manipulation evidence.
   - [x] Bind exact linkage/manipulation partitions to reproduced immutable assessments.
8. [x] Integrate `pause-new-risk` with paper-mode risk controls.
9. [ ] Backtest news/social features without look-ahead using original publication and receipt timestamps.
10. [ ] Promote any risk-on use only after walk-forward, holdout, manipulation and cost evidence.

## Current limitation

The persistence, reaction, generic acquisition-transport and deterministic exact-content linkage boundaries, scheduled SEC, RBA, AUSTRAC and Bitcoin Core RSS parsers, the Kraken active-maintenance minute-source normaliser, paper-only Cron/Queue/DLQ runtime bindings, a content-addressed non-activating paper activation-manifest builder, bounded Reddit OAuth acquisition, transient post lifecycle, purge-enforced transient D1 persistence and downstream watch-state invalidation are implemented. All paper runtime bindings remain disabled and undeployed; no reviewed evidence digest, enabled source contract or activation configuration is committed. An approved Reddit app and deployed credentials remain absent. No truthful SEC runtime contact, deployed collector, Reddit account, news-provider account, live webhook endpoint, provisioned minute Cron Trigger, queue, model or order path is connected. Permitted-content near-duplicate/repost and rapid multi-publisher coordination evidence is implemented with correction-effective fingerprint chronology. This tree adds deterministic assessment-persistence integration with exact cross-artifact partition and representative binding. A fresh paper-only `pause-new-risk` gate re-verifies the complete linkage, manipulation-evidence and integrated-assessment chain before suppressing proposed buys; exits remain available and non-paper modes remain disconnected. Provider credentials, account terms, commercial terms, licences and paid subscriptions remain separately approved client/provider actions.

## Official references

- Kraken Status API: https://status.kraken.com/api
- Kraken active maintenances: https://status.kraken.com/api/v2/scheduled-maintenances/active.json

- Bitcoin Core RSS guidance: https://bitcoincore.org/en/rss/
- Bitcoin Core announcement feed source: https://github.com/bitcoin-core/bitcoincore.org/blob/master/en/announcements.xml
- AUSTRAC RSS guidance: https://www.austrac.gov.au/subscribing-media-release-alerts
- AUSTRAC copyright and attribution: https://www.austrac.gov.au/copyright
- Reddit Data API Terms: https://redditinc.com/policies/data-api-terms
- Reddit Developer Terms: https://redditinc.com/policies/developer-terms
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
