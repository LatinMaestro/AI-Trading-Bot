import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
import {
  prepareHourlyTrendBreakoutReadinessAssessment,
  REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES,
  type HourlyTrendBreakoutReadinessAssessment,
  type HourlyTrendBreakoutReadinessGateId,
  type HourlyTrendBreakoutReadinessInput,
} from "../research/hourlyTrendBreakoutReadiness.ts";
import { sha256Hex } from "../utils/crypto.ts";

type D1BindValue = string | number | null;

const COMPLETE_EVALUATION_GATE = "complete-after-cost-evaluation";
const EXECUTION_CALIBRATION_GATE = "live-like-execution-calibration";
const CAPACITY_STRESS_GATE = "capacity-path-stress";

export interface HourlyTrendBreakoutReadinessPersistenceInput {
  readonly input: HourlyTrendBreakoutReadinessInput;
  readonly assessment: HourlyTrendBreakoutReadinessAssessment;
  readonly persistedAtMs: number;
}

export interface HourlyTrendBreakoutReadinessStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

interface PersistedReadinessRow {
  readonly assessment_sha256: string;
  readonly evidence_input_sha256: string;
  readonly assessed_at_ms: number;
  readonly research_status: string;
  readonly promotion_status: string;
  readonly gate_count: number;
  readonly input_canonical_json: string;
  readonly assessment_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedReadinessGateRow {
  readonly gate_index: number;
  readonly gate_id: string;
  readonly stage: string;
  readonly review_gate: string;
  readonly status: string;
  readonly artifact_sha256s_json: string;
}

interface PersistedReadinessBindingRow {
  readonly assessment_sha256: string;
  readonly complete_evaluation_sha256: string | null;
  readonly execution_calibration_sha256: string | null;
  readonly execution_stress_manifest_sha256: string | null;
  readonly persisted_at_ms: number;
}

export const INSERT_HOURLY_TREND_BREAKOUT_READINESS_SQL =
  `INSERT INTO hourly_trend_breakout_readiness_assessments
    (assessment_sha256, schema_version, strategy_version, candidate_status,
     decision_authority, assessed_at_ms, evidence_input_sha256,
     research_status, promotion_status, gate_count, input_canonical_json,
     assessment_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(assessment_sha256) DO NOTHING`;

export const INSERT_HOURLY_TREND_BREAKOUT_READINESS_GATE_SQL =
  `INSERT INTO hourly_trend_breakout_readiness_gates
    (assessment_sha256, gate_index, gate_id, stage, review_gate, status,
     artifact_sha256s_json)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(assessment_sha256, gate_index) DO NOTHING`;

export const INSERT_HOURLY_TREND_BREAKOUT_READINESS_BINDING_SQL =
  `INSERT INTO hourly_trend_breakout_readiness_bindings
    (assessment_sha256, complete_evaluation_sha256,
     execution_calibration_sha256, execution_stress_manifest_sha256,
     persisted_at_ms)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(assessment_sha256) DO NOTHING`;

const SELECT_READINESS_SQL =
  `SELECT assessment_sha256, evidence_input_sha256, assessed_at_ms,
          research_status, promotion_status, gate_count,
          input_canonical_json, assessment_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_readiness_assessments
   WHERE assessment_sha256 = ?`;

const SELECT_READINESS_GATES_SQL =
  `SELECT gate_index, gate_id, stage, review_gate, status,
          artifact_sha256s_json
   FROM hourly_trend_breakout_readiness_gates
   WHERE assessment_sha256 = ?
   ORDER BY gate_index`;

const SELECT_READINESS_BINDING_SQL =
  `SELECT assessment_sha256, complete_evaluation_sha256,
          execution_calibration_sha256, execution_stress_manifest_sha256,
          persisted_at_ms
   FROM hourly_trend_breakout_readiness_bindings
   WHERE assessment_sha256 = ?`;

function exactAssessment(
  expected: HourlyTrendBreakoutReadinessAssessment,
  supplied: HourlyTrendBreakoutReadinessAssessment,
): boolean {
  return (
    expected.assessmentSha256 === supplied.assessmentSha256 &&
    canonicalIntelligenceJson(expected) ===
      canonicalIntelligenceJson(supplied)
  );
}

function canonicalReadinessInput(
  input: HourlyTrendBreakoutReadinessInput,
): string {
  const evidenceByGate = new Map(
    input.evidence.map((evidence) => [evidence.gateId, evidence]),
  );
  const evidence = REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES
    .flatMap((gate) => {
      const item = evidenceByGate.get(gate.id);
      return item === undefined ? [] : [item];
    });
  return canonicalIntelligenceJson({
    assessedAtMs: input.assessedAtMs,
    evidence,
  });
}

function evidenceDigest(
  assessment: HourlyTrendBreakoutReadinessAssessment,
  gateId: HourlyTrendBreakoutReadinessGateId,
): string | null {
  const gate = assessment.gates.find((candidate) =>
    candidate.gateId === gateId
  );
  if (gate === undefined) {
    throw new Error(`readiness assessment is missing gate ${gateId}`);
  }
  if (gate.status !== "evidence-present") return null;
  const [digest] = gate.artifactSha256s;
  if (gate.artifactSha256s.length !== 1 || digest === undefined) {
    throw new Error(
      `readiness gate ${gateId} requires one exact persistence identity`,
    );
  }
  return digest;
}

export async function prepareHourlyTrendBreakoutReadinessPersistence(
  persistence: HourlyTrendBreakoutReadinessPersistenceInput,
): Promise<readonly HourlyTrendBreakoutReadinessStatement[]> {
  const reproduced =
    await prepareHourlyTrendBreakoutReadinessAssessment(persistence.input);
  if (!exactAssessment(reproduced, persistence.assessment)) {
    throw new Error("hourly trend/breakout readiness is not reproducible");
  }
  if (
    !Number.isSafeInteger(persistence.persistedAtMs) ||
    persistence.persistedAtMs < reproduced.assessedAtMs
  ) {
    throw new Error("readiness persistence chronology is invalid");
  }
  const completeEvaluationSha256 = evidenceDigest(
    reproduced,
    COMPLETE_EVALUATION_GATE,
  );
  const executionCalibrationSha256 = evidenceDigest(
    reproduced,
    EXECUTION_CALIBRATION_GATE,
  );
  const executionStressManifestSha256 = evidenceDigest(
    reproduced,
    CAPACITY_STRESS_GATE,
  );
  const canonicalInput = canonicalReadinessInput(persistence.input);
  return [
    {
      sql: INSERT_HOURLY_TREND_BREAKOUT_READINESS_SQL,
      params: [
        reproduced.assessmentSha256,
        reproduced.schemaVersion,
        reproduced.strategyVersion,
        reproduced.candidateStatus,
        reproduced.decisionAuthority,
        reproduced.assessedAtMs,
        reproduced.evidenceInputSha256,
        reproduced.researchStatus,
        reproduced.promotionStatus,
        reproduced.gates.length,
        canonicalInput,
        canonicalIntelligenceJson(reproduced),
        persistence.persistedAtMs,
      ],
    },
    ...reproduced.gates.map((gate, index) => ({
      sql: INSERT_HOURLY_TREND_BREAKOUT_READINESS_GATE_SQL,
      params: [
        reproduced.assessmentSha256,
        index,
        gate.gateId,
        gate.stage,
        gate.reviewGate,
        gate.status,
        canonicalIntelligenceJson(gate.artifactSha256s),
      ],
    })),
    {
      sql: INSERT_HOURLY_TREND_BREAKOUT_READINESS_BINDING_SQL,
      params: [
        reproduced.assessmentSha256,
        completeEvaluationSha256,
        executionCalibrationSha256,
        executionStressManifestSha256,
        persistence.persistedAtMs,
      ],
    },
  ];
}

async function rowMatches(
  row: PersistedReadinessRow,
  input: HourlyTrendBreakoutReadinessPersistenceInput,
): Promise<boolean> {
  return (
    row.assessment_sha256 === input.assessment.assessmentSha256 &&
    row.evidence_input_sha256 === input.assessment.evidenceInputSha256 &&
    row.assessed_at_ms === input.assessment.assessedAtMs &&
    row.research_status === input.assessment.researchStatus &&
    row.promotion_status === input.assessment.promotionStatus &&
    row.gate_count === input.assessment.gates.length &&
    row.input_canonical_json === canonicalReadinessInput(input.input) &&
    await sha256Hex(row.input_canonical_json) ===
      row.evidence_input_sha256 &&
    row.assessment_canonical_json ===
      canonicalIntelligenceJson(input.assessment) &&
    row.persisted_at_ms >= input.assessment.assessedAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

function gateRowsMatch(
  rows: readonly PersistedReadinessGateRow[],
  assessment: HourlyTrendBreakoutReadinessAssessment,
): boolean {
  return (
    rows.length === assessment.gates.length &&
    rows.every((row, index) => {
      const gate = assessment.gates[index];
      return (
        gate !== undefined &&
        row.gate_index === index &&
        row.gate_id === gate.gateId &&
        row.stage === gate.stage &&
        row.review_gate === gate.reviewGate &&
        row.status === gate.status &&
        row.artifact_sha256s_json ===
          canonicalIntelligenceJson(gate.artifactSha256s)
      );
    })
  );
}

function bindingRowMatches(
  row: PersistedReadinessBindingRow,
  assessment: HourlyTrendBreakoutReadinessAssessment,
  persistedAtMs: number,
): boolean {
  return (
    row.assessment_sha256 === assessment.assessmentSha256 &&
    row.complete_evaluation_sha256 ===
      evidenceDigest(assessment, COMPLETE_EVALUATION_GATE) &&
    row.execution_calibration_sha256 ===
      evidenceDigest(assessment, EXECUTION_CALIBRATION_GATE) &&
    row.execution_stress_manifest_sha256 ===
      evidenceDigest(assessment, CAPACITY_STRESS_GATE) &&
    row.persisted_at_ms >= assessment.assessedAtMs &&
    row.persisted_at_ms <= persistedAtMs
  );
}

export class HourlyTrendBreakoutReadinessRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: HourlyTrendBreakoutReadinessPersistenceInput,
  ): Promise<HourlyTrendBreakoutReadinessAssessment> {
    const statements =
      await prepareHourlyTrendBreakoutReadinessPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params)
      ),
    );
    const [row, gateResult, binding] = await Promise.all([
      this.db
        .prepare(SELECT_READINESS_SQL)
        .bind(input.assessment.assessmentSha256)
        .first<PersistedReadinessRow>(),
      this.db
        .prepare(SELECT_READINESS_GATES_SQL)
        .bind(input.assessment.assessmentSha256)
        .all<PersistedReadinessGateRow>(),
      this.db
        .prepare(SELECT_READINESS_BINDING_SQL)
        .bind(input.assessment.assessmentSha256)
        .first<PersistedReadinessBindingRow>(),
    ]);
    if (
      row === null ||
      binding === null ||
      !await rowMatches(row, input) ||
      !gateRowsMatch(gateResult.results ?? [], input.assessment) ||
      !bindingRowMatches(binding, input.assessment, input.persistedAtMs)
    ) {
      throw new Error("persisted readiness verification failed");
    }
    return input.assessment;
  }
}
