import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareHourlyTrendBreakoutReadinessAssessment,
  REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES,
  type HourlyTrendBreakoutReadinessEvidence,
  type HourlyTrendBreakoutReadinessInput,
} from "../src/research/hourlyTrendBreakoutReadiness.ts";
import {
  prepareHourlyTrendBreakoutReadinessPersistence,
} from "../src/storage/hourlyTrendBreakoutReadiness.ts";

const ASSESSED_AT_MS = 10_000;
const EVALUATION_SHA256 = "a".repeat(64);
const CALIBRATION_SHA256 = "b".repeat(64);
const STRESS_SHA256 = "c".repeat(64);

function digestForGate(
  gateId: HourlyTrendBreakoutReadinessEvidence["gateId"],
): string {
  if (gateId === "complete-after-cost-evaluation") {
    return EVALUATION_SHA256;
  }
  if (gateId === "live-like-execution-calibration") {
    return CALIBRATION_SHA256;
  }
  if (gateId === "capacity-path-stress") return STRESS_SHA256;
  return gateId.length.toString(16).padStart(64, "0");
}

function evidence(
  gateId: HourlyTrendBreakoutReadinessEvidence["gateId"],
): HourlyTrendBreakoutReadinessEvidence {
  return {
    gateId,
    evidenceClass: "authoritative",
    completeness: "complete",
    observedAtMs: 7_000,
    availableAtMs: 8_000,
    validUntilMs: 11_000,
    artifactSha256s: [digestForGate(gateId)],
  };
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE hourly_trend_breakout_complete_evaluations (
      evaluation_sha256 TEXT PRIMARY KEY,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE hourly_trend_breakout_execution_calibrations (
      calibration_sha256 TEXT PRIMARY KEY,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE hourly_trend_breakout_execution_stress_manifests (
      manifest_sha256 TEXT PRIMARY KEY,
      calibration_sha256 TEXT NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE hourly_trend_breakout_complete_evaluation_stress_bindings (
      evaluation_sha256 TEXT PRIMARY KEY,
      stress_manifest_sha256 TEXT NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0024_hourly_trend_breakout_readiness.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}

async function statements(input: HourlyTrendBreakoutReadinessInput) {
  const assessment =
    await prepareHourlyTrendBreakoutReadinessAssessment(input);
  const prepared =
    await prepareHourlyTrendBreakoutReadinessPersistence({
      input,
      assessment,
      persistedAtMs: 10_001,
    });
  return { assessment, prepared };
}

function execute(
  db: DatabaseSync,
  prepared: Awaited<ReturnType<
    typeof prepareHourlyTrendBreakoutReadinessPersistence
  >>,
): void {
  for (const statement of prepared) {
    db.prepare(statement.sql).run(...statement.params);
  }
}

test("persists blocked missing-evidence readiness immutably", async () => {
  const db = database();
  const { assessment, prepared } = await statements({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [],
  });
  execute(db, prepared);
  execute(db, prepared);
  assert.equal(
    (
      db.prepare(
        "SELECT COUNT(*) AS count FROM hourly_trend_breakout_readiness_gates",
      ).get() as { readonly count: number }
    ).count,
    REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.length,
  );
  const binding = db.prepare(
    `SELECT complete_evaluation_sha256, execution_calibration_sha256,
            execution_stress_manifest_sha256
     FROM hourly_trend_breakout_readiness_bindings
     WHERE assessment_sha256 = ?`,
  ).get(assessment.assessmentSha256) as Record<string, unknown>;
  assert.equal(binding.complete_evaluation_sha256, null);
  assert.equal(binding.execution_calibration_sha256, null);
  assert.equal(binding.execution_stress_manifest_sha256, null);
  assert.throws(
    () => db.prepare(
      "DELETE FROM hourly_trend_breakout_readiness_assessments",
    ).run(),
    /immutable/u,
  );
});

test("binds evidence-present research gates to exact committed identities", async () => {
  const db = database();
  db.prepare(
    "INSERT INTO hourly_trend_breakout_complete_evaluations VALUES (?, ?)",
  ).run(EVALUATION_SHA256, 9_000);
  db.prepare(
    "INSERT INTO hourly_trend_breakout_execution_calibrations VALUES (?, ?)",
  ).run(CALIBRATION_SHA256, 9_000);
  db.prepare(
    "INSERT INTO hourly_trend_breakout_execution_stress_manifests VALUES (?, ?, ?)",
  ).run(STRESS_SHA256, CALIBRATION_SHA256, 9_000);
  db.prepare(
    "INSERT INTO hourly_trend_breakout_complete_evaluation_stress_bindings VALUES (?, ?, ?)",
  ).run(EVALUATION_SHA256, STRESS_SHA256, 9_000);
  const { assessment, prepared } = await statements({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.map((gate) =>
      evidence(gate.id)
    ),
  });
  execute(db, prepared);
  const binding = db.prepare(
    `SELECT complete_evaluation_sha256, execution_calibration_sha256,
            execution_stress_manifest_sha256
     FROM hourly_trend_breakout_readiness_bindings
     WHERE assessment_sha256 = ?`,
  ).get(assessment.assessmentSha256) as Record<string, unknown>;
  assert.equal(binding.complete_evaluation_sha256, EVALUATION_SHA256);
  assert.equal(binding.execution_calibration_sha256, CALIBRATION_SHA256);
  assert.equal(binding.execution_stress_manifest_sha256, STRESS_SHA256);
});

test("database rejects uncommitted or inconsistent evidence identities", async () => {
  const db = database();
  const { prepared } = await statements({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.map((gate) =>
      evidence(gate.id)
    ),
  });
  assert.throws(
    () => execute(db, prepared),
    /Readiness evidence binding is invalid/u,
  );
});

test("database rejects incomplete gate sets and future evidence commits", async () => {
  const blocked = await statements({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [],
  });
  const incompleteDb = database();
  for (const statement of blocked.prepared.slice(0, -2)) {
    incompleteDb.prepare(statement.sql).run(...statement.params);
  }
  const blockedBinding = blocked.prepared.at(-1)!;
  assert.throws(
    () => incompleteDb.prepare(blockedBinding.sql).run(
      ...blockedBinding.params,
    ),
    /Readiness evidence binding is invalid/u,
  );

  const futureDb = database();
  futureDb.prepare(
    "INSERT INTO hourly_trend_breakout_complete_evaluations VALUES (?, ?)",
  ).run(EVALUATION_SHA256, 10_002);
  futureDb.prepare(
    "INSERT INTO hourly_trend_breakout_execution_calibrations VALUES (?, ?)",
  ).run(CALIBRATION_SHA256, 10_002);
  futureDb.prepare(
    "INSERT INTO hourly_trend_breakout_execution_stress_manifests VALUES (?, ?, ?)",
  ).run(STRESS_SHA256, CALIBRATION_SHA256, 10_002);
  futureDb.prepare(
    "INSERT INTO hourly_trend_breakout_complete_evaluation_stress_bindings VALUES (?, ?, ?)",
  ).run(EVALUATION_SHA256, STRESS_SHA256, 10_002);
  const complete = await statements({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.map((gate) =>
      evidence(gate.id)
    ),
  });
  assert.throws(
    () => execute(futureDb, complete.prepared),
    /Readiness evidence binding is invalid/u,
  );
});

test("rejects changed assessment identity and database conflicts", async () => {
  const input: HourlyTrendBreakoutReadinessInput = {
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [],
  };
  const { assessment, prepared } = await statements(input);
  await assert.rejects(
    prepareHourlyTrendBreakoutReadinessPersistence({
      input,
      assessment: {
        ...assessment,
        researchStatus: "evidence-complete-for-review",
      },
      persistedAtMs: 10_001,
    }),
    /not reproducible/u,
  );
  const db = database();
  execute(db, prepared);
  const changed = [...prepared[0]!.params];
  changed[11] = `${changed[11] as string} `;
  assert.throws(
    () => db.prepare(prepared[0]!.sql).run(...changed),
    /Readiness assessment conflict/u,
  );
});
