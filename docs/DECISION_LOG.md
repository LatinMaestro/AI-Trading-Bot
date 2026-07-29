# Decision log

## 2026-07-26 — Private repository and hosted-only development

Use `LatinMaestro/AI-Trading-Bot`. Development is performed through GitHub and hosted services rather than requiring the user's computer to run the application.

## 2026-07-26 — Spot-only scope

Exclude leverage, margin, futures, perpetuals, options, borrowing, lending, staking and shorting. The growth objective does not override this boundary.

## 2026-07-26 — No wallet custody

Do not connect MetaMask or request wallet signing authority. The user's ETH on Polygon remains under user control.

## 2026-07-26 — Kraken primary venue

Choose Kraken as the primary implementation because it exposes granular API permissions and key introspection. Higher fees are accepted initially in exchange for enforceable withdrawal exclusion and mature API behaviour.

## 2026-07-26 — Unsafe venue credentials excluded

Do not use a venue for unattended execution when its selected API key grants transfer, withdrawal, address-management or unrestricted account control. A future venue may be reconsidered only after current documentation and programmatic permission checks prove that trading authority can be isolated from custody authority.

## 2026-07-26 — Deterministic baseline before adaptive AI

Begin with transparent strategies, fee-aware backtesting and hard operational controls. Adaptive model selection is a later gated enhancement, not a substitute for evidence.

## 2026-07-26 — Cloudflare foundation

Use Cloudflare Workers and D1 to minimise infrastructure cost while preserving hosted scheduling, secrets, audit storage and deployment controls.

## 2026-07-26 — Immutable market-data ledger

Persist accepted committed 60-minute and daily candles as append-only D1 records with deterministic SHA-256 digests. Exact retries are idempotent, but a reused batch or candle identity with different content is a hard conflict. Ordinary updates and deletes are rejected by database triggers so research evidence cannot be silently rewritten.

Kraken REST is not treated as a complete historical archive. Its documented 720-row response includes the current uncommitted row, so gap repair assumes no more than 719 committed intervals remain recoverable. Older gaps must use a separately approved reproducible source, progressive collection or explicit exclusion from research.

## 2026-07-26 — Five-year aggressive mandate

Optimise strategy research for the aspirational objective of growing US$200 toward US$1,000,000 within five years of first authorised live-capital activation. Do not silently substitute a slow multi-decade wealth plan.

The universe is market-cap agnostic and may include approved blue chips, mid-caps, micro-caps and newly listed spot assets. Candidate research may use concentrated positions, up to 100% gross spot exposure, hourly decisions, multiple daily rebalances and maker or taker execution when realistic after-cost evidence supports them.

The user accepts the possible complete loss of the approved allocation. This capital-risk direction does not weaken operational safety: no leverage, debt, negative-balance strategy, automatic top-up, withdrawal authority, transfer authority, wallet signing, permission bypass or access to other funds is permitted.

Promotion requires objective-path reporting, risk-of-ruin and terminal-wealth analysis, realistic execution costs, survivorship-safe universe reconstruction, walk-forward evidence and a signed risk configuration. The target remains aspirational and must never be represented as promised or probable.

## 2026-07-26 — Conservative deterministic execution model

Use a pure target-weight backtest engine with a strict separation between signal time and later execution time. Model maker and taker fees, observed spread, taker slippage, maker adverse selection, explicit maker non-fill, participation limits, minimum orders, cash reserves and capped square-root price impact.

Do not award automatic spread capture to maker orders. Preserve partial and completely missed executions in the result. Sell reductions before purchases, and scale cash-constrained multi-asset buys proportionally so results do not depend on pair sort order.

The engine and synthetic fixtures validate arithmetic and invariants only. No fee, fill-rate, spread, depth, slippage or impact assumption may support a strategy conclusion until it is versioned and calibrated from time-appropriate venue and pair evidence.

## 2026-07-26 — Survivorship-safe dynamic universe

Store market definitions, lifecycle events and market-quality observations as immutable hashed records. Reconstruct membership using only definitions and observations available by the historical signal time and lifecycle events both effective and published by that time.

Retain suspended, Australian-disabled and delisted markets in history rather than deleting them from the research dataset. Treat a documented relisting as a new listing era. Conflicting simultaneous states, changed immutable identities and missing chronology fail closed.

Classify eligible assets into established, high-volatility or new-listing lanes using a signed policy. Nominal unit price and current survival do not confer eligibility. Every lane remains subject to instrument, Australian availability, valuation, data-quality, minimum-order, turnover, depth, spread and impact gates.

## 2026-07-26 — Objective and ruin-risk scenario metrics

Use a deterministic constant-compounding reference path for objective progress. Report remaining multiple and required forward rates without treating the path as a forecast.

Separate terminal capital-loss frequency from maximum-drawdown breach frequency. Summarise target attainment, terminal wealth and drawdown percentiles over equal-horizon, equal-cadence scenarios.

Use only seeded, versioned moving-block bootstrap scenarios when resampling is approved. Resampling output is a scenario frequency estimate, not a probability promise, and cannot repair biased universes, look-ahead leakage or unrealistic execution inputs.

## 2026-07-26 — Mandatory benchmarks and content-addressed reports

Every candidate report must include aligned AUD cash, BTC hold, equal-weight hold and objective-path series. Tradable benchmarks share the strategy currency; the USD objective remains separate unless a versioned FX-conversion digest is supplied.

Research-report v1 binds strategy and benchmark series, objective/ruin metrics, evaluation split, exact period, warnings and code/data/universe/configuration provenance into a canonical SHA-256 digest.

The digest proves content identity only. Live approval still requires a separately authorised signed strategy configuration and approval record after validated walk-forward, final-holdout, sensitivity, capacity and tax evidence.

## 2026-07-26 — Universe ingestion and AUD valuation provenance

Prepare scheduled universe evidence as deterministic content-addressed batches. Keep venue metadata, market-quality measurements, official lifecycle announcements and AUD conversion observations as separate source classes with independent fetch times and payload digests.

Do not infer a delisting from a pair being absent from one venue snapshot. Listing, suspension, resumption, delisting and Australian-availability events require explicit official evidence and valid publication chronology.

Convert quote-currency market metrics to AUD only through a fresh, knowable and unambiguous valuation path. Missing, stale or multiple shortest paths fail closed. Calibration summaries are evidence only; they do not automatically alter signed universe limits.

## 2026-07-26 — Explicit tax lots and content-addressed exports

Preserve one factual record for every crypto acquisition, disposal, crypto fee, transfer, income, expense or adjustment with UTC time, Australian local date, AUD value and source/valuation digests.

Do not choose tax lots automatically. Every disposal must be fully linked to explicit acquisition records through a versioned selection reference before a provisional CGT worksheet is produced. Asset mismatches, later acquisitions and over-allocation fail closed.

Export transactions, allocation outcomes and Australian financial-year summaries as deterministic CSV and canonical machine-readable content with one SHA-256 bundle digest. Spreadsheet formula-like text is neutralised. The digest proves content identity only; professional tax review remains mandatory.

## 2026-07-26 — Containment authority and explicit live recovery

Use severity-based incident handling with immediate live disablement for suspected compromise, unexpected or ambiguous orders, unexplained balance drift, immutable-record conflicts and material provider failures.

Containment authority is intentionally broad: an operator may disable schedules, activate the kill switch, revoke affected credentials or cancel unexpected open orders. Restoration authority is narrow: live operation requires complete exchange-authoritative reconciliation, corrective evidence, paper/shadow regression checks and explicit user approval.

Treat every exposed secret as compromised even if it is later deleted. Preserve redacted evidence digests, never secrets. Restore D1 only through an isolated verified recovery that preserves immutable audit, market, universe and tax evidence. Live-recovery approval never authorises a capital increase, broader permission, new venue or different strategy.

## 2026-07-26 — Database-verified universe ingestion commits

Persist each prepared universe-ingestion result through one transactional D1 batch containing the batch header, source digests, immutable definitions/events/observations, record memberships and a final commit marker.

The database permits the commit marker only when actual source and record membership counts match the content-addressed header. Exact retries are idempotent. Changed identity reuse aborts, and transaction rollback prevents orphaned provenance. Ordinary updates and deletes of batch evidence are prohibited.

Only committed batches are complete research evidence. This persistence boundary does not yet fetch scheduled Kraken metadata, ticker/depth quality or AUD conversion inputs and adds no private API or order capability.

## 2026-07-26 — Content-addressed Kraken public quality evidence

Use Kraken's official `assetVersion=1` AssetPairs, Ticker and Depth contracts for scheduled universe source evidence. Hash the exact successful response text and retain its public URL and fetch time before typed parsing.

Reject legacy or ambiguous pair keys, malformed envelopes, incomplete requested ticker sets, crossed markets, unordered books, unsafe times and non-finite arithmetic. Derive quote turnover from 24-hour base volume and VWAP. Derive spread and two-sided capacity from one coherent L2 book. Report candidate impact as unavailable when displayed depth cannot fill both sides rather than inventing a favourable value.

This slice deliberately stops before scheduled persistence. Complete observations still require committed candle counts, annualised volatility, fresh AUD conversion and lifecycle evidence. No private endpoint, credential or order path is added.

## 2026-07-26 — Lease-protected scheduled public universe collection

After the global cycle lease and scheduled-slot claim, fetch Australian Kraken metadata and tickers, rotate a bounded order-book window every 15 minutes, derive fresh AUD-valued quality observations and atomically commit the batch before strategy evaluation.

Use the content-addressed client and quality contracts rather than duplicate parsing. Apply bounded retry, timeout, response-size and request-spacing controls, and record actual HTTP attempts plus the committed batch digest in the cycle audit.

Never infer lifecycle events from current snapshots. Until committed history and volatility evidence are joined, collected observations remain history-incomplete and dynamic-universe eligibility is not authoritative for strategy selection. No private or live-order capability is added.

## 2026-07-27 — Stored candle history and realised-volatility evidence

Join each bounded scheduled universe window to committed D1 candle evidence available by the scheduled signal time. Read aggregate counts and contiguity for hourly and daily intervals in one transactional batch with a bounded trailing 366-daily-candle sample for annualised log-return volatility.

A history state is complete only when both intervals exist, their aggregate ranges are contiguous, at least three daily closes support volatility, and the latest closes are fresh. Missing, gapped or stale history remains explicit and cannot make a dynamic-universe candidate eligible. Batch fetch timestamps and candle close times after the signal time are excluded to prevent look-ahead.

This evidence changes public research metadata only. It adds no private endpoint, credential, order, fund, withdrawal, transfer, wallet, leverage or derivative capability.

## 2026-07-27 — Allowlisted official lifecycle evidence

Accept lifecycle declarations only when they bind an exact content digest to a Kraken-owned listing article, support article or status incident/API document. Source class controls the permitted event types and geographic scope: regional restrictions cannot become global delistings, and global listing announcements do not prove Australian availability.

Do not extract lifecycle events from free text with a language model or keyword heuristic. Reviewed declarations must state canonical pair, event type, scope, effective time and publication time. Future-effective events are valid when already published, but historical reconstruction applies them only after their effective time.

Audit listing, trading-status and Australian-availability coverage independently for every expected pair. Missing coverage remains explicit and blocks survivorship-safe venue-wide claims. Complete historical backfill and scheduled raw-source persistence remain separate work.

## 2026-07-27 — Daily immutable Kraken lifecycle source capture

At the 00:00 UTC scheduled slot, capture the fixed Kraken asset-listing index, delistings index, status incidents feed and scheduled-maintenance feed before public universe evaluation. Use public HTTPS only, bounded timeout/retry/spacing controls, strict media types, a one MiB streaming ceiling and exact UTF-8 byte round-tripping.

Store each distinct exact payload text once, keyed by its SHA-256 and original byte length. Preserve every fetch as a separate immutable capture binding source kind, exact URL, fetch time, media type and bounded cache headers to that payload. The one MiB ceiling remains below D1's documented two MB string/row limit and permits one bounded statement per payload without JSON expansion.

Persist payloads, capture headers and database-verified commit markers in one D1 transactional batch; reject changed identity reuse, commits before fetch time and ordinary mutation. Raw capture does not create lifecycle events and uses no free-text AI extraction. Individual listing, delisting and regional-availability documents still require deterministic discovery, exact capture and reviewed pair-level declarations. This public evidence capability adds no credential, private API, account, wallet, fund or order authority.

## 2026-07-27 — Deterministic Kraken lifecycle document discovery

Discover candidate lifecycle documents only from the exact preserved Kraken listing and delisting index payloads after verifying their SHA-256 identities again. Parse bounded quoted links and accept only source-specific canonical Kraken Blog listing articles, listing-index pagination pages and Kraken Support article targets.

Bind every target to its exact index capture and payload digest, deduplicate and sort deterministically, and content-address the complete discovery result. Reject non-HTTPS, untrusted, queried, fragmented, encoded, cross-index or excessively large link sets.

Do not infer lifecycle meaning from support titles, link text or URL words. Support targets remain generic until reviewed, captured and explicitly classified. This discovery step creates no lifecycle declarations and adds no private endpoint, credential, account, wallet, fund or order capability.

## 2026-07-27 — Near-real-time external intelligence boundary

Collect official announcements, approved news and compliant Reddit observations through webhook, stream or scheduled polling adapters with explicit publication, receipt, availability and assessment times. “Live” means measured near-real-time delivery; source publication and provider delivery delays are never hidden.

An authoritative severe negative event may pause new risk while deterministic market, account and portfolio checks run. Positive news requires authoritative or independent reputable corroboration and can create only a research candidate. Reddit-only and rumour-only evidence remains a watch signal regardless of volume. External intelligence never submits or approves an order.

Reddit access must use approved API access, truthful OAuth identity, current rate limits, minimal permitted retention, deletion handling and no model-training permission. Publisher content requires a versioned licence/retention/attribution contract. Language-model output is an untrusted research draft and cannot cross the deterministic order boundary.

## 2026-07-27 — Immutable external-intelligence evidence and source contracts

Persist each external-intelligence slice as one content-addressed D1 batch containing versioned source contracts, immutable items, append-only corrections, deterministic assessment records, exact memberships and a final database-verified commit marker. Exact retries are idempotent; changed natural identities, source-contract mismatches, invalid chronology or incomplete memberships fail closed.

Every source contract binds provider and publisher identity, allowed acquisition modes, content licence digest, attribution, retention, deletion handling, effective dates and explicit model-use prohibition. Reddit full-content storage remains disabled by default, finite retention and deletion handling are mandatory, and Reddit-only evidence cannot cross the watch boundary.

Corrections, retractions and deletions create new immutable records rather than rewriting prior evidence. Assessments must reproduce exactly from the referenced items and policy before persistence. This slice adds no provider connection, credential, collector, queue, private exchange API or order authority.

## 2026-07-27 — Registry-bound external-intelligence acquisition transport

Acquire approved official exchange, regulator, issuer and publisher feed or webhook payloads only through a verified, enabled and effective source-contract version whose origin and acquisition mode match the target. Keep Reddit outside this transport and reserve it for a separately approved OAuth collector.

Polling rejects redirects, credential-bearing query parameters, unsupported media types, invalid lengths, empty or oversized bodies and unsafe cache validators. Use conditional requests, one bounded transient retry, bounded `Retry-After` handling and one deadline spanning request, streamed-body receipt and payload hashing. Authenticated webhooks require a provider-specific signature verifier before payload availability.

Record request, receipt and availability times, measured delays, exact byte length, SHA-256, cache validators, contract digest and deterministic capture identity. Raw bytes remain transient unless the exact contract permits full retention. Acquisition does not parse events, classify evidence, approve risk or submit orders.

## 2026-07-27 — Normalised at-least-once external-intelligence queue

Queue only source-contract-verified normalised intelligence records, acquisition metadata and content digests. Raw provider bytes and arbitrary binary content never enter the queue. Every queued item must bind the exact acquisition mode, payload digest, receipt time and availability chronology of its capture. The canonical message identity covers its source contract, evidence, deterministic assessment requests and enqueue time, and the envelope remains below a conservative 120,000-byte ceiling.

The consumer verifies the canonical message, reproduces deterministic assessments from the referenced items and policy, and completes the existing content-addressed transactional D1 persistence before acknowledging delivery. Process at-least-once deliveries independently: acknowledge successful messages, retry failed messages with bounded exponential delay, and rely on database identity-conflict and exact-retry rules rather than assuming exactly-once transport.

Advance conditional polling validators only after successful enqueue, confirmed not-modified handling or confirmed no-item normalisation. Queue or source failures remain explicit stale/delayed outcomes. Durable cache storage, minute Cron, Queue/DLQ bindings and deployed consumer wiring remain separate work. This queue cannot submit or approve orders and adds no credential, private exchange, fund, withdrawal, transfer, wallet or live-trading capability.

## 2026-07-27 — Structured Kraken Status incident intelligence

Use Kraken's official unresolved-incidents JSON endpoint as a dedicated one-minute official-exchange source only under an enabled, digest-only source contract whose source ID, publisher, provider, origin, acquisition mode and endpoint match the reviewed manifest. Verify exact payload byte length and SHA-256 again before UTF-8 JSON parsing.

Classify from structured Statuspage fields only. Unresolved `major` and `critical` impacts become authoritative negative `network-incident` evidence that may request `pause-new-risk`; `minor` and `none` remain neutral. Do not inspect incident names or update bodies to determine severity, assets, strategy direction or order action. Use the reserved `KRAKEN.VENUE` scope marker to identify a non-tradable venue-wide event.

Retain only deterministic IDs, chronology, structured status/impact fields and content digests. Hash update body content transiently but do not retain or queue the raw body. Empty unresolved feeds create no queue work; malformed, resolved, conflicting, oversized, wrong-origin or digest-mismatched evidence fails closed. The source cannot create a positive candidate, approve an order or submit an order, and adds no credential, provider account, private API, fund, withdrawal, transfer, wallet, leverage, derivative or live-trading capability.

## 2026-07-27 — Durable monotonic external-intelligence cache state

Persist conditional `ETag` and `Last-Modified` validators in D1 by source ID so minute collectors retain transport state across Worker instances and restarts. Validator text is bounded and canonical, observation times are non-negative integers, and every write is verified by reading back the stored row.

Exact retries at the same observation time are accepted only when the validator state is identical. Observation time may never regress, and a same-time changed validator is an identity conflict. A stale write is surfaced as an error rather than silently replacing or appearing to replace newer state.

The collector remains responsible for saving cache state only after successful enqueue, confirmed not-modified handling or confirmed no-item normalisation. Cache validators are operational transport state, not authoritative market or intelligence evidence, and cannot classify an event, change exposure, approve an order or submit an order. This slice adds no provider credential, private exchange API, fund, withdrawal, transfer, wallet, leverage, derivative or live-trading capability.

## 2026-07-28 — Provenance-bound lifecycle document capture

Capture only canonical Kraken lifecycle targets produced by the deterministic discovery contract. Each bounded batch accepts at most ten HTML documents, skips already committed source references, applies strict HTTPS host/path, redirect, media-type, timeout, response-size, UTF-8 and cache-header controls, and commits nothing when any selected target fails.

Persist each exact document payload content-addressably with an immutable capture header that binds source kind and URL, fetch time, discovery digest, originating committed index capture and originating index payload digest. A database commit marker is permitted only when the exact discovery provenance and document payload exist; exact retries are idempotent, while changed identities, incomplete provenance, mutation and commits before fetch fail closed.

This slice establishes the capture and persistence boundary only. Daily committed-source lookup, recursive discovery from captured listing-index pages and scheduled orchestration remain separate work. Public Kraken documents add no credential, private API, account, fund, wallet, withdrawal, transfer, leverage, derivative or order authority.

## 2026-07-28 — Bounded recursive lifecycle document cycle

After the daily fixed Kraken lifecycle sources commit, rotate deterministically through at most 32 latest committed listing-index page captures whose combined exact payloads do not exceed 8 MiB, and use those payloads as additional discovery sources. Prefer the root listing index, then the lowest page number, when the same target appears more than once; bind each selected target to the exact committed capture and payload that supplied it.

Skip every already committed source reference and fetch at most ten remaining canonical HTML documents per daily run. A newly captured pagination page may extend discovery only on a later daily run after its commit marker exists, so recursion advances as a bounded durable frontier rather than an in-memory crawler. Outside the daily lifecycle slot, perform no document lookup, discovery or network work.

Permit recursive provenance in D1 only when the parent is a committed `asset-listings-index-page` capture with the exact preserved payload digest. Record discovery, frontier and request counts in the scheduled cycle audit before strategy evaluation. This public evidence path creates no lifecycle declaration and adds no credential, private API, account, fund, wallet, withdrawal, transfer, leverage, derivative or order authority.

## 2026-07-29 — Database-bound reviewed lifecycle declarations

Before reviewed pair-level declarations enter lifecycle preparation, resolve every declared document through one bounded lookup of immutable Kraken lifecycle capture tables. Require an exact capture ID, source URL, fetch time and payload SHA-256 match plus an available database commit marker. Listing declarations may bind only discovered listing documents, delisting and regional declarations only discovered support documents, and status declarations only committed fixed incident-feed captures.

Content-address the sorted declaration-to-capture bindings with their commit times. Missing, duplicate, ambiguous, changed or future-unavailable commits fail closed. This proves provenance but does not classify free text, complete the historical backfill or make lifecycle coverage authoritative.

## 2026-07-29 — Immutable lifecycle backfill completeness

Persist each reviewed lifecycle backfill state as a content-addressed manifest binding the exact committed-capture binding digest, prepared-evidence digest and one coverage row for every expected canonical AUD pair. Permit partial manifests so historical work can advance incrementally without being mistaken for complete evidence.

Only an exact all-pair complete manifest may set `coverage_authoritative`. A database commit marker is rejected until the declared pair and complete-pair counts match immutable membership rows. Coverage authority concerns lifecycle history only; current venue state, data quality, liquidity, impact, strategy, signed-policy and risk gates remain separately mandatory.

## 2026-07-29 — Committed lifecycle declaration semantic gate

Re-validate every reviewed declaration at the committed-evidence boundary before querying D1 or calling lifecycle preparation. Require canonical document and AUD-pair identities, one to 500 declarations per document, bounded total input, publication no later than capture and recording, and non-negative effective time. Future-effective events remain permitted after publication.

Apply the reviewed source matrix again at this boundary: listing documents may declare only global listing/online events; delisting notices only global suspension/delisting; status incidents only global suspension/resumption; and regional-availability documents only Australian enable/disable events. Reject duplicate natural declaration identities, unsupported runtime enum values and incompatible scope. This is deterministic validation of explicit reviewer input, not free-text extraction, and adds no lifecycle claim, deployment, credential, fund, wallet or order authority.

## 2026-07-28 — Scheduled SEC press-release metadata intelligence

Use the SEC's official press-release RSS endpoint only through an enabled authoritative regulator contract that binds the exact SEC origin, scheduled-poll mode, digest-only retention, attribution, official RSS policy snapshot and model-training prohibition. Automated requests require a truthful contact-bearing User-Agent supplied at runtime; do not invent or commit that contact.

Re-verify payload length and SHA-256 before bounded UTF-8 RSS parsing. Accept only canonical current or legacy SEC press-release paths, matching GUIDs and publication times no later than receipt. Retain content-addressed identity, source URL and chronology, but never the title or raw XML.

Until a separately reviewed deterministic entity/event linker exists, emit only neutral `other` evidence under the non-tradable `SEC.REGULATOR` scope. This source cannot pause new risk, create a positive candidate, approve an order or submit an order. No collector deployment, credential, provider account, paid term, private API, fund, wallet or live-trading capability is added.

## 2026-07-28 — Scheduled RBA media-release macro intelligence

Use the Reserve Bank of Australia's official media-release RSS feed as an authoritative regulator source in scheduled-poll mode. Bind the exact RBA origin, feed, publisher/provider identities, digest-only retention, attribution, reviewed copyright/licence snapshot and model-training prohibition. The RBA explicitly provides RSS for automated updates; respect its WAF controls and surface access failures as stale or delayed.

Re-verify payload length and SHA-256 through a bounded strict RSS parser. Accept only one canonical RSS root/channel, bounded complete items, canonical RBA media-release paths, matching GUIDs and publication times no later than receipt. Reject document types, custom entities, malformed structure, identity conflicts and unsupported origins. Retain only deterministic identities, source URLs, chronology and content digests, not titles or raw XML.

Emit only neutral `macro` evidence under the non-tradable `AUD.MACRO` scope. Do not infer direction or severity from titles. This source cannot pause new risk, create a positive candidate, approve an order or submit an order, and adds no deployment, credential, provider account, paid service, private API, funds, wallet or live-trading capability.

## 2026-07-28 — Structured Kraken active-maintenance intelligence

Use Kraken's official programmatic Status API active-maintenance endpoint as an account-free one-minute official-exchange source. Bind the exact Kraken Status identity and endpoint, re-verify payload bytes and SHA-256, and validate only bounded structured maintenance state, impact, schedule chronology and update identities.

Retain provider names and update bodies only through content digests. Statuspage `maintenance`, `none` and `minor` impacts remain neutral; only structured `major` or `critical` active maintenance becomes negative `market-structure` evidence under the non-tradable `KRAKEN.VENUE` scope and may request `pause-new-risk`. Unknown values fail closed. The source cannot approve or submit an order and adds no deployment, credential, account, paid service, private API, funds, wallet or live-trading capability.

## 2026-07-28 — OAuth-only adaptive Reddit transport

Collect Reddit only through an approved OAuth Data API identity and the exact `oauth.reddit.com` origin. Require a truthful runtime User-Agent containing the actual Reddit username, and never return or persist the bearer token or User-Agent in capture evidence.

Bind each Reddit source contract to metadata-only storage, required attribution, deletion handling, model-training prohibition and a maximum 48-hour retention period. Parse official rate-limit headers into deterministic integer milliquery state, cap the free-access window at the documented 100 QPM averaged over ten minutes, retain a ten-percent reserve, space requests by at least one second and honour bounded `Retry-After` responses without retaining their bodies.

This slice provides bounded OAuth listing acquisition only. Post normalisation, deletion sweeps/corrections, an approved Reddit app and deployed credentials remain pending. Reddit remains social/watch-only and cannot create a risk-on candidate, approve an order or submit an order. No account, credential, deployment, paid service, private exchange API, funds, wallet or live-trading capability is added.


## 2026-07-28 — Transient Reddit post lifecycle and content-free purge audits

Do not place Reddit post identifiers, provider permalinks, authors, titles, bodies or content-derived hashes into the existing immutable external-intelligence ledger. Reddit requires deleted content and associated data to be removed even when de-identified, and recommends routinely deleting stored user data and content within 48 hours. An append-only post-level tombstone would therefore conflict with the approved deletion boundary.

Normalise only bounded post identity, subreddit and publication metadata in transient state. Discard title, body, author and provider permalink immediately. Recheck at most 100 exact post fullnames through the documented OAuth `[/r/subreddit]/api/info` listing, purge missing, removed or expired observations, and retain only source-level sweep timestamps and aggregate counts in a content-free compliance audit.

Post-level Reddit observations are explicitly ineligible for the durable intelligence queue until purge-enforced transient persistence and downstream watch-state invalidation are implemented. Reddit remains social/watch-only and cannot create a risk-on candidate, approve an order or submit an order. No account, credential, deployment, paid service, private exchange API, funds, wallet or live-trading capability is added.

## 2026-07-28 — Purge-enforced transient Reddit persistence

Store bounded Reddit post identity metadata only in a dedicated transient D1 table, never in the immutable intelligence ledger or durable Queue. Preserve the first deletion deadline across refreshes and require a transaction-local authorization before any post row can be deleted. The expiry path must run independently of provider availability so an API failure cannot extend retention.

After a provider removal or retention expiry, atomically remove transient rows, persist only source-level aggregate counts and timestamps, and invalidate downstream aggregate watch state. Immutable audits and watch events contain no post identifiers, account identifiers, provider content or content-derived hashes. Stable observation identity enables exact retries without extending retention; changed immutable metadata fails closed.

This storage path remains social/watch-only. It cannot create a positive research candidate, pause risk, approve an order or submit an order. Approved OAuth credentials and hosted deployment remain owner-gated separate work.

## 2026-07-28 — Scheduled AUSTRAC media-release regulator intelligence

Use AUSTRAC's official media-release RSS feed as an account-free scheduled Australian regulator source. Bind the exact feed, publisher/provider identity, digest-only retention, required attribution, reviewed AUSTRAC copyright snapshot and model-training prohibition. AUSTRAC expressly documents automatic RSS-reader polling and attributed reuse of AUSTRAC-produced material.

Re-verify exact payload length and SHA-256 through the bounded strict RSS parser. Accept only canonical current AUSTRAC media-release paths, matching URL GUIDs and publication times no later than receipt. Retain identity, source URL, chronology and content digests, but never titles or raw XML.

Emit only neutral `regulatory-action` evidence under non-tradable `AUSTRAC.REGULATOR`. Do not infer severity, direction or asset scope from titles. The source cannot pause risk, create a positive candidate, approve an order or submit an order. Because AUSTRAC has announced future RSS withdrawal, any loss of the feed must surface as unavailable or stale; unsupported website scraping is not an allowed fallback.

## 2026-07-28 — Scheduled Bitcoin Core security and release intelligence

Use Bitcoin Core's official English announcement RSS feed as an account-free project-origin `issuer` source in scheduled-poll mode. Bind the exact feed, origin and publisher/provider identity, digest-only retention, required attribution, the reviewed website-repository MIT licence notice and model-training prohibition. Treat it as authoritative only for Bitcoin Core software security and release announcements, not for general Bitcoin-network or market claims.

Re-verify exact payload length and SHA-256 through the bounded strict RSS parser. Accept at most the five items produced by the official feed, canonical dated English announcement paths, valid calendar dates, exact URL GUIDs and publication times no later than receipt. Retain identity, source URL, chronology and content digests, but never titles or raw XML.

Emit only neutral `other` evidence under non-tradable `BTC.CORE`. Do not infer release type, severity, asset direction or trading action from titles. The source cannot pause risk, create a positive candidate, approve an order or submit an order until separately reviewed deterministic classification and entity-linking evidence exists.

## 2026-07-28 — Fail-closed external-intelligence runtime bindings

Route the exact every-minute Cron expression to the approved minute external-intelligence collector and preserve the existing exact 15-minute trading-cycle route. Reject unknown Cron expressions. Bind the Kraken active-maintenance source to conditional D1 cache state, a bounded Queue producer and the existing idempotent D1 consumer. Queue processing uses batches of at most ten, a five-second batch timeout, five retries, serial consumer concurrency and an explicit dead-letter queue.

Keep `EXTERNAL_INTELLIGENCE_ENABLED` exactly `false` and the source-contract JSON empty in committed configuration. An enabled runtime requires one exact reviewed contract and an available Queue binding before any network request. Ambiguous flags, missing contracts, missing bindings and unexpected queue identities fail closed.

The Queue, consumer, DLQ and every-minute Cron are Preview configuration only and are not provisioned by this change. Production explicitly declares empty Queue bindings and empty Cron triggers. No deployment, secret, credential, provider account, fund, wallet or trading authority is added.

## 2026-07-28 — Content-addressed Preview intelligence activation manifest

Generate any Kraken maintenance Preview activation candidate from the exact reviewed source-evidence SHA-256, approval time, effective time and finite expiry. The expiry cannot exceed 366 days after the effective time. Bind the resulting enabled version-1 source contract to the exact minute Cron, Queue name and Preview-only deployment target, then content-address both the canonical contract and complete activation manifest.

Do not commit a placeholder evidence digest, enabled contract or activation variables. Manifest generation does not authorize provider-term acceptance, hosted resource creation, deployment or collection. Those remain explicit owner gates under the Preview activation runbook. Production remains disabled with no Queue or Cron resources, and external intelligence remains unable to submit or approve an order.

## 2026-07-29 — Correction-safe deterministic intelligence linking

Bind external-intelligence evidence to a content-addressed reviewed topic registry that states exact entity keys, tradability and allowed event types. Unknown topics, entity drift, event drift, source-authority mismatch, future evidence and changed natural identities fail closed.

Apply verified append-only corrections as an effective evidence view without rewriting immutable items. Content updates replace only effective payload/content digests; retractions and deletions remove the item from active clusters while retaining correction digests. Terminal corrections cannot be reversed by a later update.

Cluster exact effective content only within the same topic, event type and stance. Select one deterministic representative per cluster, preferring authoritative over reputable over social evidence, so syndicated copies cannot inflate publisher corroboration. This linkage remains pre-assessment research infrastructure; near-duplicate/repost manipulation controls, persistence integration and any paper risk reaction remain separate reviewed work.

## 2026-07-29 — Permitted-content repost and manipulation evidence

Create near-duplicate fingerprints only from exact effective publisher content whose reviewed retention policy is `permitted-excerpt` or `permitted-full`. Reject digest-only, metadata-only and Reddit evidence. Verify the exact content digest before transient NFKC/lowercase tokenisation, discard raw text and retain only a bounded, content-addressed set of five-token shingle digests.

Compare only evidence with the same reviewed topic, event type and stance. Use a content-addressed policy, bounded publication window, integer Jaccard threshold and deterministic complete-link clustering so a transitive similarity bridge cannot combine materially different stories. Exact and near-duplicate clusters each contribute one corroboration unit regardless of publisher count.

Record rapid near-duplicate publication across multiple publishers as a `rapid-multi-publisher-repost` pattern with watch-only handling. This is evidence of coordination risk, not identity proof or an accusation of manipulation. Missing permitted fingerprints, changed identities, unsafe thresholds, future chronology and digest conflicts fail closed. Reddit post content, identifiers and content-derived hashes remain excluded under the transient deletion contract. This stage cannot classify an event, approve risk, submit an order or change paper/live state.

## 2026-07-29 — Immutable paper-only external-intelligence pause gate

Load only immutable integrated assessments whose effective reaction is `pause-new-risk`, whose assessment time is no later than the scheduled decision time and whose age is at most one hour. Re-verify every content-addressed integration artifact against its D1 row before it can affect a paper decision; malformed, conflicting, future or over-cap evidence fails the cycle.

Suppress only proposed paper `buy` actions, converting them to `hold` with zero target exposure. Preserve `sell` actions because a pause on new risk is not a forced liquidation instruction. Record every fresh pause assessment as an idempotent content-addressed `pause` risk event and bind proposed/resulting actions plus exact assessment digests into the immutable cycle audit.

Research, shadow, validate and live modes remain disconnected. External intelligence cannot submit or approve an order, and no deployment, credential, provider activation, fund, wallet or live-execution capability is added.

## 2026-07-29 — Complete-snapshot external-intelligence replay

Replay external intelligence from complete correction-effective snapshots rather than applying the latest evidence state retroactively. At each hourly signal, select only the newest snapshot whose assessment time is no later than the decision. Re-verify linkage, manipulation and integration digests plus publication, receipt, availability, linkage, analysis and assessment chronology; duplicate assessment times and unbounded inputs fail closed.

Content-address the replay policy, snapshots, frames and complete run. Version maximum reaction ages, retain expired evidence explicitly, and measure publication-to-receipt, receipt-to-availability, availability-to-assessment and publication-to-assessment delay. Later corrections replace the complete state only for later frames and cannot rewrite prior decisions.

Fresh `pause-new-risk` evidence may block only new or increased risk; reductions and exits remain permitted. `research-candidate`, `watch` and `ignore` remain observational and cannot authorise exposure or an order. This research primitive adds no provider connection, deployment, credential, fund, wallet or live-execution authority.

## 2026-07-29 — Replay-bound backtest execution-request gate

Require an intelligence-aware backtest to bind exactly one verified replay frame to every step. The frame decision time must equal the strategy signal time; partial coverage, duplicate frame reuse, changed frame/replay digests and malformed evidence identities fail closed.

Construct target-weight reductions and additions from the actual simulated portfolio before applying intelligence. Fresh `pause-new-risk` evidence removes every buy request before cash, participation, fill, fee or impact modelling, including an increase toward a target after an earlier partial fill. Preserve sell reductions and exits. Record suppressed requests separately from market misses with their exact frame, pause evidence, pair, execution style and requested AUD notional.

Run identical ungated and gated steps to create one content-addressed comparison containing both complete results and their equity/return, suppression-notional, pause-frame and research-candidate differences. Research candidates remain observational and cannot alter targets or create requests. This research-only integration adds no provider connection, deployment, credential, fund, wallet or live-execution authority.

## 2026-07-29 — Immutable intelligence comparison manifests and report provenance

Content-address the baseline and intelligence-gated backtest results separately, then bind both result digests, the exact replay and every derived comparison metric into the complete comparison identity. Before persistence, re-verify the replay, result identities, full frame coverage, suppressed-request pause evidence and all derivable aggregate metrics.

Persist one compact immutable D1 manifest containing the comparison, replay and result identities plus aggregate equity, return, suppression and frame evidence. Do not duplicate potentially large execution and equity arrays in one D1 row. Exact retries preserve the first persistence time; changed identity reuse, ordinary updates and deletes fail closed.

Every research report must bind a sorted unique list of external-intelligence comparison identities, using an explicit empty list when none was evaluated. A comparison digest proves reproducible evidence identity only; it cannot promote a strategy, approve exposure or submit an order. This slice adds no provider connection, deployment, credential, fund, wallet or live-execution authority.

## 2026-07-29 — Account-free Ethereum Geth release intelligence

Reject automated collection from the Ethereum Foundation Blog even though the Foundation publishes RSS: the current website terms expressly prohibit robots or other automatic devices from accessing the websites. Do not encode a source contract whose collection method contradicts current provider terms.

Use the official `ethereum/go-ethereum` repository's published releases through GitHub's versioned REST API instead. GitHub documents that public published releases are available without authentication, subject to API terms and an unauthenticated limit of 60 requests per hour. Bind the exact repository endpoint and API origin, scheduled polling, a non-secret identifying project User-Agent, digest-only retention, required attribution, reviewed API terms and model-training prohibition.

Re-verify exact JSON bytes and accept only bounded published non-draft releases with safe integer IDs, canonical semantic-version tags, exact Geth repository release links and creation/publication times no later than receipt. Hash release names and bodies without retaining or queueing them. Emit only neutral `other` evidence under non-tradable `ETH.GETH`; Geth release evidence cannot establish general network state, pause risk, create a positive candidate, approve an order or submit an order. No deployment, account, credential, fund, wallet or live authority is added.

## 2026-07-29 — Account-free CFTC press-release intelligence

Use the CFTC's official General Press Releases RSS endpoint as an account-free authoritative regulator source in scheduled-poll mode. CFTC explicitly offers the feed for instant updates and permits copying public-domain government information while requesting acknowledgement. Bind the exact feed, CFTC origin, publisher/provider identity, digest-only retention, required attribution, reviewed web-policy snapshot and model-training prohibition.

Re-verify exact payload length and SHA-256 through the bounded strict RSS parser. Accept only canonical numbered CFTC press-release URLs, exact matching GUIDs and publication times no later than receipt. Canonicalise provider outer whitespace only for titles; preserve exact link, GUID and date validation. Retain identity, source URL, chronology and content digests, but never titles or raw XML.

Emit only neutral `regulatory-action` evidence under non-tradable `CFTC.REGULATOR`. Do not infer crypto relevance, severity, direction or asset scope from titles. The source cannot pause risk, create a positive candidate, approve an order or submit an order. No deployment, account, credential, fund, wallet or live authority is added.

## 2026-07-29 — Signed universe policy and immutable snapshot identity

Accept a universe policy only after verifying a finite-validity P-256 signature over the exact venue/Australian scope, candidate order size, tier thresholds, calibration SHA-256 set, approval chronology and signer-key identity. Content-address the canonical public verification key, signed payload and complete signature envelope. Reject private JWK material, malformed or overlong validity, changed identity and failed signature verification.

Bind each generated universe snapshot to the exact signed policy, one database-committed universe-ingestion batch and the batch's complete sorted source-digest membership. Re-verify scope, ordered candidate identity, lifecycle chronology, eligibility reasons and derived eligible-pair membership before content-addressing. Persist the policy and snapshot atomically; exact retries are idempotent while changed identity reuse, update, deletion, incomplete ingestion evidence and source-membership drift fail closed.

This is a storage and provenance boundary only. It supplies no real owner signature or signing key and does not connect membership to strategy or execution. Signal-time strategy and backtest binding remains separate work; every market-data, strategy, signed-policy and risk gate remains mandatory.


## 2026-07-29 — Persisted universe membership at backtest signal time

Load a universe snapshot only by its exact persisted digest. Reconstruct and cryptographically re-verify the stored P-256 policy, snapshot manifest, ingestion batch and source membership before preparing a content-addressed signal-time membership artifact. The snapshot must have been persisted no later than the decision, remain within the signed policy validity interval and remain no older than the signed observation-freshness limit. Missing, malformed, future-unavailable, stale or identity-conflicting evidence fails closed.

Require a universe-aware backtest to bind exactly one verified membership artifact to every signal time. Positive target weights must belong to that artifact's sorted eligible set; omitted or zero targets may still reduce or exit a position that subsequently became ineligible. Record the ordered membership identities in the result. Runtime strategy-decision binding remains separate and mandatory before this evidence can affect paper or live decisions. No deployment, signing material, credential, account, fund, wallet or order authority is added.


## 2026-07-29 — Verified universe membership in runtime strategy decisions

Require one exact configured persisted universe-snapshot digest before runtime market-data fetch or strategy evaluation. Load and re-verify its P-256 signed policy, snapshot manifest, persistence availability and freshness at the scheduled decision time. Empty, malformed, missing, future-unavailable or stale selectors fail the cycle.

Intersect configured pairs with the verified eligible membership, sort that intersection deterministically and permit only those markets to reach the momentum strategy. Content-address the complete proposed decision with the exact signed-policy, snapshot and signal-time membership identities. A buy outside membership, malformed AUD-cash hold, unsorted signal set or changed binding fails closed; exits remain structurally permitted after eligibility loss.

Keep the selector empty in committed Preview and Production configuration so no hosted strategy decision is generated without a separately reviewed signed snapshot. The binding is audit evidence only: it cannot approve an order, bypass market-data, liquidity, strategy, intelligence or risk gates, or enable deployment, signing material, credentials, funds, wallet access or live execution.

## 2026-07-29 — Immutable runtime strategy-decision persistence

Persist every verified universe-bound runtime decision before external-intelligence or order processing. Store the complete canonical artifact once under its content digest, then bind each canonical runtime cycle UUID to that artifact in a separate immutable table. This allows an identical decision artifact to support distinct retry cycles without duplicating its payload while preventing one cycle from being rebound to different decision evidence.

Re-verify the complete decision identity and reproduce its binding from the exact signal-time membership before preparing D1 writes. Persist artifact and cycle membership atomically, read both records back and compare every identity and decision field. Exact retries preserve the first cycle persistence time; digest collisions, changed artifact content, cycle rebinding, updates and deletes fail closed through application and database constraints.

This is an audit boundary for the proposed deterministic decision. External-intelligence gating remains downstream and may only suppress new paper risk; market-data, liquidity, impact, signed-policy and risk gates remain mandatory. No deployment, credential, signing key, account, fund, wallet or live-order authority is added.

## 2026-07-29 — Scheduled immutable hourly and daily Kraken candles

Collect the configured Australian Kraken spot pairs at both 60-minute and 1,440-minute intervals before universe and strategy evaluation. Use the public OHLC endpoint with display-name response identity, the latest immutable open time as an overlapping incremental cursor, bounded timeout/spacing/size controls and at most one transient retry.

Discard Kraken's always-present current row. Require strict eight-field rows, exact canonical response identity, interval alignment, contiguity, internally consistent positive OHLC, non-negative volume, closed intervals and interval-specific freshness. Persist immutable canonical candles and batch provenance that binds the exact request, acquisition chronology, response byte length, response SHA-256 and source cursor.

After persistence, re-read the database at acquisition availability and require at least 220 complete hourly and 220 complete daily candles for every configured pair. Missing, stale, gapped, conflicting or insufficient evidence fails the cycle before universe or strategy work. Keep the committed initial scope at BTC/AUD and ETH/AUD. This public-data path adds no credential, private endpoint, account, wallet, fund or order authority.
