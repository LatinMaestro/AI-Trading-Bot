# Market data persistence and gap repair

## Scope

This Phase 1 slice establishes an immutable, auditable storage contract for committed Kraken OHLC candles at the two approved initial intervals:

- 60 minutes for operational signal development and later paper execution;
- 1,440 minutes for the deterministic momentum baseline and longer-horizon research.

It adds no private API access, deployment or executable order path.

## Immutable D1 records

Migration `0003_market_candles.sql` adds:

- `market_data_batches`, an append-only provenance record for each accepted public-data response;
- `market_candles`, one canonical committed OHLCV record per venue, pair, interval and open timestamp;
- indexes for chronological lookups and batch review;
- conflict triggers that reject reuse of an identity with different hashed content;
- update and delete triggers that prevent silent history mutation.

Each batch records the venue, canonical and exchange symbols, interval, requested `since` value, source cursor, canonical fetch timestamp, committed row count, time range and SHA-256 payload digest. Each candle has its own digest derived from its complete immutable identity and OHLCV content.

An exact retry of the same batch and candles is idempotent. A different payload using the same batch identity, or different OHLCV values using the same candle identity, aborts the D1 batch transaction rather than overwriting or ignoring the discrepancy.

## Acceptance checks

Before persistence, a batch must:

- contain at least one committed candle;
- use a supported 60-minute or 1,440-minute interval;
- use finite, positive prices and non-negative volume;
- have internally consistent high and low bounds;
- be strictly ordered, contiguous and aligned to the selected interval;
- use a canonical ISO-8601 fetch timestamp;
- contain no candle whose interval had not closed by that fetch timestamp.

The persistence repository uses bound D1 prepared statements and `D1Database.batch`, so the batch metadata and candle inserts are submitted as one D1 transaction. Database constraints and triggers remain authoritative if application validation is bypassed or defective.

## Gap detection

`findCandleGaps` compares stored open timestamps with an explicit expected inclusive range. It fails closed when stored timestamps are duplicated, unordered, misaligned or outside the expected range. Valid gaps are returned as exact inclusive ranges with a calculated missing-candle count.

## Kraken REST repair boundary

Kraken documents that its REST OHLC endpoint returns at most 720 rows and always includes the current uncommitted row. The repair planner therefore treats only the preceding 719 committed intervals as reliably recoverable from that endpoint.

A gap wholly older than that horizon is labelled `unavailableFromRest`. A gap crossing the horizon is split into an unavailable historical portion and a currently repairable portion. The system must never fabricate, forward-fill or silently interpolate missing OHLC data.

Historical gaps outside the Kraken REST horizon require one of:

1. progressive collection by this service before the data ages out;
2. a separately approved, reproducible historical source with documented provenance and reconciliation;
3. exclusion of the affected period from research and reporting.

The scheduled ingestion and automated repair orchestration remain separate Phase 1 tasks. Until they are implemented, these primitives may be used only in research and test paths.

## Validation evidence

The focused test harness verifies:

- leading, internal and trailing gap detection;
- duplicate and alignment rejection;
- REST-horizon classification, including a gap crossing the boundary;
- migration application after the existing schema migrations;
- idempotent duplicate writes;
- update and delete rejection;
- batch-provenance conflict rejection;
- candle-content conflict rejection;
- deterministic batch and candle hashes;
- rejection of non-contiguous batches.

## Primary references

- Kraken Spot REST OHLC documentation: https://docs.kraken.com/api-reference/market-data/get-ohlc-data
- Cloudflare D1 prepared statements: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Cloudflare D1 batch transactions: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
