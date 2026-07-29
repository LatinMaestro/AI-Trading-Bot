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

Scheduled ingestion is connected for the configured Australian Kraken pairs at 60 and 1,440 minutes. It overlaps the latest stored candle with Kraken's incremental `since` cursor, preserves the exact response SHA-256 in immutable batch provenance and requires aggregate complete history after persistence. After each primary capture it scans the exact current 719-committed-row window, performs at most one bounded repair capture from one interval before the earliest repairable gap, re-reads the range and fails closed if any gap remains.

Kraken's official downloadable historical OHLCVT archive is the approved account-free source outside the REST horizon. The versioned source contract pins the official support page, complete archive and quarterly archive folder, requires raw ZIP and selected CSV SHA-256 digests, limits use to BTC/AUD and ETH/AUD at 60 and 1,440 minutes, preserves no-trade gaps and keeps archive bytes transient.

Migration `0019_historical_candle_backfills.sql` stores sparse historical candles separately from contiguous scheduled REST batches. It adds immutable backfill headers, canonical candle rows, source memberships and final commit markers. Preparation re-verifies the source-contract, archive and CSV identities, bounds and hashes every strict eight-field CSV row, and requires at least one exact committed REST overlap. Every loaded committed REST candle inside the CSV range must be present and match OHLCV exactly.

Persistence is chunked into bounded D1 batches. Partial chunks are audit evidence only and may be retried idempotently; they are not complete history. The database permits a final immutable commit marker only when the declared candle membership exists, the declared overlap exists and all committed REST rows in range are reconciled. Ordinary update, deletion, changed identity reuse and incomplete commit attempts fail closed. The actual official archives have not yet been acquired or hashed, so the four approved member backfills remain pending and no historical data is strategy-authoritative.

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
- Kraken downloadable historical OHLCVT documentation: https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data
- Cloudflare D1 prepared statements: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Cloudflare D1 batch transactions: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
