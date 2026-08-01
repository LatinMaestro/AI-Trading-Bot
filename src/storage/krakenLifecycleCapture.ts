import type {
  KrakenLifecycleCaptureSink,
  KrakenLifecycleSourceCapture,
} from "../universe/krakenLifecycleCapture.ts";

type D1BindValue = string | number | null;
const encoder = new TextEncoder();

export interface KrakenLifecycleCaptureStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export const INSERT_KRAKEN_LIFECYCLE_PAYLOAD_SQL =
  `INSERT INTO kraken_lifecycle_source_payloads
    (payload_sha256, payload_byte_length, payload_text)
   VALUES (?, ?, ?)
   ON CONFLICT(payload_sha256) DO NOTHING`;

export const INSERT_KRAKEN_LIFECYCLE_CAPTURE_SQL =
  `INSERT INTO kraken_lifecycle_source_captures
    (capture_id, source_kind, source_ref, fetched_at_ms, payload_sha256,
     content_type, etag, last_modified)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(capture_id) DO NOTHING`;

export const INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL =
  `INSERT INTO kraken_lifecycle_source_capture_commits
    (capture_id, committed_at_ms)
   VALUES (?, ?)
   ON CONFLICT(capture_id) DO NOTHING`;

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

export function prepareKrakenLifecycleCapturePersistence(
  captures: readonly KrakenLifecycleSourceCapture[],
  committedAtMs: number,
): readonly KrakenLifecycleCaptureStatement[] {
  assertTime("committedAtMs", committedAtMs);
  if (captures.length === 0 || captures.length > 10) {
    throw new Error("Lifecycle persistence requires 1 to 10 captures");
  }
  const captureIds = new Set<string>();
  const naturalIdentities = new Set<string>();
  const payloadIdentities = new Map<string, string>();
  const statements: KrakenLifecycleCaptureStatement[] = [];
  for (const capture of captures) {
    if (captureIds.has(capture.captureId)) {
      throw new Error(`Duplicate lifecycle capture ${capture.captureId}`);
    }
    captureIds.add(capture.captureId);
    const naturalIdentity = `${capture.sourceRef}:${capture.fetchedAtMs}`;
    if (naturalIdentities.has(naturalIdentity)) {
      throw new Error(`Duplicate lifecycle source fetch ${naturalIdentity}`);
    }
    naturalIdentities.add(naturalIdentity);
    if (capture.fetchedAtMs > committedAtMs) {
      throw new Error("Lifecycle capture commit precedes a source fetch");
    }
    const payloadByteLength = encoder.encode(capture.payloadText).byteLength;
    if (
      payloadByteLength === 0 ||
      payloadByteLength > 1_048_576 ||
      payloadByteLength !== capture.payloadByteLength
    ) {
      throw new Error("Lifecycle capture payload length is invalid");
    }
    const payloadIdentity = JSON.stringify({
      payloadByteLength: capture.payloadByteLength,
      payloadText: capture.payloadText,
    });
    const previousPayloadIdentity = payloadIdentities.get(capture.payloadSha256);
    if (
      previousPayloadIdentity !== undefined &&
      previousPayloadIdentity !== payloadIdentity
    ) {
      throw new Error(
        `Conflicting lifecycle payload ${capture.payloadSha256}`,
      );
    }
    payloadIdentities.set(capture.payloadSha256, payloadIdentity);
    statements.push(
      {
        sql: INSERT_KRAKEN_LIFECYCLE_PAYLOAD_SQL,
        params: [
          capture.payloadSha256,
          capture.payloadByteLength,
          capture.payloadText,
        ],
      },
      {
        sql: INSERT_KRAKEN_LIFECYCLE_CAPTURE_SQL,
        params: [
          capture.captureId,
          capture.sourceKind,
          capture.sourceRef,
          capture.fetchedAtMs,
          capture.payloadSha256,
          capture.contentType,
          capture.etag,
          capture.lastModified,
        ],
      },
      {
        sql: INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL,
        params: [capture.captureId, committedAtMs],
      },
    );
  }
  return statements;
}

export class KrakenLifecycleCaptureRepository
  implements KrakenLifecycleCaptureSink {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistCaptures(
    captures: readonly KrakenLifecycleSourceCapture[],
    committedAtMs: number,
  ): Promise<void> {
    const statements = prepareKrakenLifecycleCapturePersistence(
      captures,
      committedAtMs,
    ).map((statement) =>
      this.db.prepare(statement.sql).bind(...statement.params),
    );
    await this.db.batch(statements);
  }
}