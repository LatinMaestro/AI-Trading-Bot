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

## Declaration boundary

Raw capture does not create lifecycle events. It does not use free-text AI extraction or keyword heuristics. A later reviewed backfill process must bind each declaration to an exact committed payload digest, source URL, publication time and effective time before `prepareKrakenLifecycleEvidence` accepts it.

## Safety

This capability uses public documents only. It adds no credentials, private API, account access, order path, wallet signing, withdrawal, transfer, leverage, derivative or live-trading capability.

## Remaining work

- discover and capture exact individual listing, delisting and regional-availability documents from the preserved indexes;
- backfill complete pair-level declarations;
- reconcile asset-level announcements to all affected canonical spot pairs;
- add deterministic reviewed-declaration persistence linked to committed raw captures; and
- require complete lifecycle coverage before venue-wide strategy selection becomes authoritative.