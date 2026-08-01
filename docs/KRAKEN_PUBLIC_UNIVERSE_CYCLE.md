# Kraken scheduled public-universe cycle

## Scope

The lease-protected scheduled trading cycle uses the content-addressed Kraken public client to prepare and atomically persist universe evidence before strategy evaluation.

It uses no credentials and cannot place, validate, cancel or reconcile orders.

## Collection sequence

Each cycle:

1. fetches Australian-available spot metadata from `AssetPairs`;
2. fetches the public ticker snapshot;
3. identifies pairs with a fresh AUD valuation path;
4. selects a bounded pair window that rotates every 15 minutes;
5. fetches those order books sequentially;
6. derives spread, quote turnover, two-sided depth, venue minimum and reference-order impact; and
7. commits the content-addressed ingestion batch through the database-verified atomic persistence boundary.

The default depth window is six pairs. The runtime reduces it further when the approved candle-pair list is larger so the scheduled cycle retains public-request headroom.

## Request controls

- Public requests have timeouts and response-size limits.
- Depth requests are spaced sequentially.
- HTTP throttling, temporary server/service failures and network timeouts receive bounded retries.
- The cycle audit records actual HTTP attempts, selected/skipped pair counts and the committed batch digest.

## Fail-closed behaviour

- Missing, stale or ambiguous AUD valuation paths exclude the affected pair.
- Incomplete ticker sets, malformed books, crossed markets, unsafe timestamps, non-finite arithmetic or persistence conflicts fail the scheduled slot.
- Strategy evaluation starts only after the database accepts the universe commit marker.
- Existing cycle failure and retry audit rules remain authoritative.

## Deliberate limitations

- Current snapshots never infer listing, suspension, resumption, delisting or Australian-availability events.
- Official lifecycle announcements remain separate evidence.
- Until stored hourly/daily candle counts and volatility evidence are supplied, observations retain a `gap` history state and cannot satisfy research-tier history gates.
- Strategy selection still uses the separately approved-pair candle path; dynamic-universe eligibility is not yet authoritative for target selection.

No live, private API, withdrawal, transfer, wallet, leverage or derivative capability is added.
