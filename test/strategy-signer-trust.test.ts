import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareReviewedStrategySignerTrustAnchor,
  prepareStrategySignerTrustRevocation,
  resolveReviewedStrategySignerKey,
  verifyReviewedStrategySignerTrustAnchor,
  type ReviewedStrategySignerTrustAnchor,
  type StrategySignerRole,
} from "../src/security/strategySignerTrust.ts";
import {
  prepareStrategySignerTrustAnchorPersistence,
  prepareStrategySignerTrustRevocationPersistence,
  type StrategySignerTrustPersistenceStatement,
} from "../src/storage/strategySignerTrust.ts";

const KEY_SHA256 = "a".repeat(64);
const REVIEW_SHA256 = "b".repeat(64);

async function anchor(
  role: StrategySignerRole = "strategy-configuration-signer",
  keyId = "strategy-signer-key-v1",
  keySha256 = KEY_SHA256,
  predecessorTrustAnchorSha256: string | null = null,
): Promise<ReviewedStrategySignerTrustAnchor> {
  return prepareReviewedStrategySignerTrustAnchor({
    trustAnchorId: `${keyId}-trust`,
    role,
    keyId,
    verificationKeySha256: keySha256,
    reviewEvidenceSha256: REVIEW_SHA256,
    reviewedAtMs: 100,
    validFromMs: 200,
    validUntilMs: 1_000,
    predecessorTrustAnchorSha256,
  });
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE hourly_trend_breakout_signed_configurations (
      signer_key_id TEXT,
      verification_key_sha256 TEXT,
      issued_at_ms INTEGER,
      persisted_at_ms INTEGER
    );
    CREATE TABLE hourly_trend_breakout_strategy_authorisations (
      authoriser_key_id TEXT,
      verification_key_sha256 TEXT,
      reviewed_at_ms INTEGER,
      persisted_at_ms INTEGER
    );
  `);
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0026_strategy_signer_trust.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}

function execute(
  db: DatabaseSync,
  statement: StrategySignerTrustPersistenceStatement,
): void {
  db.prepare(statement.sql).run(...statement.params);
}

test("resolves one exact active role-scoped trust anchor", async () => {
  const reviewed = await anchor();
  const key = await resolveReviewedStrategySignerKey({
    anchor: reviewed,
    revocation: null,
    expectedRole: "strategy-configuration-signer",
    artifactTimeMs: 300,
    checkedAtMs: 400,
  });
  assert.deepEqual(key, {
    keyId: reviewed.keyId,
    verificationKeySha256: reviewed.verificationKeySha256,
  });
  assert.equal(reviewed.executionAuthority, "none");
});

test("rejects changed, wrong-role, premature and expired trust", async () => {
  const reviewed = await anchor();
  await assert.rejects(
    verifyReviewedStrategySignerTrustAnchor({
      ...reviewed,
      executionAuthority: "paper" as never,
    }),
    /identity is invalid/u,
  );
  await assert.rejects(
    resolveReviewedStrategySignerKey({
      anchor: reviewed,
      revocation: null,
      expectedRole: "external-strategy-authoriser",
      artifactTimeMs: 300,
      checkedAtMs: 400,
    }),
    /not active/u,
  );
  await assert.rejects(
    resolveReviewedStrategySignerKey({
      anchor: reviewed,
      revocation: null,
      expectedRole: "strategy-configuration-signer",
      artifactTimeMs: 199,
      checkedAtMs: 400,
    }),
    /not active/u,
  );
  await assert.rejects(
    resolveReviewedStrategySignerKey({
      anchor: reviewed,
      revocation: null,
      expectedRole: "strategy-configuration-signer",
      artifactTimeMs: 300,
      checkedAtMs: 1_000,
    }),
    /not active/u,
  );
});

test("applies known effective revocation without backdating future state", async () => {
  const reviewed = await anchor();
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "strategy-signer-revocation-v1",
      trustAnchorSha256: reviewed.trustAnchorSha256,
      reason: "planned-rotation",
      effectiveAtMs: 600,
      reviewedAtMs: 500,
      reviewEvidenceSha256: "c".repeat(64),
    },
    reviewed,
  );
  await resolveReviewedStrategySignerKey({
    anchor: reviewed,
    revocation,
    expectedRole: "strategy-configuration-signer",
    artifactTimeMs: 300,
    checkedAtMs: 599,
  });
  await assert.rejects(
    resolveReviewedStrategySignerKey({
      anchor: reviewed,
      revocation,
      expectedRole: "strategy-configuration-signer",
      artifactTimeMs: 300,
      checkedAtMs: 600,
    }),
    /is revoked/u,
  );
});

test("persists exact anchors and revocations immutably", async () => {
  const db = database();
  const reviewed = await anchor();
  const anchorStatement =
    await prepareStrategySignerTrustAnchorPersistence(reviewed, 250);
  execute(db, anchorStatement);
  execute(db, anchorStatement);
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "strategy-signer-revocation-v1",
      trustAnchorSha256: reviewed.trustAnchorSha256,
      reason: "suspected-compromise",
      effectiveAtMs: 300,
      reviewedAtMs: 350,
      reviewEvidenceSha256: "d".repeat(64),
    },
    reviewed,
  );
  const revocationStatement =
    await prepareStrategySignerTrustRevocationPersistence(
      revocation,
      reviewed,
      400,
    );
  execute(db, revocationStatement);
  execute(db, revocationStatement);
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM strategy_signer_trust_anchors")
      .get()!.count,
    1,
  );
  assert.equal(
    db.prepare(
      "SELECT execution_authority FROM strategy_signer_trust_revocations",
    ).get()!.execution_authority,
    "none",
  );
  assert.throws(
    () => db.prepare(
      "UPDATE strategy_signer_trust_anchors SET valid_until_ms = 999",
    ).run(),
    /immutable/u,
  );
  assert.throws(
    () => db.prepare(
      "DELETE FROM strategy_signer_trust_revocations",
    ).run(),
    /immutable/u,
  );
});

test("rejects invalid lineage, identity reuse and key aliases", async () => {
  const db = database();
  const first = await anchor();
  execute(
    db,
    await prepareStrategySignerTrustAnchorPersistence(first, 250),
  );
  const missingPredecessor = await anchor(
    "strategy-configuration-signer",
    "strategy-signer-key-v2",
    "e".repeat(64),
    "f".repeat(64),
  );
  const missingPredecessorStatement =
    await prepareStrategySignerTrustAnchorPersistence(
      missingPredecessor,
      250,
    );
  assert.throws(
    () => execute(db, missingPredecessorStatement),
    /predecessor is invalid/u,
  );
  const reusedId = await prepareReviewedStrategySignerTrustAnchor({
    trustAnchorId: first.trustAnchorId,
    role: first.role,
    keyId: "strategy-signer-key-v3",
    verificationKeySha256: "1".repeat(64),
    reviewEvidenceSha256: first.reviewEvidenceSha256,
    reviewedAtMs: first.reviewedAtMs,
    validFromMs: first.validFromMs,
    validUntilMs: first.validUntilMs,
    predecessorTrustAnchorSha256: null,
  });
  const reusedIdStatement =
    await prepareStrategySignerTrustAnchorPersistence(reusedId, 250);
  assert.throws(
    () => execute(db, reusedIdStatement),
    /identity conflict/u,
  );
  const alias = await anchor(
    "external-strategy-authoriser",
    "external-authoriser-key-v1",
    first.verificationKeySha256,
  );
  const aliasStatement =
    await prepareStrategySignerTrustAnchorPersistence(alias, 250);
  assert.throws(
    () => execute(db, aliasStatement),
    /key alias is invalid/u,
  );
  const firstRevocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "strategy-signer-revocation-v1",
      trustAnchorSha256: first.trustAnchorSha256,
      reason: "key-retired",
      effectiveAtMs: 500,
      reviewedAtMs: 450,
      reviewEvidenceSha256: "2".repeat(64),
    },
    first,
  );
  execute(
    db,
    await prepareStrategySignerTrustRevocationPersistence(
      firstRevocation,
      first,
      550,
    ),
  );
  const reusedRevocationId =
    await prepareStrategySignerTrustRevocation(
      {
        revocationId: firstRevocation.revocationId,
        trustAnchorSha256: first.trustAnchorSha256,
        reason: "suspected-compromise",
        effectiveAtMs: 400,
        reviewedAtMs: 450,
        reviewEvidenceSha256: "3".repeat(64),
      },
      first,
    );
  const reusedRevocationStatement =
    await prepareStrategySignerTrustRevocationPersistence(
      reusedRevocationId,
      first,
      550,
    );
  assert.throws(
    () => execute(db, reusedRevocationStatement),
    /revocation identity conflict/u,
  );
});
