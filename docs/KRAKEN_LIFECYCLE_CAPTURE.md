# Kraken lifecycle raw-source capture

## Scope

`captureKrakenLifecycleSources` retrieves an explicit bounded set of official Kraken lifecycle documents and preserves the exact successful response as immutable evidence.

It does not infer lifecycle events, parse trading decisions, use credentials or enable orders.

## Official source boundary

Targets must be canonical HTTPS URLs from the source classes already approved by `src/universe/krakenLifecycle.ts`:

- asset listing articles under `https://blog.kraken.com/product/asset-listings/`;
- delisting and regional-availability articles under `https://support.kraken.com/articles/`;
- status incident pages or API documents under `https://status.kraken.com/incidents/` or `https://status.kraken.com/api/v2/incidents`.

The authoritative indexes remain:

- `https://blog.kraken.com/category/product/asset-listings`;
- `https://support.kraken.com/sections/delistings`; and
- `https://status.kraken.com/api`.

Redirects, credentials, query strings, fragments, unsupported hosts and non-allowlisted paths fail closed.

## Capture controls

Each run:

- accepts 1 to 100 unique targets;
- uses bounded concurrency, timeout, per-response size and total-size limits;
- requests public text or JSON without cookies or credentials;
- accepts only allowlisted textual content types;
- rejects HTTP failures, invalid UTF-8 and NUL characters;
- hashes the exact response bytes with SHA-256;
- records source class, canonical URL, fetch time, content type, ETag, Last-Modified, byte length and exact text; and
- produces a deterministic run digest over the sorted captured-document identities.

No language model or free-text heuristic converts the raw payload into lifecycle declarations. Reviewed structured declarations remain governed by `docs/KRAKEN_LIFECYCLE_SOURCES.md`.

## Immutable persistence

Migration `0007_kraken_lifecycle_capture.sql` adds:

- immutable capture-run headers;
- immutable raw source documents;
- run-to-document memberships; and
- database-verified commit markers.

`KrakenLifecycleCaptureRepository.persistRun` submits one four-statement transactional D1 batch regardless of target count. A commit marker is accepted only when every declared document membership exists. Exact retries are idempotent. Changed reuse of a run identity or a source URL/fetch-time identity aborts and rolls back the run.

Only committed runs are complete raw lifecycle evidence. Ordinary updates and deletes are rejected.

## Deliberate limitations

- A maintained target registry and scheduled invocation remain separate work.
- Historical listing, trading-status, regional-availability and delisting declarations still require reviewed backfill.
- Capturing a source proves its exact content at a fetch time; it does not prove that every relevant Kraken source has been found.
- Raw source evidence cannot make a pair eligible until reviewed declarations pass lifecycle coverage and universe reconstruction gates.
