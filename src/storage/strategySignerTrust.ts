import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
import {
  verifyReviewedStrategySignerTrustAnchor,
  verifyStrategySignerTrustRevocation,
  type ReviewedStrategySignerTrustAnchor,
  type StrategySignerTrustRevocation,
} from "../security/strategySignerTrust.ts";

type D1BindValue = string | number | null;

export interface StrategySignerTrustPersistenceStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

interface PersistedTrustAnchorRow {
  readonly trust_anchor_sha256: string;
  readonly key_id: string;
  readonly verification_key_sha256: string;
  readonly trust_anchor_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedTrustRevocationRow {
  readonly revocation_sha256: string;
  readonly trust_anchor_sha256: string;
  readonly revocation_canonical_json: string;
  readonly persisted_at_ms: number;
}

export const INSERT_STRATEGY_SIGNER_TRUST_ANCHOR_SQL =
  `INSERT INTO strategy_signer_trust_anchors
    (trust_anchor_sha256, schema_version, trust_anchor_id, signer_role,
     key_id, verification_key_sha256, review_evidence_sha256,
     reviewed_at_ms, valid_from_ms, valid_until_ms,
     predecessor_trust_anchor_sha256, execution_authority,
     trust_anchor_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

export const INSERT_STRATEGY_SIGNER_TRUST_REVOCATION_SQL =
  `INSERT INTO strategy_signer_trust_revocations
    (revocation_sha256, schema_version, revocation_id,
     trust_anchor_sha256, revocation_reason, effective_at_ms,
     reviewed_at_ms, review_evidence_sha256, execution_authority,
     revocation_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

const SELECT_STRATEGY_SIGNER_TRUST_ANCHOR_SQL =
  `SELECT trust_anchor_sha256, key_id, verification_key_sha256,
          trust_anchor_canonical_json, persisted_at_ms
   FROM strategy_signer_trust_anchors
   WHERE trust_anchor_sha256 = ?`;

const SELECT_STRATEGY_SIGNER_TRUST_REVOCATION_SQL =
  `SELECT revocation_sha256, trust_anchor_sha256,
          revocation_canonical_json, persisted_at_ms
   FROM strategy_signer_trust_revocations
   WHERE revocation_sha256 = ?`;

function assertPersistenceTime(
  value: number,
  minimum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error("strategy signer trust persistence chronology is invalid");
  }
}

export async function prepareStrategySignerTrustAnchorPersistence(
  anchor: ReviewedStrategySignerTrustAnchor,
  persistedAtMs: number,
): Promise<StrategySignerTrustPersistenceStatement> {
  await verifyReviewedStrategySignerTrustAnchor(anchor);
  assertPersistenceTime(persistedAtMs, anchor.reviewedAtMs);
  return {
    sql: INSERT_STRATEGY_SIGNER_TRUST_ANCHOR_SQL,
    params: [
      anchor.trustAnchorSha256,
      "strategy-signer-trust-anchor-v1",
      anchor.trustAnchorId,
      anchor.role,
      anchor.keyId,
      anchor.verificationKeySha256,
      anchor.reviewEvidenceSha256,
      anchor.reviewedAtMs,
      anchor.validFromMs,
      anchor.validUntilMs,
      anchor.predecessorTrustAnchorSha256,
      anchor.executionAuthority,
      canonicalIntelligenceJson(anchor),
      persistedAtMs,
    ],
  };
}

export async function prepareStrategySignerTrustRevocationPersistence(
  revocation: StrategySignerTrustRevocation,
  anchor: ReviewedStrategySignerTrustAnchor,
  persistedAtMs: number,
): Promise<StrategySignerTrustPersistenceStatement> {
  await verifyStrategySignerTrustRevocation(revocation, anchor);
  assertPersistenceTime(persistedAtMs, revocation.reviewedAtMs);
  return {
    sql: INSERT_STRATEGY_SIGNER_TRUST_REVOCATION_SQL,
    params: [
      revocation.revocationSha256,
      "strategy-signer-trust-revocation-v1",
      revocation.revocationId,
      revocation.trustAnchorSha256,
      revocation.reason,
      revocation.effectiveAtMs,
      revocation.reviewedAtMs,
      revocation.reviewEvidenceSha256,
      revocation.executionAuthority,
      canonicalIntelligenceJson(revocation),
      persistedAtMs,
    ],
  };
}

export class StrategySignerTrustRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistAnchor(
    anchor: ReviewedStrategySignerTrustAnchor,
    persistedAtMs: number,
  ): Promise<ReviewedStrategySignerTrustAnchor> {
    const statement =
      await prepareStrategySignerTrustAnchorPersistence(
        anchor,
        persistedAtMs,
      );
    await this.db.prepare(statement.sql).bind(...statement.params).run();
    const row = await this.db
      .prepare(SELECT_STRATEGY_SIGNER_TRUST_ANCHOR_SQL)
      .bind(anchor.trustAnchorSha256)
      .first<PersistedTrustAnchorRow>();
    if (
      row === null ||
      row.trust_anchor_sha256 !== anchor.trustAnchorSha256 ||
      row.key_id !== anchor.keyId ||
      row.verification_key_sha256 !== anchor.verificationKeySha256 ||
      row.trust_anchor_canonical_json !== canonicalIntelligenceJson(anchor) ||
      row.persisted_at_ms < anchor.reviewedAtMs ||
      row.persisted_at_ms > persistedAtMs
    ) {
      throw new Error("persisted strategy signer trust anchor is invalid");
    }
    return anchor;
  }

  async persistRevocation(
    revocation: StrategySignerTrustRevocation,
    anchor: ReviewedStrategySignerTrustAnchor,
    persistedAtMs: number,
  ): Promise<StrategySignerTrustRevocation> {
    const statement =
      await prepareStrategySignerTrustRevocationPersistence(
        revocation,
        anchor,
        persistedAtMs,
      );
    await this.db.prepare(statement.sql).bind(...statement.params).run();
    const row = await this.db
      .prepare(SELECT_STRATEGY_SIGNER_TRUST_REVOCATION_SQL)
      .bind(revocation.revocationSha256)
      .first<PersistedTrustRevocationRow>();
    if (
      row === null ||
      row.revocation_sha256 !== revocation.revocationSha256 ||
      row.trust_anchor_sha256 !== anchor.trustAnchorSha256 ||
      row.revocation_canonical_json !==
        canonicalIntelligenceJson(revocation) ||
      row.persisted_at_ms < revocation.reviewedAtMs ||
      row.persisted_at_ms > persistedAtMs
    ) {
      throw new Error("persisted strategy signer revocation is invalid");
    }
    return revocation;
  }
}
