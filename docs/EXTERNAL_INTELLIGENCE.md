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

## Planned implementation

1. Persist immutable intelligence items and assessments.
2. Add the versioned provider/source registry and retention rules.
3. Add official exchange, regulator, issuer and publisher RSS/webhook adapters.
4. Add compliant Reddit OAuth collection with adaptive rate limiting.
5. Add minute-level collectors and queue-backed deduplicated processing.
6. Add deterministic entity/topic linking, syndication clustering and correction handling.
7. Integrate `pause-new-risk` with paper-mode risk controls.
8. Backtest news/social features without look-ahead using original publication and receipt timestamps.
9. Promote any risk-on use only after walk-forward, holdout, manipulation and cost evidence.

## Current limitation

This contract defines provenance, freshness, latency and reaction gates. It does not yet connect a Reddit account, news provider, live webhook, minute Cron Trigger, queue, model or order path. Provider credentials, commercial terms and paid subscriptions remain separately approved client/provider actions.

## Official references

- Reddit Data API Terms: https://redditinc.com/policies/data-api-terms
- Reddit Developer Terms: https://redditinc.com/policies/developer-terms
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
