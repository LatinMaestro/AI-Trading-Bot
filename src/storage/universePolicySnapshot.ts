import { canonicalIntelligenceJson } from "../intelligence/canonical.ts";
import {
  prepareSignedUniversePolicy,
  prepareUniverseSnapshotManifest,
  verifySignedUniversePolicy,
  verifyUniverseSnapshotManifest,
  type SignedUniversePolicy,
  type UniverseSnapshotManifest,
} from "../universe/signedPolicySnapshot.ts";
import {
  prepareUniverseSignalTimeMembership,
  type UniverseSignalTimeMembership,
} from "../universe/signalTimeMembership.ts";
import type {
  UniversePolicy,
  UniverseSnapshot,
} from "../universe/types.ts";

type D1BindValue = string | number | null;

export interface UniversePolicySnapshotPersistenceInput {
  readonly signedPolicy: SignedUniversePolicy;
  readonly manifest: UniverseSnapshotManifest;
  readonly persistedAtMs: number;
}

export interface UniversePolicySnapshotStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export const INSERT_SIGNED_UNIVERSE_POLICY_SQL =
  `INSERT INTO signed_universe_policies
    (signed_policy_sha256, policy_version, signed_payload_sha256,
     verification_key_sha256, signer_key_id, approved_at_ms,
     effective_from_ms, expires_at_ms, policy_json,
     calibration_sha256s_json, verification_key_jwk_json, signature_hex)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(signed_policy_sha256) DO NOTHING`;

export const INSERT_UNIVERSE_POLICY_SNAPSHOT_SQL =
  `INSERT INTO universe_policy_snapshots
    (snapshot_sha256, signed_policy_sha256, ingestion_batch_sha256,
     as_of_ms, snapshot_json, source_digests_json, candidate_count,
     eligible_pair_count, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(snapshot_sha256) DO NOTHING`;

export const SELECT_UNIVERSE_SIGNAL_SNAPSHOT_SQL =
  `SELECT
     snapshot.snapshot_sha256,
     snapshot.signed_policy_sha256,
     snapshot.ingestion_batch_sha256,
     snapshot.as_of_ms,
     snapshot.snapshot_json,
     snapshot.source_digests_json,
     snapshot.persisted_at_ms,
     policy.policy_version,
     policy.signed_payload_sha256,
     policy.verification_key_sha256,
     policy.signer_key_id,
     policy.approved_at_ms,
     policy.effective_from_ms,
     policy.expires_at_ms,
     policy.policy_json,
     policy.calibration_sha256s_json,
     policy.verification_key_jwk_json,
     policy.signature_hex
   FROM universe_policy_snapshots snapshot
   JOIN signed_universe_policies policy
     ON policy.signed_policy_sha256 = snapshot.signed_policy_sha256
   WHERE snapshot.snapshot_sha256 = ?`;

interface UniverseSignalSnapshotRow {
  readonly snapshot_sha256: string;
  readonly signed_policy_sha256: string;
  readonly ingestion_batch_sha256: string;
  readonly as_of_ms: number;
  readonly snapshot_json: string;
  readonly source_digests_json: string;
  readonly persisted_at_ms: number;
  readonly policy_version: string;
  readonly signed_payload_sha256: string;
  readonly verification_key_sha256: string;
  readonly signer_key_id: string;
  readonly approved_at_ms: number;
  readonly effective_from_ms: number;
  readonly expires_at_ms: number;
  readonly policy_json: string;
  readonly calibration_sha256s_json: string;
  readonly verification_key_jwk_json: string;
  readonly signature_hex: string;
}

function parseJson<T>(name: string, value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${name} is invalid JSON`);
  }
}

async function membershipOf(
  row: UniverseSignalSnapshotRow,
  decisionAtMs: number,
): Promise<UniverseSignalTimeMembership> {
  const signedPolicy = await prepareSignedUniversePolicy({
    policyVersion: row.policy_version,
    policy: parseJson<UniversePolicy>("persisted universe policy", row.policy_json),
    calibrationSha256s: parseJson<readonly string[]>(
      "persisted calibration evidence",
      row.calibration_sha256s_json,
    ),
    approvedAtMs: row.approved_at_ms,
    effectiveFromMs: row.effective_from_ms,
    expiresAtMs: row.expires_at_ms,
    signerKeyId: row.signer_key_id,
    verificationKeyJwk: parseJson<JsonWebKey>(
      "persisted universe verification key",
      row.verification_key_jwk_json,
    ),
    signatureHex: row.signature_hex,
  });
  if (
    signedPolicy.signedPolicySha256 !== row.signed_policy_sha256 ||
    signedPolicy.signedPayloadSha256 !== row.signed_payload_sha256 ||
    signedPolicy.verificationKeySha256 !== row.verification_key_sha256
  ) {
    throw new Error("persisted signed universe policy identity is invalid");
  }
  const snapshot = parseJson<UniverseSnapshot>(
    "persisted universe snapshot",
    row.snapshot_json,
  );
  if (snapshot.asOfMs !== row.as_of_ms) {
    throw new Error("persisted universe snapshot time is inconsistent");
  }
  const manifest = await prepareUniverseSnapshotManifest({
    signedPolicy,
    ingestionBatchSha256: row.ingestion_batch_sha256,
    sourceDigests: parseJson<readonly string[]>(
      "persisted universe source evidence",
      row.source_digests_json,
    ),
    snapshot,
  });
  if (manifest.snapshotSha256 !== row.snapshot_sha256) {
    throw new Error("persisted universe snapshot identity is invalid");
  }
  return prepareUniverseSignalTimeMembership({
    decisionAtMs,
    snapshotAvailableAtMs: row.persisted_at_ms,
    signedPolicy,
    manifest,
  });
}

export async function prepareUniversePolicySnapshotPersistence(
  input: UniversePolicySnapshotPersistenceInput,
): Promise<readonly UniversePolicySnapshotStatement[]> {
  if (
    !Number.isSafeInteger(input.persistedAtMs) ||
    input.persistedAtMs < input.manifest.snapshot.asOfMs
  ) {
    throw new Error(
      "universe snapshot persistence time must be a safe time at or after asOf",
    );
  }
  await verifySignedUniversePolicy(input.signedPolicy);
  await verifyUniverseSnapshotManifest(input.manifest, input.signedPolicy);
  const policy = input.signedPolicy;
  const manifest = input.manifest;
  return [
    {
      sql: INSERT_SIGNED_UNIVERSE_POLICY_SQL,
      params: [
        policy.signedPolicySha256,
        policy.policyVersion,
        policy.signedPayloadSha256,
        policy.verificationKeySha256,
        policy.signerKeyId,
        policy.approvedAtMs,
        policy.effectiveFromMs,
        policy.expiresAtMs,
        canonicalIntelligenceJson(policy.policy),
        canonicalIntelligenceJson(policy.calibrationSha256s),
        policy.verificationKeyJwkJson,
        policy.signatureHex,
      ],
    },
    {
      sql: INSERT_UNIVERSE_POLICY_SNAPSHOT_SQL,
      params: [
        manifest.snapshotSha256,
        manifest.signedPolicySha256,
        manifest.ingestionBatchSha256,
        manifest.snapshot.asOfMs,
        canonicalIntelligenceJson(manifest.snapshot),
        canonicalIntelligenceJson(manifest.sourceDigests),
        manifest.snapshot.candidates.length,
        manifest.snapshot.eligiblePairs.length,
        input.persistedAtMs,
      ],
    },
  ];
}

export class UniversePolicySnapshotRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: UniversePolicySnapshotPersistenceInput,
  ): Promise<UniverseSnapshotManifest> {
    const statements =
      await prepareUniversePolicySnapshotPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params),
      ),
    );
    return input.manifest;
  }

  async loadSignalTimeMembership(
    snapshotSha256: string,
    decisionAtMs: number,
  ): Promise<UniverseSignalTimeMembership> {
    const row = await this.db
      .prepare(SELECT_UNIVERSE_SIGNAL_SNAPSHOT_SQL)
      .bind(snapshotSha256)
      .first<UniverseSignalSnapshotRow>();
    if (row === null) {
      throw new Error("exact persisted universe snapshot is unavailable");
    }
    return membershipOf(row, decisionAtMs);
  }
}
