import {
  captureKrakenLifecycleSources,
  type KrakenLifecycleCaptureOptions,
  type KrakenLifecycleCaptureRun,
  type KrakenLifecycleCaptureTarget,
} from "../universe/krakenLifecycleCapture.ts";

type D1BindValue = string | number | null;

export interface LifecycleCaptureStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export interface PreparedLifecycleCapturePersistence {
  readonly run: KrakenLifecycleCaptureRun;
  readonly statements: readonly LifecycleCaptureStatement[];
}

export const INSERT_KRAKEN_LIFECYCLE_CAPTURE_RUN_SQL =
  `INSERT INTO kraken_lifecycle_capture_runs
    (run_sha256, recorded_at_ms, target_count, document_count)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(run_sha256) DO NOTHING`;

export const INSERT_KRAKEN_LIFECYCLE_DOCUMENTS_JSON_SQL =
  `INSERT INTO kraken_lifecycle_source_documents
    (document_sha256, source_class, source_ref, fetched_at_ms,
     payload_sha256, content_type, etag, last_modified, byte_length, payload_text)
   SELECT
     json_extract(value, '$.documentSha256'),
     json_extract(value, '$.sourceClass'),
     json_extract(value, '$.sourceRef'),
     json_extract(value, '$.fetchedAtMs'),
     json_extract(value, '$.payloadSha256'),
     json_extract(value, '$.contentType'),
     json_extract(value, '$.etag'),
     json_extract(value, '$.lastModified'),
     json_extract(value, '$.byteLength'),
     json_extract(value, '$.payloadText')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT DO NOTHING`;

export const INSERT_KRAKEN_LIFECYCLE_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO kraken_lifecycle_capture_run_documents
    (run_sha256, document_sha256)
   SELECT ?, json_extract(value, '$.documentSha256')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(run_sha256, document_sha256) DO NOTHING`;

export const INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL =
  `INSERT INTO kraken_lifecycle_capture_run_commits
    (run_sha256)
   VALUES (?)
   ON CONFLICT(run_sha256) DO NOTHING`;

export function prepareKrakenLifecycleCapturePersistence(
  run: KrakenLifecycleCaptureRun,
): PreparedLifecycleCapturePersistence {
  const documentsJson = JSON.stringify(run.documents);
  return {
    run,
    statements: [
      {
        sql: INSERT_KRAKEN_LIFECYCLE_CAPTURE_RUN_SQL,
        params: [
          run.runSha256,
          run.recordedAtMs,
          run.targetCount,
          run.documents.length,
        ],
      },
      {
        sql: INSERT_KRAKEN_LIFECYCLE_DOCUMENTS_JSON_SQL,
        params: [documentsJson],
      },
      {
        sql: INSERT_KRAKEN_LIFECYCLE_MEMBERSHIPS_JSON_SQL,
        params: [run.runSha256, documentsJson],
      },
      {
        sql: INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL,
        params: [run.runSha256],
      },
    ],
  };
}

export class KrakenLifecycleCaptureRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistRun(
    run: KrakenLifecycleCaptureRun,
  ): Promise<KrakenLifecycleCaptureRun> {
    const prepared = prepareKrakenLifecycleCapturePersistence(run);
    const statements = prepared.statements.map((statement) =>
      this.db.prepare(statement.sql).bind(...statement.params),
    );
    await this.db.batch(statements);
    return run;
  }

  async captureAndPersist(
    targets: readonly KrakenLifecycleCaptureTarget[],
    options: KrakenLifecycleCaptureOptions = {},
  ): Promise<KrakenLifecycleCaptureRun> {
    return this.persistRun(await captureKrakenLifecycleSources(targets, options));
  }
}
