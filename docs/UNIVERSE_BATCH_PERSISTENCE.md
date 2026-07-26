# Atomic universe snapshot persistence

## Decision

Persist each prepared universe snapshot through one transactional D1 batch containing:

- an immutable content-addressed manifest;
- all market definitions;
- all explicit lifecycle events;
- all market-quality observations; and
- immutable manifest-to-evidence membership links.

JSON row expansion keeps the operation at five database statements regardless of the number of venue markets.

## Failure behaviour

- Exact retries are idempotent.
- Reused explicit or natural identities with changed content fail closed.
- A conflict in any definition, event, observation or link rolls back the entire snapshot.
- Manifests and links cannot be updated or deleted through ordinary application statements.
- The manifest records source digests and expected evidence counts.

A manifest digest proves the identity and membership of persisted evidence. It does not approve a universe policy, infer an unreported lifecycle event or activate any exchange capability.

## Implementation

- Migration: `migrations/0006_universe_ingestion_batches.sql`
- Repository: `src/storage/universeIngestion.ts`
- Validation: `test/universe-persistence.test.ts`

Scheduled public fetching remains a separate slice. The repository accepts only an already validated `UniverseIngestionInput` and does not use private exchange credentials.
