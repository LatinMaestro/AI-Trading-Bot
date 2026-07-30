import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
import {
  prepareCrossSectionalMomentumCompleteEvaluation,
  type CrossSectionalMomentumCompleteEvaluation,
  type CrossSectionalMomentumCompleteEvaluationInput,
} from "../research/crossSectionalMomentumCompleteEvaluation.ts";
import type {
  CrossSectionalMomentumExecutionStressResult,
} from "../research/crossSectionalMomentumExecutionStress.ts";
import { sha256Hex } from "../utils/crypto.ts";

type D1BindValue = string | number | null;

const MAXIMUM_CHUNK_BYTES = 524_288;
const MAXIMUM_CHUNKS = 90;
const encoder = new TextEncoder();

export interface CrossSectionalMomentumCompleteEvaluationPersistenceInput {
  readonly input: CrossSectionalMomentumCompleteEvaluationInput;
  readonly evaluation: CrossSectionalMomentumCompleteEvaluation;
  readonly persistedAtMs: number;
}

export interface CrossSectionalMomentumCompleteEvaluationStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

interface ReportChunk {
  readonly index: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly text: string;
}

interface StoredReportRow {
  readonly report_sha256: string;
  readonly canonical_byte_length: number;
  readonly chunk_count: number;
  readonly persisted_at_ms: number;
}

interface StoredReportChunkRow {
  readonly chunk_index: number;
  readonly chunk_sha256: string;
  readonly chunk_byte_length: number;
  readonly chunk_text: string;
}

interface StoredStressRow {
  readonly manifest_sha256: string;
  readonly calibration_sha256: string;
  readonly result_count: number;
  readonly persisted_at_ms: number;
}

interface StoredStressResultRow {
  readonly result_index: number;
  readonly capital_aud: number;
  readonly scenario_id: string;
  readonly config_sha256: string;
  readonly steps_sha256: string;
  readonly result_sha256: string;
}

interface StoredEvaluationRow {
  readonly evaluation_sha256: string;
  readonly walk_forward_manifest_sha256: string;
  readonly sensitivity_manifest_sha256: string;
  readonly final_holdout_plan_sha256: string;
  readonly final_holdout_run_sha256: string;
  readonly final_holdout_result_sha256: string;
  readonly execution_stress_manifest_sha256: string;
  readonly report_sha256: string;
  readonly execution_capacity_summary_json: string;
  readonly persisted_at_ms: number;
}

export const INSERT_CROSS_SECTIONAL_EXECUTION_CALIBRATION_SQL =
  `INSERT INTO cross_sectional_momentum_execution_calibrations
    (calibration_sha256, schema_version, strategy_version,
     baseline_plan_sha256, baseline_run_sha256, calibrated_at_ms,
     available_at_ms, valid_until_ms, source_count,
     calibration_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(calibration_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_EXECUTION_STRESS_SQL =
  `INSERT INTO cross_sectional_momentum_execution_stress_manifests
    (manifest_sha256, schema_version, strategy_version,
     baseline_plan_sha256, baseline_run_sha256, baseline_result_sha256,
     calibration_sha256, evaluated_at_ms, result_count,
     manifest_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(manifest_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_EXECUTION_STRESS_RESULT_SQL =
  `INSERT INTO cross_sectional_momentum_execution_stress_results
    (manifest_sha256, result_index, capital_aud, scenario_id,
     config_sha256, steps_sha256, result_sha256, final_equity_aud,
     total_return_pct, maximum_drawdown_pct, turnover_multiple,
     total_cost_aud, requested_notional_aud, filled_notional_aud,
     missed_fill_notional_aud, missed_fill_ratio,
     capacity_constrained_execution_count)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(manifest_sha256, result_index) DO NOTHING`;

export const COMMIT_CROSS_SECTIONAL_EXECUTION_STRESS_SQL =
  `INSERT INTO cross_sectional_momentum_execution_stress_commits
    (manifest_sha256, result_count, committed_at_ms)
   VALUES (?, ?, ?)
   ON CONFLICT(manifest_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_RESEARCH_REPORT_SQL =
  `INSERT INTO research_reports
    (report_sha256, schema_version, report_id, generated_at,
     evaluation_split, period_start_at_ms, period_end_at_ms,
     canonical_byte_length, chunk_count, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(report_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_RESEARCH_REPORT_CHUNK_SQL =
  `INSERT INTO research_report_chunks
    (report_sha256, chunk_index, chunk_sha256, chunk_byte_length, chunk_text)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(report_sha256, chunk_index) DO NOTHING`;

export const COMMIT_CROSS_SECTIONAL_RESEARCH_REPORT_SQL =
  `INSERT INTO research_report_commits
    (report_sha256, chunk_count, canonical_byte_length, persisted_at_ms)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(report_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_COMPLETE_EVALUATION_SQL =
  `INSERT INTO cross_sectional_momentum_complete_evaluations
    (evaluation_sha256, schema_version, strategy_version,
     walk_forward_manifest_sha256, sensitivity_manifest_sha256,
     final_holdout_plan_sha256, final_holdout_run_sha256,
     final_holdout_result_sha256, execution_stress_manifest_sha256,
     benchmark_evidence_sha256, objective_progress_evidence_sha256,
     scenario_risk_evidence_sha256, universe_evidence_sha256,
     execution_capacity_evidence_sha256,
     execution_capacity_summary_json, report_sha256, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(evaluation_sha256) DO NOTHING`;

const SELECT_REPORT_SQL =
  `SELECT report_sha256, canonical_byte_length, chunk_count,
          persisted_at_ms
   FROM research_reports
   WHERE report_sha256 = ?`;

const SELECT_REPORT_CHUNKS_SQL =
  `SELECT chunk_index, chunk_sha256, chunk_byte_length, chunk_text
   FROM research_report_chunks
   WHERE report_sha256 = ?
   ORDER BY chunk_index`;

const SELECT_STRESS_SQL =
  `SELECT manifest_sha256, calibration_sha256, result_count,
          persisted_at_ms
   FROM cross_sectional_momentum_execution_stress_manifests
   WHERE manifest_sha256 = ?`;

const SELECT_STRESS_RESULTS_SQL =
  `SELECT result_index, capital_aud, scenario_id, config_sha256,
          steps_sha256, result_sha256
   FROM cross_sectional_momentum_execution_stress_results
   WHERE manifest_sha256 = ?
   ORDER BY result_index`;

const SELECT_EVALUATION_SQL =
  `SELECT evaluation_sha256, walk_forward_manifest_sha256,
          sensitivity_manifest_sha256, final_holdout_plan_sha256,
          final_holdout_run_sha256, final_holdout_result_sha256,
          execution_stress_manifest_sha256, report_sha256,
          execution_capacity_summary_json, persisted_at_ms
   FROM cross_sectional_momentum_complete_evaluations
   WHERE evaluation_sha256 = ?`;

function splitUtf8(value: string): readonly string[] {
  const bytes = encoder.encode(value);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.byteLength) {
    let end = Math.min(start + MAXIMUM_CHUNK_BYTES, bytes.byteLength);
    while (
      end < bytes.byteLength &&
      (bytes[end]! & 0xc0) === 0x80
    ) {
      end -= 1;
    }
    if (end <= start) {
      throw new Error(
        "cross-sectional report cannot split at a UTF-8 boundary",
      );
    }
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  if (chunks.length === 0 || chunks.length > MAXIMUM_CHUNKS) {
    throw new Error(
      `cross-sectional report requires 1-${MAXIMUM_CHUNKS} chunks`,
    );
  }
  return chunks;
}

async function prepareChunks(value: string): Promise<readonly ReportChunk[]> {
  return Promise.all(
    splitUtf8(value).map(async (text, index) => ({
      index,
      sha256: await sha256Hex(text),
      byteLength: encoder.encode(text).byteLength,
      text,
    })),
  );
}

function exactEvaluation(
  expected: CrossSectionalMomentumCompleteEvaluation,
  supplied: CrossSectionalMomentumCompleteEvaluation,
): boolean {
  return (
    expected.evaluationSha256 === supplied.evaluationSha256 &&
    canonicalIntelligenceJson(expected) ===
      canonicalIntelligenceJson(supplied)
  );
}

function stressResultParams(
  manifestSha256: string,
  result: CrossSectionalMomentumExecutionStressResult,
  index: number,
): readonly D1BindValue[] {
  return [
    manifestSha256,
    index,
    result.capitalAud,
    result.scenarioId,
    result.configSha256,
    result.stepsSha256,
    result.resultSha256,
    result.finalEquityAud,
    result.totalReturnPct,
    result.maximumDrawdownPct,
    result.turnoverMultiple,
    result.totalCostAud,
    result.requestedNotionalAud,
    result.filledNotionalAud,
    result.missedFillNotionalAud,
    result.missedFillRatio,
    result.capacityConstrainedExecutionCount,
  ];
}

export async function prepareCrossSectionalMomentumCompleteEvaluationPersistence(
  persistence: CrossSectionalMomentumCompleteEvaluationPersistenceInput,
): Promise<
  readonly CrossSectionalMomentumCompleteEvaluationStatement[]
> {
  const reproduced =
    await prepareCrossSectionalMomentumCompleteEvaluation(
      persistence.input,
    );
  if (!exactEvaluation(reproduced, persistence.evaluation)) {
    throw new Error(
      "cross-sectional complete evaluation is not reproducible",
    );
  }
  const generatedAtMs = Date.parse(reproduced.report.generatedAt);
  if (
    !Number.isSafeInteger(persistence.persistedAtMs) ||
    !Number.isFinite(generatedAtMs) ||
    persistence.persistedAtMs < generatedAtMs ||
    persistence.persistedAtMs <
      persistence.input.executionStressManifest.evaluatedAtMs
  ) {
    throw new Error(
      "cross-sectional complete evaluation persistence chronology is invalid",
    );
  }

  const calibration = persistence.input.executionCalibration;
  const stress = persistence.input.executionStressManifest;
  const report = reproduced.report;
  const reportJson = canonicalIntelligenceJson(report);
  const reportByteLength = encoder.encode(reportJson).byteLength;
  const chunks = await prepareChunks(reportJson);

  return [
    {
      sql: INSERT_CROSS_SECTIONAL_EXECUTION_CALIBRATION_SQL,
      params: [
        calibration.calibrationSha256,
        calibration.schemaVersion,
        calibration.strategyVersion,
        calibration.baselinePlanSha256,
        calibration.baselineRunSha256,
        calibration.calibratedAtMs,
        calibration.availableAtMs,
        calibration.validUntilMs,
        calibration.sourceSha256s.length,
        canonicalIntelligenceJson(calibration),
        persistence.persistedAtMs,
      ],
    },
    {
      sql: INSERT_CROSS_SECTIONAL_EXECUTION_STRESS_SQL,
      params: [
        stress.manifestSha256,
        stress.schemaVersion,
        stress.strategyVersion,
        stress.baselinePlanSha256,
        stress.baselineRunSha256,
        stress.baselineResultSha256,
        stress.calibrationSha256,
        stress.evaluatedAtMs,
        stress.results.length,
        canonicalIntelligenceJson(stress),
        persistence.persistedAtMs,
      ],
    },
    ...stress.results.map((result, index) => ({
      sql: INSERT_CROSS_SECTIONAL_EXECUTION_STRESS_RESULT_SQL,
      params: stressResultParams(stress.manifestSha256, result, index),
    })),
    {
      sql: COMMIT_CROSS_SECTIONAL_EXECUTION_STRESS_SQL,
      params: [
        stress.manifestSha256,
        stress.results.length,
        persistence.persistedAtMs,
      ],
    },
    {
      sql: INSERT_CROSS_SECTIONAL_RESEARCH_REPORT_SQL,
      params: [
        report.reportSha256,
        report.schemaVersion,
        report.reportId,
        report.generatedAt,
        report.evaluationSplit,
        report.periodStartMs,
        report.periodEndMs,
        reportByteLength,
        chunks.length,
        persistence.persistedAtMs,
      ],
    },
    ...chunks.map((chunk) => ({
      sql: INSERT_CROSS_SECTIONAL_RESEARCH_REPORT_CHUNK_SQL,
      params: [
        report.reportSha256,
        chunk.index,
        chunk.sha256,
        chunk.byteLength,
        chunk.text,
      ],
    })),
    {
      sql: COMMIT_CROSS_SECTIONAL_RESEARCH_REPORT_SQL,
      params: [
        report.reportSha256,
        chunks.length,
        reportByteLength,
        persistence.persistedAtMs,
      ],
    },
    {
      sql: INSERT_CROSS_SECTIONAL_COMPLETE_EVALUATION_SQL,
      params: [
        reproduced.evaluationSha256,
        reproduced.schemaVersion,
        reproduced.strategyVersion,
        reproduced.walkForwardManifestSha256,
        reproduced.sensitivityManifestSha256,
        reproduced.finalHoldoutPlanSha256,
        reproduced.finalHoldoutRunSha256,
        reproduced.finalHoldoutResultSha256,
        reproduced.executionStressManifestSha256,
        reproduced.benchmarkEvidenceSha256,
        reproduced.objectiveProgressEvidenceSha256,
        reproduced.scenarioRiskEvidenceSha256,
        reproduced.universeEvidenceSha256,
        reproduced.executionCapacityEvidenceSha256,
        canonicalIntelligenceJson(
          reproduced.executionCapacitySummary,
        ),
        report.reportSha256,
        persistence.persistedAtMs,
      ],
    },
  ];
}

async function chunksMatch(
  rows: readonly StoredReportChunkRow[],
  expected: readonly ReportChunk[],
): Promise<boolean> {
  if (rows.length !== expected.length) return false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const chunk = expected[index]!;
    if (
      row.chunk_index !== chunk.index ||
      row.chunk_sha256 !== chunk.sha256 ||
      row.chunk_byte_length !== chunk.byteLength ||
      row.chunk_text !== chunk.text ||
      await sha256Hex(row.chunk_text) !== row.chunk_sha256 ||
      encoder.encode(row.chunk_text).byteLength !== row.chunk_byte_length
    ) {
      return false;
    }
  }
  return true;
}

function stressResultsMatch(
  rows: readonly StoredStressResultRow[],
  expected: readonly CrossSectionalMomentumExecutionStressResult[],
): boolean {
  return (
    rows.length === expected.length &&
    rows.every((row, index) => {
      const item = expected[index]!;
      return (
        row.result_index === index &&
        row.capital_aud === item.capitalAud &&
        row.scenario_id === item.scenarioId &&
        row.config_sha256 === item.configSha256 &&
        row.steps_sha256 === item.stepsSha256 &&
        row.result_sha256 === item.resultSha256
      );
    })
  );
}

export class CrossSectionalMomentumCompleteEvaluationRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async persist(
    input: CrossSectionalMomentumCompleteEvaluationPersistenceInput,
  ): Promise<CrossSectionalMomentumCompleteEvaluation> {
    const statements =
      await prepareCrossSectionalMomentumCompleteEvaluationPersistence(
        input,
      );
    await this.#db.batch(
      statements.map((statement) =>
        this.#db.prepare(statement.sql).bind(...statement.params)
      ),
    );

    const report = input.evaluation.report;
    const stress = input.input.executionStressManifest;
    const reportJson = canonicalIntelligenceJson(report);
    const expectedChunks = await prepareChunks(reportJson);
    const [reportRow, chunks, stressRow, stressResults, evaluationRow] =
      await Promise.all([
        this.#db
          .prepare(SELECT_REPORT_SQL)
          .bind(report.reportSha256)
          .first<StoredReportRow>(),
        this.#db
          .prepare(SELECT_REPORT_CHUNKS_SQL)
          .bind(report.reportSha256)
          .all<StoredReportChunkRow>(),
        this.#db
          .prepare(SELECT_STRESS_SQL)
          .bind(stress.manifestSha256)
          .first<StoredStressRow>(),
        this.#db
          .prepare(SELECT_STRESS_RESULTS_SQL)
          .bind(stress.manifestSha256)
          .all<StoredStressResultRow>(),
        this.#db
          .prepare(SELECT_EVALUATION_SQL)
          .bind(input.evaluation.evaluationSha256)
          .first<StoredEvaluationRow>(),
      ]);
    const chunkRows = chunks.results ?? [];
    const stressRows = stressResults.results ?? [];
    if (
      reportRow === null ||
      stressRow === null ||
      evaluationRow === null ||
      reportRow.report_sha256 !== report.reportSha256 ||
      reportRow.canonical_byte_length !==
        encoder.encode(reportJson).byteLength ||
      reportRow.chunk_count !== expectedChunks.length ||
      reportRow.persisted_at_ms > input.persistedAtMs ||
      !await chunksMatch(chunkRows, expectedChunks) ||
      chunkRows.map((chunk) => chunk.chunk_text).join("") !== reportJson ||
      stressRow.manifest_sha256 !== stress.manifestSha256 ||
      stressRow.calibration_sha256 !== stress.calibrationSha256 ||
      stressRow.result_count !== stress.results.length ||
      stressRow.persisted_at_ms > input.persistedAtMs ||
      !stressResultsMatch(stressRows, stress.results) ||
      evaluationRow.evaluation_sha256 !==
        input.evaluation.evaluationSha256 ||
      evaluationRow.walk_forward_manifest_sha256 !==
        input.evaluation.walkForwardManifestSha256 ||
      evaluationRow.sensitivity_manifest_sha256 !==
        input.evaluation.sensitivityManifestSha256 ||
      evaluationRow.final_holdout_plan_sha256 !==
        input.evaluation.finalHoldoutPlanSha256 ||
      evaluationRow.final_holdout_run_sha256 !==
        input.evaluation.finalHoldoutRunSha256 ||
      evaluationRow.final_holdout_result_sha256 !==
        input.evaluation.finalHoldoutResultSha256 ||
      evaluationRow.execution_stress_manifest_sha256 !==
        input.evaluation.executionStressManifestSha256 ||
      evaluationRow.report_sha256 !== report.reportSha256 ||
      evaluationRow.execution_capacity_summary_json !==
        canonicalIntelligenceJson(
          input.evaluation.executionCapacitySummary,
        ) ||
      evaluationRow.persisted_at_ms > input.persistedAtMs
    ) {
      throw new Error(
        "persisted cross-sectional complete evaluation verification failed",
      );
    }
    return input.evaluation;
  }
}
