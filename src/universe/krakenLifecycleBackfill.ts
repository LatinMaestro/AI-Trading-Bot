import { sha256Hex } from "../utils/crypto.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_PAIR_PATTERN = /^[A-Z0-9][A-Z0-9.]{0,47}\/AUD$/;
const MAXIMUM_PAIRS = 500;
const MAXIMUM_DOCUMENTS = 200;
const MAXIMUM_DECLARATIONS = 100_000;

export type KrakenLifecycleMissingEvidence =
  | "listing-history"
  | "trading-history"
  | "australian-availability-history";

const MISSING_EVIDENCE_ORDER: readonly KrakenLifecycleMissingEvidence[] = [
  "listing-history",
  "trading-history",
  "australian-availability-history",
];
const MISSING_EVIDENCE = new Set(MISSING_EVIDENCE_ORDER);

export interface KrakenLifecycleBackfillPairCoverageInput {
  readonly canonicalPair: string;
  readonly complete: boolean;
  readonly missingEvidence: readonly KrakenLifecycleMissingEvidence[];
}

export interface KrakenLifecycleBackfillManifestInput {
  readonly recordedAtMs: number;
  readonly bindingSha256: string;
  readonly evidenceSha256: string;
  readonly expectedPairs: readonly string[];
  readonly documentCount: number;
  readonly declarationCount: number;
  readonly coverage: readonly KrakenLifecycleBackfillPairCoverageInput[];
}

export interface KrakenLifecycleBackfillPairCoverage {
  readonly canonicalPair: string;
  readonly complete: boolean;
  readonly missingEvidence: readonly KrakenLifecycleMissingEvidence[];
}

export interface KrakenLifecycleBackfillManifest {
  readonly schemaVersion: "kraken-lifecycle-backfill-v1";
  readonly manifestSha256: string;
  readonly recordedAtMs: number;
  readonly bindingSha256: string;
  readonly evidenceSha256: string;
  readonly status: "partial" | "complete";
  readonly coverageAuthoritative: boolean;
  readonly pairCount: number;
  readonly completePairCount: number;
  readonly documentCount: number;
  readonly declarationCount: number;
  readonly coverage: readonly KrakenLifecycleBackfillPairCoverage[];
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveBoundedInteger(
  name: string,
  value: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertCanonicalPair(value: string): void {
  if (!CANONICAL_PAIR_PATTERN.test(value)) {
    throw new Error(`Lifecycle backfill pair ${value} is not canonical AUD`);
  }
}

function canonicalMissingEvidence(
  values: readonly KrakenLifecycleMissingEvidence[],
): readonly KrakenLifecycleMissingEvidence[] {
  const selected = new Set<KrakenLifecycleMissingEvidence>();
  for (const value of values) {
    if (!MISSING_EVIDENCE.has(value)) {
      throw new Error(`Unknown lifecycle coverage gap ${value}`);
    }
    if (selected.has(value)) {
      throw new Error(`Duplicate lifecycle coverage gap ${value}`);
    }
    selected.add(value);
  }
  return MISSING_EVIDENCE_ORDER.filter((value) => selected.has(value));
}

function canonicalManifestJson(
  manifest: Omit<KrakenLifecycleBackfillManifest, "manifestSha256">,
): string {
  return JSON.stringify(manifest);
}

export async function prepareKrakenLifecycleBackfillManifest(
  input: KrakenLifecycleBackfillManifestInput,
): Promise<KrakenLifecycleBackfillManifest> {
  assertTime("recordedAtMs", input.recordedAtMs);
  assertDigest("bindingSha256", input.bindingSha256);
  assertDigest("evidenceSha256", input.evidenceSha256);
  assertPositiveBoundedInteger(
    "documentCount",
    input.documentCount,
    MAXIMUM_DOCUMENTS,
  );
  assertPositiveBoundedInteger(
    "declarationCount",
    input.declarationCount,
    MAXIMUM_DECLARATIONS,
  );
  if (
    input.expectedPairs.length < 1 ||
    input.expectedPairs.length > MAXIMUM_PAIRS
  ) {
    throw new Error("Lifecycle backfill requires 1 to 500 expected pairs");
  }
  const expectedPairs = [...input.expectedPairs].sort();
  for (const pair of expectedPairs) assertCanonicalPair(pair);
  if (new Set(expectedPairs).size !== expectedPairs.length) {
    throw new Error("Lifecycle backfill expectedPairs contain duplicates");
  }
  if (input.coverage.length !== expectedPairs.length) {
    throw new Error("Lifecycle backfill coverage count is incomplete");
  }

  const coverage = [...input.coverage]
    .map((item): KrakenLifecycleBackfillPairCoverage => {
      assertCanonicalPair(item.canonicalPair);
      const missingEvidence = canonicalMissingEvidence(item.missingEvidence);
      if (item.complete !== (missingEvidence.length === 0)) {
        throw new Error(
          `Lifecycle coverage completeness conflicts for ${item.canonicalPair}`,
        );
      }
      return {
        canonicalPair: item.canonicalPair,
        complete: item.complete,
        missingEvidence,
      };
    })
    .sort((left, right) =>
      left.canonicalPair.localeCompare(right.canonicalPair),
    );
  const coveragePairs = coverage.map((item) => item.canonicalPair);
  if (
    new Set(coveragePairs).size !== coveragePairs.length ||
    coveragePairs.some((pair, index) => pair !== expectedPairs[index])
  ) {
    throw new Error("Lifecycle backfill coverage does not match expected pairs");
  }
  const completePairCount = coverage.filter((item) => item.complete).length;
  const coverageAuthoritative = completePairCount === expectedPairs.length;
  const canonical: Omit<KrakenLifecycleBackfillManifest, "manifestSha256"> = {
    schemaVersion: "kraken-lifecycle-backfill-v1",
    recordedAtMs: input.recordedAtMs,
    bindingSha256: input.bindingSha256,
    evidenceSha256: input.evidenceSha256,
    status: coverageAuthoritative ? "complete" : "partial",
    coverageAuthoritative,
    pairCount: expectedPairs.length,
    completePairCount,
    documentCount: input.documentCount,
    declarationCount: input.declarationCount,
    coverage,
  };
  return {
    ...canonical,
    manifestSha256: await sha256Hex(canonicalManifestJson(canonical)),
  };
}

function manifestHeader(manifest: KrakenLifecycleBackfillManifest): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    recordedAtMs: manifest.recordedAtMs,
    bindingSha256: manifest.bindingSha256,
    evidenceSha256: manifest.evidenceSha256,
    status: manifest.status,
    coverageAuthoritative: manifest.coverageAuthoritative,
    pairCount: manifest.pairCount,
    completePairCount: manifest.completePairCount,
    documentCount: manifest.documentCount,
    declarationCount: manifest.declarationCount,
    coverage: manifest.coverage,
  });
}

export async function persistKrakenLifecycleBackfillManifest(
  database: D1Database,
  manifest: KrakenLifecycleBackfillManifest,
  committedAtMs: number,
): Promise<void> {
  assertTime("committedAtMs", committedAtMs);
  const reproduced = await prepareKrakenLifecycleBackfillManifest({
    recordedAtMs: manifest.recordedAtMs,
    bindingSha256: manifest.bindingSha256,
    evidenceSha256: manifest.evidenceSha256,
    expectedPairs: manifest.coverage.map((item) => item.canonicalPair),
    documentCount: manifest.documentCount,
    declarationCount: manifest.declarationCount,
    coverage: manifest.coverage,
  });
  if (
    reproduced.manifestSha256 !== manifest.manifestSha256 ||
    manifestHeader(reproduced) !== manifestHeader(manifest)
  ) {
    throw new Error("Kraken lifecycle backfill manifest identity mismatch");
  }
  if (committedAtMs < manifest.recordedAtMs) {
    throw new Error("Kraken lifecycle backfill commit predates recording");
  }

  const coverageJson = JSON.stringify(
    manifest.coverage.map((item) => ({
      canonicalPair: item.canonicalPair,
      complete: item.complete ? 1 : 0,
      missingEvidenceJson: JSON.stringify(item.missingEvidence),
    })),
  );
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO kraken_lifecycle_backfill_manifests (
          manifest_sha256,
          schema_version,
          recorded_at_ms,
          binding_sha256,
          evidence_sha256,
          status,
          coverage_authoritative,
          pair_count,
          complete_pair_count,
          document_count,
          declaration_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        manifest.manifestSha256,
        manifest.schemaVersion,
        manifest.recordedAtMs,
        manifest.bindingSha256,
        manifest.evidenceSha256,
        manifest.status,
        manifest.coverageAuthoritative ? 1 : 0,
        manifest.pairCount,
        manifest.completePairCount,
        manifest.documentCount,
        manifest.declarationCount,
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO kraken_lifecycle_backfill_pair_coverage (
          manifest_sha256,
          canonical_pair,
          complete,
          missing_evidence_json
        )
        SELECT
          ?,
          json_extract(value, '$.canonicalPair'),
          json_extract(value, '$.complete'),
          json_extract(value, '$.missingEvidenceJson')
        FROM json_each(?)`,
      )
      .bind(manifest.manifestSha256, coverageJson),
    database
      .prepare(
        `INSERT OR IGNORE INTO kraken_lifecycle_backfill_manifest_commits (
          manifest_sha256,
          committed_at_ms
        ) VALUES (?, ?)`,
      )
      .bind(manifest.manifestSha256, committedAtMs),
  ]);
}
