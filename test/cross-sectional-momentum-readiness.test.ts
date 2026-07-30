import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareCrossSectionalMomentumReadinessAssessment,
  REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES,
  type CrossSectionalMomentumReadinessEvidence,
  type CrossSectionalMomentumReadinessInput,
} from "../src/research/crossSectionalMomentumReadiness.ts";
import {
  prepareCrossSectionalMomentumReadinessPersistence,
} from "../src/storage/crossSectionalMomentumReadiness.ts";

const ASSESSED_AT_MS = 10_000;
const EVALUATION_SHA256 = "a".repeat(64);
const CALIBRATION_SHA256 = "b".repeat(64);
const STRESS_SHA256 = "c".repeat(64);
const REPORT_SHA256 = "d".repeat(64);

function digestForGate(
  gateId: CrossSectionalMomentumReadinessEvidence["gateId"],
): string {
  if (gateId === "complete-after-cost-evaluation") {
    return EVALUATION_SHA256;
  }
  if (gateId === "live-like-execution-calibration") {
    return CALIBRATION_SHA256;
  }
  if (gateId === "capacity-path-stress") return STRESS_SHA256;
  if (gateId === "canonical-research-report") return REPORT_SHA256;
  return gateId.length.toString(16).padStart(64, "0");
}

function evidence(
  gateId: CrossSectionalMomentumReadinessEvidence["gateId"],
  overrides: Partial<CrossSectionalMomentumReadinessEvidence> = {},
): CrossSectionalMomentumReadinessEvidence {
  return {
    gateId,
    evidenceClass: "authoritative",
    completeness: "complete",
    observedAtMs: 7_000,
    availableAtMs: 8_000,
    validUntilMs: 11_000,
    artifactSha256s: [digestForGate(gateId)],
    ...overrides,
  };
}

function completeEvidence(): readonly CrossSectionalMomentumReadinessEvidence[] {
  return REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES.map(
    (gate) => evidence(gate.id),
  );
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE cross_sectional_momentum_execution_calibrations (
      calibration_sha256 TEXT PRIMARY KEY,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE cross_sectional_momentum_execution_stress_manifests (
      manifest_sha256 TEXT PRIMARY KEY,
      calibration_sha256 TEXT NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE research_reports (
      report_sha256 TEXT PRIMARY KEY,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE research_report_commits (
      report_sha256 TEXT PRIMARY KEY,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE cross_sectional_momentum_complete_evaluations (
      evaluation_sha256 TEXT PRIMARY KEY,
      execution_stress_manifest_sha256 TEXT NOT NULL,
      report_sha256 TEXT NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0033_cross_sectional_momentum_readiness.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}

async function statements(input: CrossSectionalMomentumReadinessInput) {
  const assessment =
    await prepareCrossSectionalMomentumReadinessAssessment(input);
  const prepared =
    await prepareCrossSectionalMomentumReadinessPersistence({
      input,
      assessment,
      persistedAtMs: 10_001,
    });
  return { assessment, prepared };
}

function execute(
  db: DatabaseSync,
  prepared: Awaited<ReturnType<
    typeof prepareCrossSectionalMomentumReadinessPersistence
  >>,
): void {
  for (const statement of prepared) {
    db.prepare(statement.sql).run(...statement.params);
  }
}

function insertCommittedEvidence(db: DatabaseSync): void {
  db.prepare(
    "INSERT INTO cross_sectional_momentum_execution_calibrations VALUES (?, ?)",
  ).run(CALIBRATION_SHA256, 9_000);
  db.prepare(
    "INSERT INTO cross_sectional_momentum_execution_stress_manifests VALUES (?, ?, ?)",
  ).run(STRESS_SHA256, CALIBRATION_SHA256, 9_000);
  db.prepare("INSERT INTO research_reports VALUES (?, ?)").run(
    REPORT_SHA256,
    9_000,
  );
  db.prepare("INSERT INTO research_report_commits VALUES (?, ?)").run(
    REPORT_SHA256,
    9_000,
  );
  db.prepare(
    "INSERT INTO cross_sectional_momentum_complete_evaluations VALUES (?, ?, ?, ?)",
  ).run(EVALUATION_SHA256, STRESS_SHA256, REPORT_SHA256, 9_000);
}

test("fails closed with every fixed gate visible", async () => {
  const assessment = await prepareCrossSectionalMomentumReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [],
  });
  assert.equal(
    assessment.gates.length,
    REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES.length,
  );
  assert.ok(assessment.gates.every((gate) => gate.status === "missing"));
  assert.equal(assessment.researchStatus, "blocked");
  assert.equal(assessment.promotionStatus, "blocked");
  assert.equal(assessment.candidateStatus, "research-only-unselected");
  assert.equal(assessment.runtimeScopeChanged, false);
  assert.equal(assessment.selectionAuthority, "none");
  assert.equal(assessment.activationAuthority, "none");
  assert.equal(assessment.executionAuthority, "none");
});

test("rejects synthetic, partial, stale and noncanonical evidence", async () => {
  const assessment = await prepareCrossSectionalMomentumReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [
      evidence("authoritative-historical-hourly-candles", {
        evidenceClass: "synthetic",
      }),
      evidence("walk-forward-sensitivity-final-holdout", {
        completeness: "partial",
      }),
      evidence("live-like-execution-calibration", {
        validUntilMs: ASSESSED_AT_MS - 1,
      }),
    ],
  });
  assert.equal(assessment.gates[0]?.status, "non-authoritative");
  assert.equal(assessment.gates[2]?.status, "partial");
  assert.equal(assessment.gates[4]?.status, "stale");
  await assert.rejects(
    prepareCrossSectionalMomentumReadinessAssessment({
      assessedAtMs: ASSESSED_AT_MS,
      evidence: [
        evidence("capacity-path-stress", {
          artifactSha256s: ["f".repeat(64), "e".repeat(64)],
        }),
      ],
    }),
    /evidence is invalid/u,
  );
});

test("reports complete evidence for review without granting authority", async () => {
  const evidenceInput = completeEvidence();
  const first = await prepareCrossSectionalMomentumReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: evidenceInput,
  });
  const second = await prepareCrossSectionalMomentumReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [...evidenceInput].reverse(),
  });
  assert.equal(first.researchStatus, "evidence-complete-for-review");
  assert.equal(first.promotionStatus, "external-review-required");
  assert.equal(first.assessmentSha256, second.assessmentSha256);
  assert.equal(first.evidenceInputSha256, second.evidenceInputSha256);
  assert.equal("selectedStrategyVersion" in first, false);
  assert.equal("promotionApproved" in first, false);
});

test("persists exact committed evidence and rejects rebinding", async () => {
  const db = database();
  insertCommittedEvidence(db);
  const { assessment, prepared } = await statements({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: completeEvidence(),
  });
  execute(db, prepared);
  execute(db, prepared);
  assert.equal(
    (
      db.prepare("PRAGMA integrity_check").get() as {
        readonly integrity_check: string;
      }
    ).integrity_check,
    "ok",
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const binding = db.prepare(
    `SELECT complete_evaluation_sha256, execution_calibration_sha256,
            execution_stress_manifest_sha256, report_sha256
     FROM cross_sectional_momentum_readiness_bindings
     WHERE assessment_sha256 = ?`,
  ).get(assessment.assessmentSha256) as Record<string, unknown>;
  assert.equal(binding.complete_evaluation_sha256, EVALUATION_SHA256);
  assert.equal(binding.execution_calibration_sha256, CALIBRATION_SHA256);
  assert.equal(binding.execution_stress_manifest_sha256, STRESS_SHA256);
  assert.equal(binding.report_sha256, REPORT_SHA256);
  assert.throws(
    () => db.prepare(
      "UPDATE cross_sectional_momentum_readiness_bindings SET report_sha256 = ?",
    ).run("e".repeat(64)),
    /immutable/u,
  );

  const missingDb = database();
  assert.throws(
    () => execute(missingDb, prepared),
    /binding is invalid/u,
  );

  const inconsistentDb = database();
  insertCommittedEvidence(inconsistentDb);
  inconsistentDb.prepare(
    "UPDATE cross_sectional_momentum_complete_evaluations SET report_sha256 = ?",
  ).run("e".repeat(64));
  assert.throws(
    () => execute(inconsistentDb, prepared),
    /binding is invalid/u,
  );
});
