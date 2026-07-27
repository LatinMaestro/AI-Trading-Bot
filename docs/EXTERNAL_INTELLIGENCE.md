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
   - [ ] Add approved source manifests, source-specific parsing, provider signature implementations and deployed endpoints.
4. [ ] Add compliant Reddit OAuth collection with adaptive rate limiting.
5. [ ] Add minute-level collectors and queue-backed deduplicated processing.
6. [ ] Add deterministic entity/topic linking, syndication clustering and correction handling.
7. [ ] Integrate `pause-new-risk` with paper-mode risk controls.
8. [ ] Backtest news/social features without look-ahead using original publication and receipt timestamps.
9. [ ] Promote any risk-on use only after walk-forward, holdout, manipulation and cost evidence.

## Current limitation

The persistence, reaction and generic acquisition-transport boundaries are implemented, but no approved source manifest, source-specific parser, Reddit account, news-provider account, live webhook endpoint, minute Cron Trigger, queue, model or order path is connected. Provider credentials, commercial terms, licences and paid subscriptions remain separately approved client/provider actions.

## Official references

- Reddit Data API Terms: https://redditinc.com/policies/data-api-terms
- Reddit Developer Terms: https://redditinc.com/policies/developer-terms
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
