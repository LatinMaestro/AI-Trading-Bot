# Kraken scheduled universe evidence join

## Scope

`runKrakenScheduledUniverseIngestion` joins public Kraken market evidence with already committed research evidence and submits one complete universe-ingestion input to the atomic repository boundary.

It does not use private APIs, credentials, orders, wallets or live capital.

## Bounded public work

Each run requires an explicit canonical pair set and enforces:

- non-empty unique display-format pairs;
- a configured maximum pair count;
- Depth levels from 1 to 500;
- Depth concurrency from 1 to 10;
- exact AssetPairs definitions and Ticker coverage;
- online market status; and
- ticker/depth observation skew within the configured limit.

Depth results retain input ordering even when fetched concurrently.

## Required joined evidence

Every requested pair requires:

- one Kraken AssetPairs definition;
- one Ticker observation;
- one coherent two-sided Depth snapshot;
- exact committed daily and hourly candle counts;
- latest daily and hourly committed timestamps;
- annualised volatility;
- complete data-quality state;
- fresh AUD conversion observations when the quote asset is not AUD; and
- explicit lifecycle announcements when lifecycle events are supplied.

Candle evidence must exactly match the requested pair set, be knowable before the market observation and meet configured freshness limits. Lifecycle evidence supplied to a run must also belong to that exact pair set. Missing, stale, conflicting or ambiguous evidence aborts the batch.

## Market-quality construction

The candidate order is defined in AUD and converted to the pair quote asset through the shortest fresh unambiguous path.

For each pair the join records:

- spread;
- 24-hour quote turnover;
- conservative two-sided displayed depth;
- worst-side candidate impact;
- current quote minimum using both Kraken minimum cost and minimum volume valued at the current ask;
- committed history counts;
- annualised volatility; and
- evidence availability times.

If displayed depth cannot fill the candidate order on both sides, impact remains unavailable and persistence is refused.

## Quality manifest

Ticker, per-pair Depth, candle and actually used conversion evidence are canonicalised into `kraken-universe-quality-manifest-v1`. Duplicate source entries are removed deterministically. The exact manifest receives a SHA-256 digest and becomes the batch's market-quality source.

The returned manifest preserves the underlying public source references, fetch times and payload digests for audit capture. The universe repository then prepares and submits its fixed nine-statement transactional D1 batch.

## Validation

Eight branch tests cover:

- successful multi-pair joining and deterministic batch/manifest hashes;
- bounded Depth concurrency;
- AUD conversion of non-AUD quote turnover;
- exact candle-evidence coverage;
- stale candle rejection;
- insufficient displayed-depth rejection;
- ticker/depth skew rejection;
- ambiguous AUD-path rejection;
- exclusion of irrelevant conversion quotes from the manifest; and
- rejection of lifecycle evidence outside the scheduled pair set.

An isolated Node 22 harness passed seven representative tests and strict source TypeScript checking with `exactOptionalPropertyTypes` enabled. Synthetic fixtures validate control flow and arithmetic only. Exact-head repository CI and scheduled runtime wiring still require restored Actions capacity and D1-backed committed-candle, AUD-conversion and lifecycle evidence providers.
