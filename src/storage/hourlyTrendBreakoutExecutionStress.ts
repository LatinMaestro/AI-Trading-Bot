import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
import {
  verifyHourlyTrendBreakoutExecutionStressManifest,
  type HourlyTrendBreakoutExecutionCalibration,
  type HourlyTrendBreakoutExecutionStressManifest,
} from "../research/hourlyTrendBreakoutExecutionStress.ts";
import type {
  HourlyTrendBreakoutBacktestPlan,
  HourlyTrendBreakoutResearchRun,
} from "../backtest/hourlyTrendBreakout.ts";

type D1BindValue = string | number | null;

export interface HourlyTrendBreakoutExecutionStressPersistenceInput {
  readonly plan: HourlyTrendBreakoutBacktestPlan;
  readonly run: HourlyTrendBreakoutResearchRun;
  readonly calibration: HourlyTrendBreakoutExecutionCalibration;
  readonly manifest: HourlyTrendBreakoutExecutionStressManifest;
  readonly persistedAtMs: number;
}

export interface HourlyTrendBreakoutExecutionStressStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

interface PersistedCalibrationRow {
  readonly calibration_sha256: string;
  readonly baseline_plan_sha256: string;
  readonly baseline_run_sha256: string;
  readonly calibrated_at_ms: number;
  readonly available_at_ms: number;
  readonly valid_until_ms: number;
  readonly source_count: number;
  readonly canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedStressManifestRow {
  readonly manifest_sha256: string;
  readonly baseline_plan_sha256: string;
  readonly baseline_run_sha256: string;
  readonly baseline_result_sha256: string;
  readonly calibration_sha256: string;
  readonly evaluated_at_ms: number;
  readonly result_count: number;
  readonly canonical_json: string;
  readonly persisted_at_ms: number;
}

export const INSERT_EXECUTION_CALIBRATION_SQL =
  `INSERT INTO hourly_trend_breakout_execution_calibrations
    (calibration_sha256, schema_version, strategy_version,
     baseline_plan_sha256, baseline_run_sha256, calibrated_at_ms,
     available_at_ms, valid_until_ms, source_count, canonical_json,
     persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(calibration_sha256) DO NOTHING`;

export const INSERT_EXECUTION_STRESS_MANIFEST_SQL =
  `INSERT INTO hourly_trend_breakout_execution_stress_manifests
    (manifest_sha256, schema_version, strategy_version, candidate_status,
     baseline_plan_sha256, baseline_run_sha256, baseline_result_sha256,
     calibration_sha256, evaluated_at_ms, result_count, canonical_json,
     persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(manifest_sha256) DO NOTHING`;

const SELECT_EXECUTION_CALIBRATION_SQL =
  `SELECT calibration_sha256, baseline_plan_sha256, baseline_run_sha256,
          calibrated_at_ms, available_at_ms, valid_until_ms, source_count,
          canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_execution_calibrations
   WHERE calibration_sha256 = ?`;

const SELECT_EXECUTION_STRESS_MANIFEST_SQL =
  `SELECT manifest_sha256, baseline_plan_sha256, baseline_run_sha256,
          baseline_result_sha256, calibration_sha256, evaluated_at_ms,
          result_count, canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_execution_stress_manifests
   WHERE manifest_sha256 = ?`;

export async function prepareHourlyTrendBreakoutExecutionStressPersistence(
  input: HourlyTrendBreakoutExecutionStressPersistenceInput,
): Promise<readonly HourlyTrendBreakoutExecutionStressStatement[]> {
  await verifyHourlyTrendBreakoutExecutionStressManifest(
    input.plan,
    input.run,
    input.calibration,
    input.manifest,
  );
  if (
    !Number.isSafeInteger(input.persistedAtMs) ||
    input.persistedAtMs < input.manifest.evaluatedAtMs ||
    input.persistedAtMs < input.calibration.availableAtMs
  ) {
    throw new Error("execution stress persistence chronology is invalid");
  }
  return [
    {
      sql: INSERT_EXECUTION_CALIBRATION_SQL,
      params: [
        input.calibration.calibrationSha256,
        input.calibration.schemaVersion,
        input.calibration.strategyVersion,
        input.calibration.baselinePlanSha256,
        input.calibration.baselineRunSha256,
        input.calibration.calibratedAtMs,
        input.calibration.availableAtMs,
        input.calibration.validUntilMs,
        input.calibration.sourceSha256s.length,
        canonicalIntelligenceJson(input.calibration),
        input.persistedAtMs,
      ],
    },
    {
      sql: INSERT_EXECUTION_STRESS_MANIFEST_SQL,
      params: [
        input.manifest.manifestSha256,
        input.manifest.schemaVersion,
        input.manifest.strategyVersion,
        input.manifest.candidateStatus,
        input.manifest.baselinePlanSha256,
        input.manifest.baselineRunSha256,
        input.manifest.baselineResultSha256,
        input.manifest.calibrationSha256,
        input.manifest.evaluatedAtMs,
        input.manifest.results.length,
        canonicalIntelligenceJson(input.manifest),
        input.persistedAtMs,
      ],
    },
  ];
}

function exactCalibrationRow(
  row: PersistedCalibrationRow,
  input: HourlyTrendBreakoutExecutionStressPersistenceInput,
): boolean {
  return (
    row.calibration_sha256 === input.calibration.calibrationSha256 &&
    row.baseline_plan_sha256 === input.plan.planSha256 &&
    row.baseline_run_sha256 === input.run.runSha256 &&
    row.calibrated_at_ms === input.calibration.calibratedAtMs &&
    row.available_at_ms === input.calibration.availableAtMs &&
    row.valid_until_ms === input.calibration.validUntilMs &&
    row.source_count === input.calibration.sourceSha256s.length &&
    row.canonical_json === canonicalIntelligenceJson(input.calibration) &&
    row.persisted_at_ms >= input.calibration.availableAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

function exactManifestRow(
  row: PersistedStressManifestRow,
  input: HourlyTrendBreakoutExecutionStressPersistenceInput,
): boolean {
  return (
    row.manifest_sha256 === input.manifest.manifestSha256 &&
    row.baseline_plan_sha256 === input.plan.planSha256 &&
    row.baseline_run_sha256 === input.run.runSha256 &&
    row.baseline_result_sha256 === input.run.resultSha256 &&
    row.calibration_sha256 === input.calibration.calibrationSha256 &&
    row.evaluated_at_ms === input.manifest.evaluatedAtMs &&
    row.result_count === input.manifest.results.length &&
    row.canonical_json === canonicalIntelligenceJson(input.manifest) &&
    row.persisted_at_ms >= input.manifest.evaluatedAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

export class HourlyTrendBreakoutExecutionStressRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: HourlyTrendBreakoutExecutionStressPersistenceInput,
  ): Promise<HourlyTrendBreakoutExecutionStressManifest> {
    const statements =
      await prepareHourlyTrendBreakoutExecutionStressPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params),
      ),
    );
    const [calibration, manifest] = await Promise.all([
      this.db
        .prepare(SELECT_EXECUTION_CALIBRATION_SQL)
        .bind(input.calibration.calibrationSha256)
        .first<PersistedCalibrationRow>(),
      this.db
        .prepare(SELECT_EXECUTION_STRESS_MANIFEST_SQL)
        .bind(input.manifest.manifestSha256)
        .first<PersistedStressManifestRow>(),
    ]);
    if (
      calibration === null ||
      manifest === null ||
      !exactCalibrationRow(calibration, input) ||
      !exactManifestRow(manifest, input)
    ) {
      throw new Error("persisted execution stress verification failed");
    }
    return input.manifest;
  }
}
