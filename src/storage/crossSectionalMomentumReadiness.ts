import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
import {
  prepareCrossSectionalMomentumReadinessAssessment,
  REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES,
  type CrossSectionalMomentumReadinessAssessment,
  type CrossSectionalMomentumReadinessGateId,
  type CrossSectionalMomentumReadinessInput,
} from "../research/crossSectionalMomentumReadiness.ts";
import { sha256Hex } from "../utils/crypto.ts";

type D1BindValue = string | number | null;

const EVALUATION_GATE = "complete-after-cost-evaluation";
const CALIBRATION_GATE = "live-like-execution-calibration";
const STRESS_GATE = "capacity-path-stress";
const REPORT_GATE = "canonical-research-report";

export interface CrossSectionalMomentumReadinessPersistenceInput {
  readonly input: CrossSectionalMomentumReadinessInput;
  readonly assessment: CrossSectionalMomentumReadinessAssessment;
  readonly persistedAtMs: number;
}

export interface CrossSectionalMomentumReadinessStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

interface ReadinessRow {
  readonly assessment_sha256: string;
  readonly evidence_input_sha256: string;
  readonly assessed_at_ms: number;
  readonly gate_count: number;
  readonly input_canonical_json: string;
  readonly assessment_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface GateRow {
  readonly gate_index: number;
  readonly gate_id: string;
  readonly stage: string;
  readonly review_gate: string;
  readonly status: string;
  readonly artifact_sha256s_json: string;
}

interface BindingRow {
  readonly assessment_sha256: string;
  readonly complete_evaluation_sha256: string | null;
  readonly execution_calibration_sha256: string | null;
  readonly execution_stress_manifest_sha256: string | null;
  readonly report_sha256: string | null;
  readonly persisted_at_ms: number;
}

export const INSERT_CROSS_SECTIONAL_READINESS_SQL =
  `INSERT INTO cross_sectional_momentum_readiness_assessments
    (assessment_sha256, schema_version, strategy_version, candidate_status,
     runtime_scope_changed, selection_authority, activation_authority,
     execution_authority, assessed_at_ms, evidence_input_sha256,
     research_status, promotion_status, gate_count, input_canonical_json,
     assessment_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(assessment_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_READINESS_GATE_SQL =
  `INSERT INTO cross_sectional_momentum_readiness_gates
    (assessment_sha256, gate_index, gate_id, stage, review_gate, status,
     artifact_sha256s_json)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(assessment_sha256, gate_index) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_READINESS_BINDING_SQL =
  `INSERT INTO cross_sectional_momentum_readiness_bindings
    (assessment_sha256, complete_evaluation_sha256,
     execution_calibration_sha256, execution_stress_manifest_sha256,
     report_sha256, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(assessment_sha256) DO NOTHING`;

const SELECT_READINESS_SQL =
  `SELECT assessment_sha256, evidence_input_sha256, assessed_at_ms,
          gate_count, input_canonical_json, assessment_canonical_json,
          persisted_at_ms
   FROM cross_sectional_momentum_readiness_assessments
   WHERE assessment_sha256 = ?`;

const SELECT_GATES_SQL =
  `SELECT gate_index, gate_id, stage, review_gate, status,
          artifact_sha256s_json
   FROM cross_sectional_momentum_readiness_gates
   WHERE assessment_sha256 = ?
   ORDER BY gate_index`;

const SELECT_BINDING_SQL =
  `SELECT assessment_sha256, complete_evaluation_sha256,
          execution_calibration_sha256, execution_stress_manifest_sha256,
          report_sha256, persisted_at_ms
   FROM cross_sectional_momentum_readiness_bindings
   WHERE assessment_sha256 = ?`;

function canonicalInput(input: CrossSectionalMomentumReadinessInput): string {
  const byGate = new Map(
    input.evidence.map((evidence) => [evidence.gateId, evidence]),
  );
  return canonicalIntelligenceJson({
    assessedAtMs: input.assessedAtMs,
    evidence: REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES.flatMap(
      (gate) => {
        const evidence = byGate.get(gate.id);
        return evidence === undefined ? [] : [evidence];
      },
    ),
  });
}

function evidenceDigest(
  assessment: CrossSectionalMomentumReadinessAssessment,
  gateId: CrossSectionalMomentumReadinessGateId,
): string | null {
  const gate = assessment.gates.find((candidate) =>
    candidate.gateId === gateId
  );
  if (gate === undefined) {
    throw new Error(`cross-sectional readiness is missing gate ${gateId}`);
  }
  if (gate.status !== "evidence-present") return null;
  const [digest] = gate.artifactSha256s;
  if (gate.artifactSha256s.length !== 1 || digest === undefined) {
    throw new Error(
      `cross-sectional readiness gate ${gateId} requires one identity`,
    );
  }
  return digest;
}

export async function prepareCrossSectionalMomentumReadinessPersistence(
  persistence: CrossSectionalMomentumReadinessPersistenceInput,
): Promise<readonly CrossSectionalMomentumReadinessStatement[]> {
  const reproduced =
    await prepareCrossSectionalMomentumReadinessAssessment(
      persistence.input,
    );
  if (
    reproduced.assessmentSha256 !==
      persistence.assessment.assessmentSha256 ||
    canonicalIntelligenceJson(reproduced) !==
      canonicalIntelligenceJson(persistence.assessment)
  ) {
    throw new Error("cross-sectional readiness is not reproducible");
  }
  if (
    !Number.isSafeInteger(persistence.persistedAtMs) ||
    persistence.persistedAtMs < reproduced.assessedAtMs
  ) {
    throw new Error("cross-sectional readiness chronology is invalid");
  }
  return [
    {
      sql: INSERT_CROSS_SECTIONAL_READINESS_SQL,
      params: [
        reproduced.assessmentSha256,
        reproduced.schemaVersion,
        reproduced.strategyVersion,
        reproduced.candidateStatus,
        0,
        reproduced.selectionAuthority,
        reproduced.activationAuthority,
        reproduced.executionAuthority,
        reproduced.assessedAtMs,
        reproduced.evidenceInputSha256,
        reproduced.researchStatus,
        reproduced.promotionStatus,
        reproduced.gates.length,
        canonicalInput(persistence.input),
        canonicalIntelligenceJson(reproduced),
        persistence.persistedAtMs,
      ],
    },
    ...reproduced.gates.map((gate, index) => ({
      sql: INSERT_CROSS_SECTIONAL_READINESS_GATE_SQL,
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
      sql: INSERT_CROSS_SECTIONAL_READINESS_BINDING_SQL,
      params: [
        reproduced.assessmentSha256,
        evidenceDigest(reproduced, EVALUATION_GATE),
        evidenceDigest(reproduced, CALIBRATION_GATE),
        evidenceDigest(reproduced, STRESS_GATE),
        evidenceDigest(reproduced, REPORT_GATE),
        persistence.persistedAtMs,
      ],
    },
  ];
}

function gateRowsMatch(
  rows: readonly GateRow[],
  assessment: CrossSectionalMomentumReadinessAssessment,
): boolean {
  return rows.length === assessment.gates.length &&
    rows.every((row, index) => {
      const gate = assessment.gates[index];
      return gate !== undefined &&
        row.gate_index === index &&
        row.gate_id === gate.gateId &&
        row.stage === gate.stage &&
        row.review_gate === gate.reviewGate &&
        row.status === gate.status &&
        row.artifact_sha256s_json ===
          canonicalIntelligenceJson(gate.artifactSha256s);
    });
}

function bindingMatches(
  row: BindingRow,
  assessment: CrossSectionalMomentumReadinessAssessment,
  persistedAtMs: number,
): boolean {
  return row.assessment_sha256 === assessment.assessmentSha256 &&
    row.complete_evaluation_sha256 ===
      evidenceDigest(assessment, EVALUATION_GATE) &&
    row.execution_calibration_sha256 ===
      evidenceDigest(assessment, CALIBRATION_GATE) &&
    row.execution_stress_manifest_sha256 ===
      evidenceDigest(assessment, STRESS_GATE) &&
    row.report_sha256 === evidenceDigest(assessment, REPORT_GATE) &&
    row.persisted_at_ms >= assessment.assessedAtMs &&
    row.persisted_at_ms <= persistedAtMs;
}

export class CrossSectionalMomentumReadinessRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: CrossSectionalMomentumReadinessPersistenceInput,
  ): Promise<CrossSectionalMomentumReadinessAssessment> {
    const statements =
      await prepareCrossSectionalMomentumReadinessPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params)
      ),
    );
    const [row, gates, binding] = await Promise.all([
      this.db.prepare(SELECT_READINESS_SQL)
        .bind(input.assessment.assessmentSha256)
        .first<ReadinessRow>(),
      this.db.prepare(SELECT_GATES_SQL)
        .bind(input.assessment.assessmentSha256)
        .all<GateRow>(),
      this.db.prepare(SELECT_BINDING_SQL)
        .bind(input.assessment.assessmentSha256)
        .first<BindingRow>(),
    ]);
    if (
      row === null ||
      binding === null ||
      row.assessment_sha256 !== input.assessment.assessmentSha256 ||
      row.evidence_input_sha256 !== input.assessment.evidenceInputSha256 ||
      row.assessed_at_ms !== input.assessment.assessedAtMs ||
      row.gate_count !== input.assessment.gates.length ||
      row.input_canonical_json !== canonicalInput(input.input) ||
      await sha256Hex(row.input_canonical_json) !==
        row.evidence_input_sha256 ||
      row.assessment_canonical_json !==
        canonicalIntelligenceJson(input.assessment) ||
      row.persisted_at_ms < input.assessment.assessedAtMs ||
      row.persisted_at_ms > input.persistedAtMs ||
      !gateRowsMatch(gates.results ?? [], input.assessment) ||
      !bindingMatches(binding, input.assessment, input.persistedAtMs)
    ) {
      throw new Error("persisted cross-sectional readiness is invalid");
    }
    return input.assessment;
  }
}
