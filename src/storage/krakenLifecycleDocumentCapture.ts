import {
  assertCanonicalKrakenLifecycleDiscoveredTarget,
  type KrakenLifecycleDocumentCapture,
  type KrakenLifecycleDocumentCaptureSink,
} from "../universe/krakenLifecycleDocumentCapture.ts";
import type { KrakenLifecycleListingIndexPageCapture } from "../universe/krakenLifecycleDiscovery.ts";
import { sha256Hex } from "../utils/crypto.ts";

type D1BindValue = string | number | null;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

export interface KrakenLifecycleDocumentCaptureStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export const INSERT_KRAKEN_LIFECYCLE_DOCUMENT_PAYLOAD_SQL =
  `INSERT INTO kraken_lifecycle_source_payloads
    (payload_sha256, payload_byte_length, payload_text)
   VALUES (?, ?, ?)
   ON CONFLICT(payload_sha256) DO NOTHING`;

export const INSERT_KRAKEN_LIFECYCLE_DOCUMENT_CAPTURE_SQL =
  `INSERT INTO kraken_lifecycle_document_captures
    (capture_id, source_kind, source_ref, discovered_from_capture_id,
     discovered_from_payload_sha256, discovery_sha256, fetched_at_ms,
     payload_sha256, content_type, etag, last_modified)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(capture_id) DO NOTHING`;

export const INSERT_KRAKEN_LIFECYCLE_DOCUMENT_CAPTURE_COMMIT_SQL =
  `INSERT INTO kraken_lifecycle_document_capture_commits
    (capture_id, committed_at_ms)
   VALUES (?, ?)
   ON CONFLICT(capture_id) DO NOTHING`;

export const SELECT_COMMITTED_KRAKEN_LIFECYCLE_DOCUMENT_REFS_SQL =
  `SELECT capture.source_ref
   FROM kraken_lifecycle_document_captures capture
   JOIN kraken_lifecycle_document_capture_commits committed
     ON committed.capture_id = capture.capture_id
   GROUP BY capture.source_ref
   ORDER BY capture.source_ref`;

export const SELECT_LATEST_COMMITTED_KRAKEN_LISTING_INDEX_PAGES_SQL =
  `WITH latest AS (
     SELECT capture.capture_id, capture.source_ref, capture.payload_sha256,
            payload.payload_byte_length, payload.payload_text,
            capture.content_type,
            CAST(substr(
              capture.source_ref,
              length('https://blog.kraken.com/category/product/asset-listings/page/') + 1
            ) AS INTEGER) AS page_number
     FROM kraken_lifecycle_document_captures capture
     JOIN kraken_lifecycle_document_capture_commits committed
       ON committed.capture_id = capture.capture_id
     JOIN kraken_lifecycle_source_payloads payload
       ON payload.payload_sha256 = capture.payload_sha256
     WHERE capture.source_kind = 'asset-listings-index-page'
       AND NOT EXISTS (
         SELECT 1
         FROM kraken_lifecycle_document_captures newer
         JOIN kraken_lifecycle_document_capture_commits newer_committed
           ON newer_committed.capture_id = newer.capture_id
         WHERE newer.source_kind = 'asset-listings-index-page'
           AND newer.source_ref = capture.source_ref
           AND (
             newer.fetched_at_ms > capture.fetched_at_ms
             OR (
               newer.fetched_at_ms = capture.fetched_at_ms
               AND newer.capture_id > capture.capture_id
             )
           )
       )
   ),
   rotated AS (
     SELECT latest.*,
            row_number() OVER (
              ORDER BY CASE
                WHEN page_number >= ?1 THEN page_number
                ELSE page_number + 499
              END
            ) AS page_ordinal,
            sum(payload_byte_length) OVER (
              ORDER BY CASE
                WHEN page_number >= ?1 THEN page_number
                ELSE page_number + 499
              END
            ) AS cumulative_payload_bytes
     FROM latest
   )
   SELECT capture_id, source_ref, payload_sha256, payload_byte_length,
          payload_text, content_type
   FROM rotated
   WHERE page_ordinal <= 32
     AND cumulative_payload_bytes <= 8388608
   ORDER BY page_ordinal`;

interface KrakenListingIndexPageRow {
  readonly capture_id: string;
  readonly source_ref: string;
  readonly payload_sha256: string;
  readonly payload_byte_length: number;
  readonly payload_text: string;
  readonly content_type: string;
}

function listingIndexPageFromRow(
  row: KrakenListingIndexPageRow,
): KrakenLifecycleListingIndexPageCapture {
  const page: KrakenLifecycleListingIndexPageCapture = {
    captureId: row.capture_id,
    sourceKind: "asset-listings-index-page",
    sourceRef: row.source_ref,
    payloadSha256: row.payload_sha256,
    payloadByteLength: row.payload_byte_length,
    payloadText: row.payload_text,
    contentType: "text/html",
  };
  assertDigest("captureId", page.captureId);
  assertDigest("payloadSha256", page.payloadSha256);
  if (
    row.content_type !== "text/html" ||
    typeof page.sourceRef !== "string" ||
    typeof page.payloadText !== "string" ||
    !Number.isSafeInteger(page.payloadByteLength) ||
    page.payloadByteLength < 1 ||
    page.payloadByteLength > 1_048_576 ||
    encoder.encode(page.payloadText).byteLength !== page.payloadByteLength
  ) {
    throw new Error(
      "Lifecycle document repository returned an invalid listing index page",
    );
  }
  assertCanonicalKrakenLifecycleDiscoveredTarget({
    sourceKind: page.sourceKind,
    sourceRef: page.sourceRef,
    discoveredFromCaptureId: page.captureId,
    discoveredFromPayloadSha256: page.payloadSha256,
  });
  return page;
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function prepareKrakenLifecycleDocumentCapturePersistenceStatements(
  captures: readonly KrakenLifecycleDocumentCapture[],
  committedAtMs: number,
): readonly KrakenLifecycleDocumentCaptureStatement[] {
  assertTime("committedAtMs", committedAtMs);
  if (captures.length === 0 || captures.length > 10) {
    throw new Error("Lifecycle document persistence requires 1 to 10 captures");
  }
  const captureIds = new Set<string>();
  const naturalIdentities = new Set<string>();
  const payloadIdentities = new Map<string, string>();
  const statements: KrakenLifecycleDocumentCaptureStatement[] = [];
  for (const capture of captures) {
    assertDigest("captureId", capture.captureId);
    assertDigest("payloadSha256", capture.payloadSha256);
    assertDigest("discoverySha256", capture.discoverySha256);
    assertCanonicalKrakenLifecycleDiscoveredTarget({
      sourceKind: capture.sourceKind,
      sourceRef: capture.sourceRef,
      discoveredFromCaptureId: capture.discoveredFromCaptureId,
      discoveredFromPayloadSha256: capture.discoveredFromPayloadSha256,
    });
    if (capture.contentType !== "text/html") {
      throw new Error("Lifecycle document capture must contain HTML");
    }
    for (const header of [capture.etag, capture.lastModified]) {
      if (
        header !== null &&
        (header.length === 0 ||
          header.length > 500 ||
          header.trim() !== header ||
          /[\u0000-\u001f\u007f]/u.test(header))
      ) {
        throw new Error("Lifecycle document capture has an unsafe cache header");
      }
    }
    if (captureIds.has(capture.captureId)) {
      throw new Error(`Duplicate lifecycle document capture ${capture.captureId}`);
    }
    captureIds.add(capture.captureId);
    const naturalIdentity = `${capture.sourceRef}:${capture.fetchedAtMs}`;
    if (naturalIdentities.has(naturalIdentity)) {
      throw new Error(`Duplicate lifecycle document fetch ${naturalIdentity}`);
    }
    naturalIdentities.add(naturalIdentity);
    assertTime("fetchedAtMs", capture.fetchedAtMs);
    if (capture.fetchedAtMs > committedAtMs) {
      throw new Error("Lifecycle document commit precedes a source fetch");
    }
    const payloadByteLength = encoder.encode(capture.payloadText).byteLength;
    if (
      payloadByteLength === 0 ||
      payloadByteLength > 1_048_576 ||
      payloadByteLength !== capture.payloadByteLength
    ) {
      throw new Error("Lifecycle document payload length is invalid");
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
      throw new Error(`Conflicting lifecycle payload ${capture.payloadSha256}`);
    }
    payloadIdentities.set(capture.payloadSha256, payloadIdentity);
    statements.push(
      {
        sql: INSERT_KRAKEN_LIFECYCLE_DOCUMENT_PAYLOAD_SQL,
        params: [
          capture.payloadSha256,
          capture.payloadByteLength,
          capture.payloadText,
        ],
      },
      {
        sql: INSERT_KRAKEN_LIFECYCLE_DOCUMENT_CAPTURE_SQL,
        params: [
          capture.captureId,
          capture.sourceKind,
          capture.sourceRef,
          capture.discoveredFromCaptureId,
          capture.discoveredFromPayloadSha256,
          capture.discoverySha256,
          capture.fetchedAtMs,
          capture.payloadSha256,
          capture.contentType,
          capture.etag,
          capture.lastModified,
        ],
      },
      {
        sql: INSERT_KRAKEN_LIFECYCLE_DOCUMENT_CAPTURE_COMMIT_SQL,
        params: [capture.captureId, committedAtMs],
      },
    );
  }
  return statements;
}

export async function prepareKrakenLifecycleDocumentCapturePersistence(
  captures: readonly KrakenLifecycleDocumentCapture[],
  committedAtMs: number,
): Promise<readonly KrakenLifecycleDocumentCaptureStatement[]> {
  const statements = prepareKrakenLifecycleDocumentCapturePersistenceStatements(
    captures,
    committedAtMs,
  );
  for (const capture of captures) {
    if ((await sha256Hex(capture.payloadText)) !== capture.payloadSha256) {
      throw new Error("Lifecycle document payload digest does not match");
    }
    const captureEnvelope = JSON.stringify({
      schemaVersion: "kraken-lifecycle-document-capture-v1",
      sourceKind: capture.sourceKind,
      sourceRef: capture.sourceRef,
      discoveredFromCaptureId: capture.discoveredFromCaptureId,
      discoveredFromPayloadSha256: capture.discoveredFromPayloadSha256,
      discoverySha256: capture.discoverySha256,
      fetchedAtMs: capture.fetchedAtMs,
      payloadSha256: capture.payloadSha256,
      payloadByteLength: capture.payloadByteLength,
      contentType: capture.contentType,
      etag: capture.etag,
      lastModified: capture.lastModified,
    });
    if ((await sha256Hex(captureEnvelope)) !== capture.captureId) {
      throw new Error("Lifecycle document capture digest does not match");
    }
  }
  return statements;
}

export class KrakenLifecycleDocumentCaptureRepository
  implements KrakenLifecycleDocumentCaptureSink {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async loadCommittedSourceRefs(): Promise<ReadonlySet<string>> {
    const result = await this.db
      .prepare(SELECT_COMMITTED_KRAKEN_LIFECYCLE_DOCUMENT_REFS_SQL)
      .all<{ source_ref: string }>();
    const refs = new Set<string>();
    for (const row of result.results) {
      if (
        typeof row.source_ref !== "string" ||
        row.source_ref.length === 0 ||
        row.source_ref.length > 500
      ) {
        throw new Error("Lifecycle document repository returned an invalid ref");
      }
      refs.add(row.source_ref);
    }
    return refs;
  }

  async loadLatestCommittedListingIndexPages(
    rotationStartPage: number,
  ): Promise<
    readonly KrakenLifecycleListingIndexPageCapture[]
  > {
    if (
      !Number.isSafeInteger(rotationStartPage) ||
      rotationStartPage < 2 ||
      rotationStartPage > 500
    ) {
      throw new Error("Lifecycle listing-page rotation start is invalid");
    }
    const result = await this.db
      .prepare(SELECT_LATEST_COMMITTED_KRAKEN_LISTING_INDEX_PAGES_SQL)
      .bind(rotationStartPage)
      .all<KrakenListingIndexPageRow>();
    return result.results.map(listingIndexPageFromRow);
  }

  async persistDocumentCaptures(
    captures: readonly KrakenLifecycleDocumentCapture[],
    committedAtMs: number,
  ): Promise<void> {
    const prepared = await prepareKrakenLifecycleDocumentCapturePersistence(
      captures,
      committedAtMs,
    );
    const statements = prepared.map((statement) =>
      this.db.prepare(statement.sql).bind(...statement.params),
    );
    await this.db.batch(statements);
  }
}
