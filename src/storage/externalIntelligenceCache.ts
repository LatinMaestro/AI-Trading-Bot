import type { ExternalIntelligenceCacheState } from "../intelligence/queuePipeline.ts";
import type { ExternalIntelligenceCacheValidators } from "../intelligence/sourceAdapters.ts";

const MAXIMUM_SOURCE_ID_LENGTH = 500;
const MAXIMUM_CACHE_VALIDATOR_LENGTH = 500;

export const SELECT_EXTERNAL_INTELLIGENCE_CACHE_SQL =
  `SELECT source_id, etag, last_modified, observed_at_ms
   FROM external_intelligence_source_cache
   WHERE source_id = ?`;

export const UPSERT_EXTERNAL_INTELLIGENCE_CACHE_SQL =
  `INSERT INTO external_intelligence_source_cache
     (source_id, etag, last_modified, observed_at_ms)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(source_id) DO UPDATE SET
     etag = excluded.etag,
     last_modified = excluded.last_modified,
     observed_at_ms = excluded.observed_at_ms
   WHERE excluded.observed_at_ms >= external_intelligence_source_cache.observed_at_ms`;

interface ExternalIntelligenceCacheRow {
  readonly source_id: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly observed_at_ms: number;
}

function assertCanonicalText(
  name: string,
  value: string,
  maximumLength: number,
): void {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be bounded canonical text`);
  }
}

function assertSourceId(sourceId: string): void {
  assertCanonicalText("sourceId", sourceId, MAXIMUM_SOURCE_ID_LENGTH);
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertValidator(
  name: string,
  value: string | null,
  maximumLength: number,
): void {
  if (value !== null) assertCanonicalText(name, value, maximumLength);
}

export function validateExternalIntelligenceCacheValidators(
  validators: ExternalIntelligenceCacheValidators,
): void {
  assertValidator("etag", validators.etag, MAXIMUM_CACHE_VALIDATOR_LENGTH);
  assertValidator(
    "lastModified",
    validators.lastModified,
    MAXIMUM_CACHE_VALIDATOR_LENGTH,
  );
}

function validateRow(row: ExternalIntelligenceCacheRow, sourceId: string): void {
  if (row.source_id !== sourceId) {
    throw new Error("External intelligence cache returned the wrong source identity");
  }
  validateExternalIntelligenceCacheValidators({
    etag: row.etag,
    lastModified: row.last_modified,
  });
  assertTime("observedAtMs", row.observed_at_ms);
}

function rowMatches(
  row: ExternalIntelligenceCacheRow,
  validators: ExternalIntelligenceCacheValidators,
  observedAtMs: number,
): boolean {
  return (
    row.etag === validators.etag &&
    row.last_modified === validators.lastModified &&
    row.observed_at_ms === observedAtMs
  );
}

export class D1ExternalIntelligenceCacheState
  implements ExternalIntelligenceCacheState
{
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async load(
    sourceId: string,
  ): Promise<ExternalIntelligenceCacheValidators | undefined> {
    assertSourceId(sourceId);
    const row = await this.db
      .prepare(SELECT_EXTERNAL_INTELLIGENCE_CACHE_SQL)
      .bind(sourceId)
      .first<ExternalIntelligenceCacheRow>();
    if (row === null) return undefined;
    validateRow(row, sourceId);
    return { etag: row.etag, lastModified: row.last_modified };
  }

  async save(
    sourceId: string,
    validators: ExternalIntelligenceCacheValidators,
    observedAtMs: number,
  ): Promise<void> {
    assertSourceId(sourceId);
    validateExternalIntelligenceCacheValidators(validators);
    assertTime("observedAtMs", observedAtMs);

    await this.db
      .prepare(UPSERT_EXTERNAL_INTELLIGENCE_CACHE_SQL)
      .bind(sourceId, validators.etag, validators.lastModified, observedAtMs)
      .run();

    const stored = await this.db
      .prepare(SELECT_EXTERNAL_INTELLIGENCE_CACHE_SQL)
      .bind(sourceId)
      .first<ExternalIntelligenceCacheRow>();
    if (stored === null) {
      throw new Error("External intelligence cache write was not persisted");
    }
    validateRow(stored, sourceId);
    if (!rowMatches(stored, validators, observedAtMs)) {
      throw new Error(
        "External intelligence cache rejected stale or conflicting validators",
      );
    }
  }
}
