# Kraken lifecycle raw-source capture

## Purpose

The scheduled service preserves exact Kraken-owned lifecycle source payloads before any reviewed listing, trading-status, delisting or Australian-availability declaration is admitted to universe evidence. This prevents later page changes from silently rewriting the historical source used by research.

## Daily capture set

At the deterministic 00:00 UTC scheduled slot, the Worker captures:

- Kraken Blog asset-listing archive index;
- Kraken Support delistings index;
- Kraken Status incidents API; and
- Kraken Status scheduled-maintenance API.

All targets are fixed in code and must match the allowlist exactly. Redirects, non-HTTPS alternatives and caller-supplied URLs are rejected.

## Network boundary

Each request:

- uses only a public Kraken-owned endpoint;
- has a ten-second default timeout that remains active through the complete body read;
- accepts only the expected HTML or JSON media type;
- rejects non-200 responses;
- stops streaming and rejects declared or actual payloads above 1 MiB;
- requires valid UTF-8 that round-trips to the exact fetched bytes; and
- uses at most two attempts for transient network, timeout, HTTP 408, 429 or 5xx failures.

The four responses are collected before persistence. Any missing or malformed response fails the scheduled slot; incomplete capture sets are not committed.

## Content identity

The system hashes the exact successful response bytes with SHA-256. Valid UTF-8 must encode back to the same byte length and digest before it is accepted as storable text.

The capture identifier binds:

- schema version;
- source kind and exact URL;
- fetch time;
- payload digest and byte length;
- normalised media type; and
- bounded ETag and Last-Modified evidence when present.

A repeated fetch at a different time is a separate capture even when the payload is unchanged.

## Atomic immutable persistence

D1 stores each distinct exact payload text once, keyed by its payload SHA-256. Every scheduled observation receives a separate immutable capture header referencing that content-addressed payload and a final commit marker. This avoids storing unchanged index or status content again on every daily capture while preserving every fetch time and response identity.

The 1 MiB accepted-payload ceiling remains below Cloudflare D1's documented 2 MB maximum string and row size. One payload, one capture header and one commit statement are used per source, avoiding oversized JSON expansion and keeping the scheduled transaction bounded.

The database rejects:

- changed reuse of a payload or capture identifier;
- more than one payload for the same URL and fetch time;
- a commit before the source fetch;
- a commit without an existing payload-backed capture; and
- ordinary update or delete operations against payloads, captures or commit markers.

The four payloads, capture headers and commit markers are submitted in one transactional D1 batch. Only captures with a commit marker are complete evidence.

## Deterministic document discovery

The discovery contract operates only on the exact preserved listing and delisting index captures. It verifies each payload digest again before processing and extracts only bounded, quoted `href` attributes.

Source-specific canonical rules permit:

- Kraken Blog listing articles under `/product/asset-listings/<slug>`;
- Kraken Blog archive pagination under `/category/product/asset-listings/page/<number>`; and
- Kraken Support candidates under `/articles/<identifier>`.

The contract rejects non-HTTPS or untrusted hosts, credentials, ports, queries, fragments, escaped or encoded paths, cross-index links, invalid pagination and excessive link or target counts. Discovered targets are deduplicated, sorted, bound to the exact capture ID and payload digest, and represented by a deterministic discovery digest.

Kraken Support targets remain generic lifecycle-document candidates. Their text or URL is not used to decide whether they prove a delisting, suspension or Australian-availability event. Classification and declarations remain reviewed evidence work.

## Discovered document capture

A bounded capture batch accepts at most ten canonical targets from one content-addressed discovery result. It skips source references already committed, orders the remaining targets deterministically, and fetches only exact Kraken Blog listing pages/articles or Kraken Support article paths admitted by discovery.

Each request rejects redirects, non-HTML responses, invalid declared sizes, empty or greater-than-one-MiB bodies, invalid UTF-8 and unsafe cache headers. One bounded transient retry is permitted. The batch persists nothing unless every selected target succeeds.

D1 stores each exact document payload content-addressably and preserves an immutable document-capture header containing its source identity, fetch time, discovery digest and the exact committed index capture/payload that discovered it. Database triggers reject incomplete or cross-class discovery provenance, changed identity reuse, commits before fetch and ordinary mutation. A separate commit marker proves completion.

## Declaration boundary

Raw capture and deterministic link discovery do not create lifecycle events. They do not use free-text AI extraction or keyword heuristics. A later reviewed backfill process must bind each declaration to an exact committed payload digest, source URL, publication time and effective time before `prepareKrakenLifecycleEvidence` accepts it.

## Safety

This capability uses public documents only. It adds no credentials, private API, account access, order path, wallet signing, withdrawal, transfer, leverage, derivative or live-trading capability.

## Remaining work

- wire committed-source lookup, recursive discovery from captured listing-index pages and bounded document capture into the scheduled cycle;
- backfill complete pair-level declarations;
- reconcile asset-level announcements to all affected canonical spot pairs;
- add deterministic reviewed-declaration persistence linked to committed raw captures; and
- require complete lifecycle coverage before venue-wide strategy selection becomes authoritative.
