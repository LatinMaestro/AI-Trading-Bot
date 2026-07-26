# Universe ingestion, AUD valuation and calibration

## Scope

This contract prepares deterministic, content-addressed universe evidence from scheduled public venue inputs. It does not fetch data, infer profitability, place orders or activate capital.

## Source evidence

Every input source records:

- a canonical source ID and reference;
- source type;
- fetch time; and
- lowercase SHA-256 payload digest.

Venue metadata, market-quality observations, lifecycle announcements and AUD conversion data remain distinct evidence classes.

Lifecycle events require explicit official-announcement evidence. A market disappearing from one venue snapshot is not treated as a delisting.

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

- connect scheduled Kraken public endpoints;
- persist ingestion batches atomically into existing append-only tables;
- establish complete official lifecycle-source coverage;
- calibrate AUD conversion freshness and tier thresholds from historical evidence;
- persist signed universe policies and generated snapshots.
