# Market data contract

## Pair discovery

The runtime discovers current Kraken spot pairs from `/0/public/AssetPairs` rather than assuming that configured symbols, minimums or status remain valid.

Requests use:

- `assetVersion=1` for canonical display assets;
- `aclass_base=currency` to exclude tokenised assets;
- `country_code=AU` to filter for Australian availability;
- `execution_venue=international`;
- non-secret public API access only.

The application stores two symbols:

- canonical symbol, such as `BTC/AUD`, used by configuration, strategy and records;
- Kraken exchange symbol, such as `XBTAUD`, used in exchange requests.

Configured legacy aliases such as `XBTAUD` normalise to `BTC/AUD`. Missing, duplicate or non-online approved pairs cause the cycle to stop without a proposal. Venue-provided price precision, volume precision, order minimums, cost minimums and tick size are parsed as runtime contract data and must be revalidated before any future order construction.

## Daily OHLC contract

Kraken documents that the final OHLC row is the current, not-yet-committed interval. The adapter always discards that row.

A daily candle set is usable only when:

- it contains at least 220 committed candles;
- timestamps are strictly ordered, unique, contiguous and aligned to UTC days;
- all numeric fields are finite;
- prices are positive and volume is non-negative;
- high/low bounds are internally consistent;
- the latest committed candle is no more than 49 hours old;
- the pair is currently approved and online.

Any violation fails closed before strategy evaluation.

## Persistence contract

Committed 60-minute and 1,440-minute candles may be persisted only through the immutable contract in `docs/MARKET_DATA_PERSISTENCE.md`.

The D1 identity is venue, canonical pair, interval and open timestamp. Exact duplicate content is idempotent. Reuse of a batch identity with different provenance, or reuse of a candle identity with different OHLCV content, is a hard conflict. Every candle must match its source batch's venue, symbols, interval and time range. Stored batches and candles cannot be updated or deleted through normal application SQL.

The scheduled ingestion path must record the public request provenance, persist only closed intervals, inspect the expected range for gaps and stop research evaluation when required data is missing or unreconciled.

## Known limitation

Kraken's REST OHLC endpoint returns at most 720 recent entries and always includes the current uncommitted interval. This leaves no more than 719 committed rows available for repair at a selected interval.

The current persistence and gap-planning primitives identify which missing ranges remain recoverable from Kraken REST and which have aged outside that boundary. They do not make Kraken REST a complete historical research source. Broader backtesting still requires progressive collection or a separately approved reproducible historical dataset with provenance and reconciliation.

## Sources

- https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs
- https://docs.kraken.com/api-reference/market-data/get-ohlc-data
