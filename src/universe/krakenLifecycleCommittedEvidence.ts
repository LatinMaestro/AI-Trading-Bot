import { sha256Hex } from "../utils/crypto.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_PAIR_PATTERN = /^[A-Z0-9][A-Z0-9.]{0,47}\/AUD$/;
const DOCUMENT_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const MAXIMUM_DOCUMENTS = 200;
const MAXIMUM_DECLARATIONS_PER_DOCUMENT = 500;
const MAXIMUM_DECLARATIONS = 100_000;
const SOURCE_CLASSES = new Set<KrakenLifecycleSourceClass>([
  "asset-listing",
  "delisting-notice",
  "status-incident",
  "regional-availability",
]);
const EVENT_TYPES = new Set<KrakenLifecycleEventType>([
  "listed",
  "trading-online",
  "trading-suspended",
  "trading-resumed",
  "delisted",
  "au-enabled",
  "au-disabled",
]);
const SOURCE_EVENT_TYPES: Readonly<
  Record<KrakenLifecycleSourceClass, ReadonlySet<KrakenLifecycleEventType>>
> = {
  "asset-listing": new Set(["listed", "trading-online"]),
  "delisting-notice": new Set(["trading-suspended", "delisted"]),
  "status-incident": new Set(["trading-suspended", "trading-resumed"]),
  "regional-availability": new Set(["au-enabled", "au-disabled"]),
};

export type KrakenLifecycleSourceClass =
  | "asset-listing"
  | "delisting-notice"
  | "status-incident"
  | "regional-availability";

export type KrakenLifecycleEventType =
  | "listed"
  | "trading-online"
  | "trading-suspended"
  | "trading-resumed"
  | "delisted"
  | "au-enabled"
  | "au-disabled";

export interface ReviewedKrakenLifecycleDeclaration {
  readonly canonicalPair: string;
  readonly eventType: KrakenLifecycleEventType;
  readonly effectiveAtMs: number;
  readonly scope: "global" | "AU";
}

export interface ReviewedKrakenLifecycleDocument {
  readonly captureId: string;
  readonly documentId: string;
  readonly sourceClass: KrakenLifecycleSourceClass;
  readonly sourceRef: string;
  readonly publishedAtMs: number;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly declarations: readonly ReviewedKrakenLifecycleDeclaration[];
}

export interface BoundKrakenLifecycleDocument {
  readonly documentId: string;
  readonly sourceClass: KrakenLifecycleSourceClass;
  readonly sourceRef: string;
  readonly publishedAtMs: number;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly declarations: readonly ReviewedKrakenLifecycleDeclaration[];
}

export type KrakenLifecycleCaptureStorageKind =
  | "fixed-source"
  | "discovered-document";

export type KrakenLifecycleCommittedSourceKind =
  | "asset-listings-index"
  | "delistings-index"
  | "status-incidents"
  | "status-maintenance"
  | "asset-listing-document"
  | "asset-listings-index-page"
  | "support-lifecycle-document";

export interface CommittedKrakenLifecycleCapture {
  readonly captureId: string;
  readonly storageKind: KrakenLifecycleCaptureStorageKind;
  readonly sourceKind: KrakenLifecycleCommittedSourceKind;
  readonly sourceRef: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly committedAtMs: number;
}

export interface KrakenLifecycleCommittedCaptureRepository {
  loadCommittedCaptures(
    captureIds: readonly string[],
  ): Promise<readonly CommittedKrakenLifecycleCapture[]>;
}

export interface KrakenLifecycleDeclarationBinding {
  readonly captureId: string;
  readonly documentId: string;
  readonly storageKind: KrakenLifecycleCaptureStorageKind;
  readonly sourceKind: KrakenLifecycleCommittedSourceKind;
  readonly sourceRef: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly committedAtMs: number;
}

export interface BoundKrakenLifecycleEvidence {
  readonly documents: readonly BoundKrakenLifecycleDocument[];
  readonly bindings: readonly KrakenLifecycleDeclarationBinding[];
  readonly bindingSha256: string;
}

export interface PreparedCommittedKrakenLifecycleEvidence<T> {
  readonly preparedEvidence: T;
  readonly bindings: readonly KrakenLifecycleDeclarationBinding[];
  readonly bindingSha256: string;
}

interface D1CaptureRow {
  readonly capture_id: string;
  readonly storage_kind: KrakenLifecycleCaptureStorageKind;
  readonly source_kind: KrakenLifecycleCommittedSourceKind;
  readonly source_ref: string;
  readonly fetched_at_ms: number;
  readonly payload_sha256: string;
  readonly committed_at_ms: number;
}

export const LOAD_COMMITTED_KRAKEN_LIFECYCLE_CAPTURES_SQL = `
WITH requested(capture_id) AS (
  SELECT value
  FROM json_each(?1)
)
SELECT
  capture.capture_id,
  'fixed-source' AS storage_kind,
  capture.source_kind,
  capture.source_ref,
  capture.fetched_at_ms,
  capture.payload_sha256,
  committed.committed_at_ms
FROM kraken_lifecycle_source_captures capture
JOIN kraken_lifecycle_source_capture_commits committed
  ON committed.capture_id = capture.capture_id
JOIN requested
  ON requested.capture_id = capture.capture_id
UNION ALL
SELECT
  capture.capture_id,
  'discovered-document' AS storage_kind,
  capture.source_kind,
  capture.source_ref,
  capture.fetched_at_ms,
  capture.payload_sha256,
  committed.committed_at_ms
FROM kraken_lifecycle_document_captures capture
JOIN kraken_lifecycle_document_capture_commits committed
  ON committed.capture_id = capture.capture_id
JOIN requested
  ON requested.capture_id = capture.capture_id
ORDER BY 1, 2
`;

export class D1KrakenLifecycleCommittedCaptureRepository
  implements KrakenLifecycleCommittedCaptureRepository
{
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async loadCommittedCaptures(
    captureIds: readonly string[],
  ): Promise<readonly CommittedKrakenLifecycleCapture[]> {
    if (captureIds.length === 0 || captureIds.length > MAXIMUM_DOCUMENTS) {
      throw new Error("Committed lifecycle lookup requires 1 to 200 captures");
    }
    const result = await this.database
      .prepare(LOAD_COMMITTED_KRAKEN_LIFECYCLE_CAPTURES_SQL)
      .bind(JSON.stringify(captureIds))
      .all<D1CaptureRow>();
    return result.results.map((row) => ({
      captureId: row.capture_id,
      storageKind: row.storage_kind,
      sourceKind: row.source_kind,
      sourceRef: row.source_ref,
      fetchedAtMs: row.fetched_at_ms,
      payloadSha256: row.payload_sha256,
      committedAtMs: row.committed_at_ms,
    }));
  }
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

function assertReviewedDeclaration(
  document: ReviewedKrakenLifecycleDocument,
  declaration: ReviewedKrakenLifecycleDeclaration,
): void {
  if (!CANONICAL_PAIR_PATTERN.test(declaration.canonicalPair)) {
    throw new Error(
      `Reviewed lifecycle declaration pair ${declaration.canonicalPair} is not canonical AUD`,
    );
  }
  if (!EVENT_TYPES.has(declaration.eventType)) {
    throw new Error(
      `Unknown lifecycle event type ${declaration.eventType as string}`,
    );
  }
  assertTime("reviewed lifecycle effectiveAtMs", declaration.effectiveAtMs);
  const requiredScope =
    document.sourceClass === "regional-availability" ? "AU" : "global";
  if (declaration.scope !== requiredScope) {
    throw new Error(
      `Lifecycle source class ${document.sourceClass} requires ${requiredScope} scope`,
    );
  }
  if (!SOURCE_EVENT_TYPES[document.sourceClass].has(declaration.eventType)) {
    throw new Error(
      `Lifecycle event ${declaration.eventType} is incompatible with source class ${document.sourceClass}`,
    );
  }
}

function isCompatibleCapture(
  sourceClass: KrakenLifecycleSourceClass,
  capture: CommittedKrakenLifecycleCapture,
): boolean {
  if (sourceClass === "asset-listing") {
    return (
      capture.storageKind === "discovered-document" &&
      capture.sourceKind === "asset-listing-document"
    );
  }
  if (
    sourceClass === "delisting-notice" ||
    sourceClass === "regional-availability"
  ) {
    return (
      capture.storageKind === "discovered-document" &&
      capture.sourceKind === "support-lifecycle-document"
    );
  }
  return (
    capture.storageKind === "fixed-source" &&
    capture.sourceKind === "status-incidents"
  );
}

function canonicalBindingJson(
  recordedAtMs: number,
  documents: readonly BoundKrakenLifecycleDocument[],
  bindings: readonly KrakenLifecycleDeclarationBinding[],
): string {
  return JSON.stringify({
    schemaVersion: "kraken-lifecycle-committed-evidence-v1",
    recordedAtMs,
    documents,
    bindings,
  });
}

export async function bindReviewedKrakenLifecycleDocuments(
  reviewedDocuments: readonly ReviewedKrakenLifecycleDocument[],
  recordedAtMs: number,
  repository: KrakenLifecycleCommittedCaptureRepository,
): Promise<BoundKrakenLifecycleEvidence> {
  assertTime("recordedAtMs", recordedAtMs);
  if (
    reviewedDocuments.length === 0 ||
    reviewedDocuments.length > MAXIMUM_DOCUMENTS
  ) {
    throw new Error("Lifecycle binding requires 1 to 200 reviewed documents");
  }
  const documents = [...reviewedDocuments].sort(
    (left, right) =>
      left.documentId.localeCompare(right.documentId) ||
      left.captureId.localeCompare(right.captureId),
  );
  const captureIds = new Set<string>();
  const documentIds = new Set<string>();
  const declarationIds = new Set<string>();
  let declarationCount = 0;
  for (const document of documents) {
    assertDigest("reviewed captureId", document.captureId);
    assertDigest("reviewed payloadSha256", document.payloadSha256);
    if (!DOCUMENT_ID_PATTERN.test(document.documentId)) {
      throw new Error(
        `Reviewed lifecycle documentId ${document.documentId} is not canonical`,
      );
    }
    assertTime("reviewed publishedAtMs", document.publishedAtMs);
    assertTime("reviewed fetchedAtMs", document.fetchedAtMs);
    if (!SOURCE_CLASSES.has(document.sourceClass)) {
      throw new Error(`Unknown lifecycle source class ${document.sourceClass}`);
    }
    if (
      document.publishedAtMs > document.fetchedAtMs ||
      document.fetchedAtMs > recordedAtMs
    ) {
      throw new Error(
        `Reviewed lifecycle document ${document.documentId} has invalid publication/fetch chronology`,
      );
    }
    if (
      document.declarations.length === 0 ||
      document.declarations.length > MAXIMUM_DECLARATIONS_PER_DOCUMENT
    ) {
      throw new Error(
        `Reviewed lifecycle document ${document.documentId} requires 1 to 500 declarations`,
      );
    }
    declarationCount += document.declarations.length;
    if (declarationCount > MAXIMUM_DECLARATIONS) {
      throw new Error(
        "Lifecycle binding exceeds 100000 reviewed declarations",
      );
    }
    for (const declaration of document.declarations) {
      assertReviewedDeclaration(document, declaration);
      const declarationId = JSON.stringify([
        declaration.canonicalPair,
        declaration.eventType,
        declaration.effectiveAtMs,
        document.publishedAtMs,
        declaration.scope,
      ]);
      if (declarationIds.has(declarationId)) {
        throw new Error(
          `Duplicate reviewed lifecycle declaration ${declarationId}`,
        );
      }
      declarationIds.add(declarationId);
    }
    if (captureIds.has(document.captureId)) {
      throw new Error(`Duplicate reviewed capture ${document.captureId}`);
    }
    if (documentIds.has(document.documentId)) {
      throw new Error(`Duplicate reviewed document ${document.documentId}`);
    }
    captureIds.add(document.captureId);
    documentIds.add(document.documentId);
  }

  const captures = await repository.loadCommittedCaptures(
    [...captureIds].sort(),
  );
  const capturesById = new Map<string, CommittedKrakenLifecycleCapture>();
  for (const capture of captures) {
    assertDigest("committed captureId", capture.captureId);
    assertDigest("committed payloadSha256", capture.payloadSha256);
    assertTime("committed fetchedAtMs", capture.fetchedAtMs);
    assertTime("committed committedAtMs", capture.committedAtMs);
    if (!captureIds.has(capture.captureId)) {
      throw new Error(`Unexpected committed capture ${capture.captureId}`);
    }
    if (capturesById.has(capture.captureId)) {
      throw new Error(`Ambiguous committed capture ${capture.captureId}`);
    }
    capturesById.set(capture.captureId, capture);
  }

  const bindings: KrakenLifecycleDeclarationBinding[] = [];
  const boundDocuments: BoundKrakenLifecycleDocument[] = [];
  for (const document of documents) {
    const capture = capturesById.get(document.captureId);
    if (capture === undefined) {
      throw new Error(
        `Reviewed lifecycle document ${document.documentId} is not committed`,
      );
    }
    if (!isCompatibleCapture(document.sourceClass, capture)) {
      throw new Error(
        `Reviewed lifecycle document ${document.documentId} has incompatible committed source`,
      );
    }
    if (
      capture.sourceRef !== document.sourceRef ||
      capture.fetchedAtMs !== document.fetchedAtMs ||
      capture.payloadSha256 !== document.payloadSha256
    ) {
      throw new Error(
        `Reviewed lifecycle document ${document.documentId} does not match its committed capture`,
      );
    }
    if (
      capture.committedAtMs < capture.fetchedAtMs ||
      capture.committedAtMs > recordedAtMs
    ) {
      throw new Error(
        `Reviewed lifecycle document ${document.documentId} has unavailable commit chronology`,
      );
    }
    bindings.push({
      captureId: capture.captureId,
      documentId: document.documentId,
      storageKind: capture.storageKind,
      sourceKind: capture.sourceKind,
      sourceRef: capture.sourceRef,
      fetchedAtMs: capture.fetchedAtMs,
      payloadSha256: capture.payloadSha256,
      committedAtMs: capture.committedAtMs,
    });
    boundDocuments.push({
      documentId: document.documentId,
      sourceClass: document.sourceClass,
      sourceRef: document.sourceRef,
      publishedAtMs: document.publishedAtMs,
      fetchedAtMs: document.fetchedAtMs,
      payloadSha256: document.payloadSha256,
      declarations: [...document.declarations].sort(
        (left, right) =>
          left.canonicalPair.localeCompare(right.canonicalPair) ||
          left.effectiveAtMs - right.effectiveAtMs ||
          left.eventType.localeCompare(right.eventType) ||
          left.scope.localeCompare(right.scope),
      ),
    });
  }
  return {
    documents: boundDocuments,
    bindings,
    bindingSha256: await sha256Hex(
      canonicalBindingJson(recordedAtMs, boundDocuments, bindings),
    ),
  };
}

export async function prepareCommittedKrakenLifecycleEvidence<T>(
  reviewedDocuments: readonly ReviewedKrakenLifecycleDocument[],
  recordedAtMs: number,
  repository: KrakenLifecycleCommittedCaptureRepository,
  prepareEvidence: (
    documents: readonly BoundKrakenLifecycleDocument[],
    recordedAtMs: number,
  ) => Promise<T>,
): Promise<PreparedCommittedKrakenLifecycleEvidence<T>> {
  const bound = await bindReviewedKrakenLifecycleDocuments(
    reviewedDocuments,
    recordedAtMs,
    repository,
  );
  return {
    preparedEvidence: await prepareEvidence(bound.documents, recordedAtMs),
    bindings: bound.bindings,
    bindingSha256: bound.bindingSha256,
  };
}
