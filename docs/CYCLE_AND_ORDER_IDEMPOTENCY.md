# Cycle and order idempotency

## Purpose

A scheduled trading service must assume that triggers, provider retries and network responses can be duplicated, delayed or delivered after a prior attempt has crashed. Safety cannot depend on an in-memory flag because Workers may run in separate isolates.

## Global cycle lease

Every scheduled invocation first attempts one conditional D1 upsert against the fixed `trading-cycle` lease. The statement succeeds only when no lease exists or the existing lease has expired. The holder ID is random and all release operations are owner-guarded.

The initial lease duration is 14 minutes for a 15-minute schedule. A later persistence slice must add heartbeats before any private exchange operation is enabled.

## Scheduled-cycle claim

Each trigger derives a stable key from `ScheduledController.scheduledTime`. A `cycle_runs` row is claimed using one conditional upsert:

- a new schedule key may run;
- a completed schedule key never runs again;
- a failed attempt may be retried;
- a running attempt may be taken over only after its stored lease has expired;
- completion and failure updates require the current holder ID.

The global lease prevents different schedule slots from overlapping. The schedule claim prevents a late duplicate of the same slot from running again after the global lease is released.

## Order-intent idempotency

`order_intents.request_fingerprint` is unique. The fingerprint is SHA-256 over the stable schedule key, strategy version, canonical pair, side, venue-quantised price string and venue-quantised volume string. Reserving the same logical request twice returns the existing intent rather than creating another order.

No Phase 0 or current Phase 1 code can submit an executable order. These primitives establish the database invariant required before a future order path is considered.

## Failure behaviour

- Missing or ambiguous lease ownership causes no trading work.
- A failed cycle is recorded as failed and may be retried.
- A crash leaves an expiring claim; takeover is possible only after expiry.
- A completed cycle is permanently deduplicated by schedule key.
- An order fingerprint conflict resolves to the existing immutable intent.

D1 prepared statements are parameter-bound. Conditional writes use SQLite semantics and D1 write-count metadata to determine whether ownership was acquired.
