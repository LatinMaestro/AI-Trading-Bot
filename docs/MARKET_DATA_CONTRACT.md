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

The D1 identity is venue, canonical pair, interval and open timestamp. Exact duplicate content is idempotent. Reuse of a batch identity with different provenance, or reuse of a candle identity with different OHLCV content, is a hard conflict. Stored batches and candles cannot be updated or deleted through normal application SQL.

The scheduled ingestion path must record the public request provenance, persist only closed intervals, inspect the expected range for gaps and stop research evaluation when required data is missing or unreconciled.

## Known limitation

Kraken's REST OHLC endpoint returns at most 720 recent entries and always includes the current uncommitted interval. This leaves no more than 719 committed rows available for repair at a selected interval.

The current persistence and gap-planning primitives identify which missing ranges remain recoverable from Kraken REST and which have aged outside that boundary. They do not make Kraken REST a complete historical research source. Broader backtesting still requires progressive collection or a separately approved reproducible historical dataset with provenance and reconciliation.

## Sources

- https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs
- https://docs.kraken.com/api-reference/market-data/get-ohlc-data

## Public market-quality evidence

The scheduled-universe path uses Kraken's official public contracts with `assetVersion=1`:

- `AssetPairs` filtered to Australian availability and the international execution venue;
- `Ticker` for all or an exact requested set of display-format pairs; and
- `Depth` for one requested pair with a bounded level count from 1 to 500.

Each successful response is retained as a source reference, fetch time and SHA-256 digest of the exact response text before typed parsing. HTTP errors, Kraken envelope errors, invalid JSON, missing requested tickers, legacy pair keys, crossed markets, unordered books, unsafe timestamps and non-finite arithmetic fail closed.

Ticker evidence provides best prices and 24-hour base volume/VWAP for quote-turnover calculation. L2 order-book evidence provides coherent spread, conservative two-sided quote depth and candidate-order impact. Candidate impact is `null` when either side lacks enough displayed depth; it is never converted into a favourable estimate.

These contracts do not yet create a complete universe observation. Scheduled orchestration must still join them with committed candle counts, annualised volatility, fresh AUD conversion evidence and lifecycle evidence before atomic persistence.
