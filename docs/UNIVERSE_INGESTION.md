# Universe ingestion, AUD valuation and calibration

## Scope

This contract prepares and atomically persists deterministic, content-addressed universe evidence from scheduled public venue inputs. It does not infer profitability, place orders or activate capital.

## Source evidence

Every input source records:

- a canonical source ID and reference;
- source type;
- fetch time; and
- lowercase SHA-256 payload digest.

Venue metadata, market-quality observations, lifecycle announcements and AUD conversion data remain distinct evidence classes.

Lifecycle events require explicit official-announcement evidence. A market disappearing from one venue snapshot is not treated as a delisting.

## Official Kraken lifecycle evidence

`prepareKrakenLifecycleNotice` establishes the fail-closed source boundary for Kraken lifecycle records:

- Help Center notices must use a canonical `https://support.kraken.com/hc/...` article URL;
- operational incidents must use a canonical `https://status.kraken.com/...` record URL;
- credentials, query strings, fragments, unofficial hosts, empty or oversized payloads and impossible publication/fetch chronology are rejected;
- the exact captured payload text is SHA-256 addressed before event extraction;
- canonical pair, event type, publication time and effective time remain explicit;
- events are sorted deterministically and duplicate identities are rejected;
- status incidents may establish only trading suspension or resumption;
- support notices may establish listing, availability, suspension, resumption or delisting events;
- a notice may be published before its future effective time, but the event must not affect a historical universe until both publication and effective times have passed.

This contract does not scrape, poll or claim complete historical coverage. Scheduled acquisition, archival fixtures, asset-to-pair expansion and completeness reconciliation remain separate work. No lifecycle event may be inferred from current AssetPairs metadata alone.

## AUD valuation

Quote-currency amounts are converted to AUD using the shortest fresh path available at the market observation time.

Controls:

- direct AUD quotes use a rate of 1;
- conversion observations must already be knowable and within the configured age limit;
- paths cannot repeat assets;
- path length is capped;
- missing or multiple shortest paths fail closed;
- disagreeing paths are reported as ambiguous;
- all contributing payload digests are retained.

Converted metrics include 24-hour quote turnover, available quote-volume capacity and venue minimum order value.

## Deterministic ingestion batch

`prepareUniverseIngestionBatch`:

- canonicalises market order;
- rejects duplicate pairs and malformed chronology;
- creates hashed market definitions and quality observations;
- prepares explicit lifecycle events;
- records all source digests; and
- produces one SHA-256 digest over the complete canonical batch.

Exact source content produces the same IDs, payload digests and batch digest.

## Atomic persistence

`UniverseIngestionRepository.persistBatch` submits one transactional D1 batch with nine statements regardless of universe size. Canonical JSON row expansion writes:

- immutable batch provenance and sorted source-digest memberships;
- market definitions, lifecycle events and quality observations;
- immutable links from every record to the containing batch; and
- a final commit marker.

The database accepts the commit marker only when source and record membership counts exactly match the batch header. Exact retries are idempotent. Changed reuse of a record identity or natural identity fails closed, and D1 batch rollback prevents orphaned provenance. Batch headers, memberships and commit markers reject ordinary updates and deletions.

Only batches with a commit marker are complete ingestion evidence. Fixed statement count avoids scaling database subrequests linearly with the number of listed markets.

## Calibration evidence

`summariseUniverseCalibration` produces evidence summaries by universe tier:

- sample and distinct-pair counts;
- observation range;
- equity range;
- spread percentiles;
- lower-tail turnover and depth percentiles;
- impact percentiles; and
- a digest over the sorted evidence set.

The summary does not automatically set policy limits. Final tier policies require reviewed, signed calibration choices by venue, period and equity scale.

## Remaining work

- acquire and content-address official Kraken lifecycle records on a bounded schedule;
- backfill and reconcile complete listing, suspension, resumption, delisting and Australian-availability history;
- expand asset-level notices into verified affected pair events without guessing;
- calibrate AUD conversion freshness and tier thresholds from historical evidence;
- persist signed universe policies and generated snapshots.
