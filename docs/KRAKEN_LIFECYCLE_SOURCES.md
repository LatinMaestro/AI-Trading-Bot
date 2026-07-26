# Kraken official lifecycle-source contract

## Purpose

The dynamic universe requires explicit, time-aware evidence for listings, trading status, delistings and Australian availability. Current venue snapshots cannot establish historical lifecycle events and are never used to infer them.

## Official source indexes

Only Kraken-owned HTTPS sources are accepted:

- asset listings: https://blog.kraken.com/category/product/asset-listings
- delistings: https://support.kraken.com/sections/delistings
- incidents and maintenance: https://status.kraken.com/api

Individual evidence records must reference an exact Kraken Blog listing article, Kraken Support article or Kraken Status incident/API document. The exact successful payload is captured separately and identified by a lowercase SHA-256 digest.

## Raw-source capture

`docs/KRAKEN_LIFECYCLE_CAPTURE.md` defines the scheduled preservation boundary. The daily 00:00 UTC cycle captures the official listing and delisting indexes plus Kraken Status incident and scheduled-maintenance feeds. Exact valid UTF-8 bytes are SHA-256 hashed, split into bounded content-addressed chunks and committed atomically to immutable D1 records.

Raw capture does not create lifecycle events. Complete pair-level evidence still requires reviewed declarations tied to exact committed source payloads. Exact individual listing, delisting and Australian-availability documents must be discovered and captured before their declarations are admitted.

## Source classes

- `asset-listing` may declare a global `listed` or `trading-online` event.
- `delisting-notice` may declare a global `trading-suspended` or `delisted` event.
- `status-incident` may declare a global `trading-suspended` or `trading-resumed` event.
- `regional-availability` may declare only `au-enabled` or `au-disabled`.

A regional restriction cannot be converted into a global delisting. A global listing announcement does not prove Australian availability.

## Reviewed declarations

The contract does not use free-text keyword extraction or a language model to create lifecycle events. A reviewed declaration binds:

- canonical pair;
- event type;
- global or Australian scope;
- effective time;
- publication time;
- exact source URL;
- capture time; and
- exact source-payload SHA-256.

Source-class, hostname, path, chronology, scope and event compatibility are validated before an announcement can enter universe ingestion.

## Time semantics

Publication, capture and effective time are independent.

A scheduled delisting may be published and captured before its future effective time. It is valid evidence immediately but does not change historical universe state until the effective time. Later publication cannot affect an earlier signal.

## Coverage audit

For each expected pair, the deterministic audit separately requires:

- listing history;
- trading-status history; and
- Australian-availability history.

Missing classes remain explicit. Coverage completeness does not imply current eligibility: a completely documented pair may currently be suspended, delisted or unavailable in Australia.

## Remaining work

- Discover and capture exact individual listing, delisting and regional-availability documents from the preserved indexes.
- Backfill the complete Kraken listing, delisting, suspension/resumption and Australian-availability history.
- Reconcile asset-level announcements to every affected canonical spot pair.
- Persist reviewed declarations with an explicit link to committed raw captures.
- Supply only reviewed, complete announcements to the scheduled universe ingestion boundary.

Until those items are complete, venue-wide strategy research cannot claim complete lifecycle coverage.

No private API, credential, account, wallet, fund or order capability is used.