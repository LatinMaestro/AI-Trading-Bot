import { canonicalIntelligenceJson } from "../intelligence/canonical.ts";
import {
  verifySignedUniversePolicy,
  verifyUniverseSnapshotManifest,
  type SignedUniversePolicy,
  type UniverseSnapshotManifest,
} from "../universe/signedPolicySnapshot.ts";

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
}
