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

Reddit collection uses a separate OAuth-only transport rather than the generic publisher-feed adapter. An enabled Reddit source contract must bind `https://oauth.reddit.com/`, the Reddit Data API terms, required attribution, metadata-only storage, deletion handling, model-training prohibition and a finite retention limit no longer than 48 hours.

The runtime must supply an approved OAuth access token and a truthful canonical User-Agent containing the actual Reddit username. Neither value is returned in captures or durable state. Targets are exact canonical `/r/{subreddit}/new?limit=100&raw_json=1` endpoints; redirects, unauthenticated traffic, non-JSON media, invalid listings and bodies over one MiB fail closed.

The transport parses `X-Ratelimit-Used`, `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` into integer milliquery state. It caps free access at the documented 100 QPM averaged across the current ten-minute window, preserves a ten-percent reserve, spaces requests by at least one second and defers without network access when the prior budget is active. HTTP 429 requires a bounded `Retry-After` and produces an explicit rate-limited outcome without retaining the response body.

Post normalisation now validates only bounded structured post identity, subreddit, publication time and canonical permalink shape while discarding titles, bodies, authors and provider permalinks. Post-level observations remain transient, are explicitly prohibited from the durable intelligence queue, and receive a deletion deadline no later than 48 hours after availability.

Recurring retention checks use Reddit's documented OAuth `[/r/subreddit]/api/info` listing for at most 100 exact post fullnames. Missing, Reddit-deleted, moderator-removed or expired observations produce immediate purge actions. Only source-level sweep time and aggregate counts enter the content-free compliance audit; post IDs, account IDs, content and content-derived hashes do not. Transient D1 persistence requires explicit per-operation deletion authorization, preserves the first deletion deadline, purges expired rows even when Reddit is unavailable and invalidates downstream aggregate watch state after every removal. Immutable retention audits and watch-state events contain counts and state only. Deployed approved credentials remain separate work. Reddit evidence remains social/watch-only and cannot approve or submit an order.

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

## Acquisition adapter boundary

Registry-bound feed and webhook acquisition is a transport boundary, not a classification or trading boundary.

- Polling accepts only an enabled, effective source-contract version whose source origin and acquisition mode match the target.
- Official, regulator, issuer and approved publisher targets may use `minute-poll`, `scheduled-poll` or authenticated `webhook` delivery as permitted by their contract. Reddit is rejected and remains reserved for the separate approved OAuth collector.
- Polling uses canonical HTTPS targets, rejects credential or signature query parameters, rejects redirects and unsupported media types, and applies one bounded retry for transient network, timeout, HTTP 408, HTTP 429 and server failures.
- `Retry-After` is respected but bounded. Conditional `ETag` and `Last-Modified` requests preserve explicit not-modified observations instead of fabricating new content.
- A single deadline remains active through response headers, streamed-body receipt and payload hashing. Bodies above one MiB, empty bodies and invalid declared lengths fail closed.
- Webhook payloads require POST, an approved media type and a provider-specific signature verifier before they become available for downstream processing.
- Every accepted payload records request start, receipt, availability, response latency, availability latency, exact byte length, SHA-256, cache validators, source-contract digest and a deterministic capture identity.
- Raw bytes are transient unless the exact source contract permits full-content retention. Model-training permission remains false.

The adapter output still requires source-specific RSS, Atom, JSON Feed or provider-event parsing, canonical item identity, publication-time extraction, retention enforcement, immutable batch persistence and deterministic assessment before it can influence research state.

## SEC press-release RSS boundary

The SEC press-release RSS feed is an approved lower-priority regulator source using `scheduled-poll`, not a zero-delay or minute-level claim. Its source contract binds the exact official feed, SEC origin, publisher/provider identities, digest-only retention, attribution, licence snapshot and explicit model-training prohibition.

The parser re-verifies payload length and SHA-256, accepts only bounded UTF-8 RSS without document-type or custom-entity declarations, and requires canonical SEC press-release links, matching GUIDs and publication times no later than receipt. It retains deterministic identity, chronology and digests but not titles or raw XML.

Every item remains a neutral `other` event scoped to the non-tradable `SEC.REGULATOR` marker until a separately reviewed deterministic entity/event linker exists. It cannot pause new risk, create a positive research candidate, approve an order or submit an order. Automated requests require a truthful contact-bearing User-Agent supplied at runtime; no contact address is committed.

## RBA media-release RSS boundary

The Reserve Bank of Australia media-release RSS feed is an approved lower-priority regulator source using `scheduled-poll`. The RBA explicitly provides the feed for automated updates and identifies WAF-protected RSS access. Its source contract binds the exact feed and RBA origin, digest-only retention, required attribution, a copyright/licence snapshot and model-training prohibition.

The parser re-verifies payload length and SHA-256 through a reusable strict RSS boundary, rejects malformed roots/channels/items, document types and custom entities, and requires canonical RBA media-release paths, matching GUIDs and publication times no later than receipt. It retains deterministic identity, chronology and digests but not titles or raw XML.

Every item remains neutral `macro` evidence under the non-tradable `AUD.MACRO` scope. No headline wording is used to infer direction, severity or order action; the feed cannot pause new risk, create a positive research candidate, approve an order or submit an order.

## AUSTRAC media-release RSS boundary

AUSTRAC's official media-release RSS feed is an approved lower-priority Australian regulator source using `scheduled-poll`. AUSTRAC explicitly documents automatic RSS-reader polling and licenses its own website material for attributed reuse. The source contract binds the exact official feed and AUSTRAC origin, digest-only retention, required attribution, the reviewed copyright snapshot and model-training prohibition.

The parser re-verifies payload length and SHA-256 through the bounded strict RSS boundary. It accepts only canonical current AUSTRAC media-release paths, exact matching GUIDs and publication times no later than receipt. It retains deterministic identities, source URLs, chronology and content digests, but never titles or raw XML.

Every item is neutral `regulatory-action` evidence under the non-tradable `AUSTRAC.REGULATOR` scope until a separately reviewed deterministic entity/event linker exists. It cannot pause new risk, create a positive candidate, approve an order or submit an order. AUSTRAC announced that the RSS feed will be withdrawn in favour of email subscriptions; collection must therefore expose any feed failure as stale/unavailable and must not silently scrape the website as a replacement.

## Bitcoin Core announcement RSS boundary

Bitcoin Core's official English announcement RSS feed is an approved account-free project-origin `issuer` source using `scheduled-poll`. The project explicitly publishes security and release announcements through this feed. Its source contract binds the exact feed, origin and publisher/provider identities, digest-only retention, attribution, the reviewed website-repository MIT licence notice and model-training prohibition. Authority is limited to Bitcoin Core software announcements, not general claims about Bitcoin or market direction.

The parser re-verifies payload length and SHA-256 through the bounded strict RSS boundary. It accepts at most the five items produced by the official feed, canonical dated English announcement paths, valid calendar dates, exact matching GUIDs and publication times no later than receipt. It retains deterministic identities, source URLs, chronology and content digests, but never titles or raw XML.

Every item remains neutral `other` evidence under non-tradable `BTC.CORE`. No title text is used to infer release type, severity, asset direction or trading action; this source cannot pause risk, create a positive candidate, approve an order or submit an order until separately reviewed deterministic classification and entity-linking evidence exists.

## Kraken active-maintenance boundary

Kraken's official Status API active-maintenance endpoint is an approved account-free official-exchange source using `minute-poll`. Kraken documents the endpoint specifically for programmatic access. The source contract binds the exact API origin and endpoint, digest-only retention, transient payload handling and explicit model-training prohibition.

The parser re-verifies exact payload bytes and SHA-256, the Kraken Status page identity, bounded provider identifiers, active `in_progress` or `verifying` state, maintenance window chronology, unique update identities and the latest structured update state. Provider names and update bodies contribute only to digests and are not retained or queued.

The Statuspage `maintenance`, `none` and `minor` impacts remain neutral. Only structured `major` or `critical` impact becomes authoritative negative `market-structure` evidence under the non-tradable `KRAKEN.VENUE` scope and may request `pause-new-risk`; it still cannot approve or submit an order. Unknown impact or state values fail closed. The deployed minute collector remains pending.

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

The persistence boundary stores versioned source contracts, immutable items, append-only corrections and deterministic assessments in content-addressed ingestion batches. Exact retries are idempotent. Changed item, provider-event, assessment or batch identities fail closed, and a batch becomes usable only after its membership and chronology checks produce an immutable commit marker.

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

## Planned implementation

1. [x] Persist immutable intelligence items and assessments.
2. [x] Add the versioned provider/source registry and retention rules.
3. [ ] Add official exchange, regulator, issuer and publisher RSS/webhook adapters.
   - [x] Add registry-bound bounded feed polling and authenticated webhook payload acquisition.
   - [x] Add a scheduled SEC press-release RSS manifest and deterministic metadata-only normaliser.
   - [x] Add a scheduled RBA media-release RSS manifest and deterministic metadata-only normaliser.
   - [x] Add a scheduled AUSTRAC media-release RSS manifest and deterministic metadata-only normaliser with retirement monitoring.
   - [x] Add a scheduled Bitcoin Core announcement RSS manifest and deterministic digest-only normaliser.
   - [x] Add a one-minute Kraken active-maintenance Status API manifest and deterministic digest-only normaliser.
   - [ ] Add further approved exchange/issuer/news manifests, source-specific parsing, provider signature implementations and deployed endpoints.
4. [ ] Add compliant Reddit OAuth collection with adaptive rate limiting.
   - [x] Add OAuth-only watchlist transport with truthful runtime identity, adaptive rate-limit state and a maximum 48-hour deletion contract.
   - [x] Add transient minimal post normalisation, bounded deletion checks, purge planning and content-free compliance audits.
   - [x] Add purge-enforced transient persistence and downstream watch-state invalidation.
   - [ ] Supply approved hosted credentials and deploy the Reddit collector.
5. [ ] Add minute-level collectors and queue-backed deduplicated processing.
   - [x] Bind an inactive-by-default Preview minute Cron, bounded Queue/DLQ and D1 consumer while Production explicitly has no Cron or Queue resources.
   - [x] Generate a content-addressed Kraken Preview activation manifest from exact reviewed evidence and document owner-gated activation and rollback.
   - [ ] Provision approved Preview resources, install an exact reviewed source contract and activate collection.
6. [x] Add deterministic entity/topic linking, syndication clustering and correction handling.
   - [x] Add reviewed entity/topic rules, exact-content syndication clustering and correction-safe representative selection.
   - [x] Add permitted-content near-duplicate/repost clustering and coordinated-manipulation evidence.
7. [x] Integrate `pause-new-risk` with paper-mode risk controls.
8. [x] Backtest news/social features without look-ahead using original publication, receipt, availability and assessment timestamps.
   - [x] Add complete correction-effective snapshot replay, versioned reaction expiry, content-addressed frames and deterministic intent gates.
   - [x] Bind every execution request to its exact replay frame, suppress paused additions before fill modelling and emit content-addressed comparisons.
   - [x] Persist immutable compact comparison manifests and bind their identities into research-report provenance.
9. [ ] Promote any risk-on use only after walk-forward, holdout, manipulation and cost evidence.

## Current limitation

The persistence, reaction, generic acquisition-transport and deterministic exact-content linkage boundaries, scheduled SEC, RBA, AUSTRAC and Bitcoin Core RSS parsers, and the Kraken active-maintenance minute-source normaliser are implemented. Reddit OAuth transport, transient post normalisation, bounded deletion checks, purge-enforced transient D1 persistence and downstream watch-state invalidation are implemented, but approved hosted credentials remain pending. No truthful SEC runtime contact, deployed collector, Reddit account, news-provider account, live webhook endpoint, active minute Cron Trigger, provisioned queue, model or order path is connected. The Preview Cron and Queue/DLQ runtime blueprint and deterministic activation-manifest builder are implemented, but no real evidence digest, enabled contract, hosted resource or activation is committed. The reviewed activation and rollback runbook is documented; Production explicitly has no such bindings. Permitted-content near-duplicate/repost and rapid multi-publisher coordination evidence, immutable integrated-assessment persistence, a fresh paper-only `pause-new-risk` gate and no-look-ahead hourly research replay are implemented. Replay selects only complete snapshots assessed by the simulated decision time, preserves publication/receipt/availability/assessment latency and prevents later corrections from rewriting earlier frames. Intelligence-aware backtests bind every request to an exact verified frame, remove paused buys before fill modelling and preserve exits. Compact immutable comparison manifests persist exact replay and result identities, and research-report provenance binds the exact comparison digests. The paper gate suppresses new paper buys while preserving exits, records immutable risk evidence and remains disconnected from live mode. Provider credentials, commercial terms, licences and paid subscriptions remain separately approved client/provider actions.

## Official references

- Kraken Status API: https://status.kraken.com/api
- Kraken API documentation index: https://support.kraken.com/hc/articles/206548387-where-can-i-find-documentation-for-the-api-
- RBA RSS feeds: https://www.rba.gov.au/updates/rss-feeds.html
- RBA RSS access guidance: https://www.rba.gov.au/qa/rss.html
- RBA copyright and attribution: https://www.rba.gov.au/copyright/
- AUSTRAC RSS guidance: https://www.austrac.gov.au/subscribing-media-release-alerts
- AUSTRAC copyright and attribution: https://www.austrac.gov.au/copyright
- Bitcoin Core RSS feeds: https://bitcoincore.org/en/rss/
- Bitcoin Core announcements subscription: https://bitcoincore.org/en/list/announcements/join/
- Bitcoin Core website licence notice: https://github.com/bitcoin-core/bitcoincore.org/blob/master/COPYING
- Reddit Data API Terms: https://redditinc.com/policies/data-api-terms
- Reddit Developer Terms: https://redditinc.com/policies/developer-terms
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
