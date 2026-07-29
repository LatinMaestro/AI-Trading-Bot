import { canonicalIntelligenceJson } from "../intelligence/canonical.ts";
import {
  prepareHourlyTrendBreakoutSensitivityManifest,
  prepareHourlyTrendBreakoutWalkForwardManifest,
  type HourlyTrendBreakoutEvaluationRunInput,
  type HourlyTrendBreakoutSensitivityManifest,
  type HourlyTrendBreakoutSensitivityVariantInput,
  type HourlyTrendBreakoutWalkForwardFoldInput,
  type HourlyTrendBreakoutWalkForwardManifest,
} from "../research/hourlyTrendBreakoutEvaluation.ts";

type D1BindValue = string | number | null;

export interface HourlyTrendBreakoutEvaluationManifestStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export interface WalkForwardManifestPersistenceInput {
  readonly kind: "walk-forward";
  readonly folds: readonly HourlyTrendBreakoutWalkForwardFoldInput[];
  readonly finalHoldout: HourlyTrendBreakoutEvaluationRunInput;
  readonly manifest: HourlyTrendBreakoutWalkForwardManifest;
  readonly persistedAtMs: number;
}

export interface SensitivityManifestPersistenceInput {
  readonly kind: "sensitivity";
  readonly variants: readonly HourlyTrendBreakoutSensitivityVariantInput[];
  readonly manifest: HourlyTrendBreakoutSensitivityManifest;
  readonly persistedAtMs: number;
}

export type HourlyTrendBreakoutEvaluationManifestPersistenceInput =
  | WalkForwardManifestPersistenceInput
  | SensitivityManifestPersistenceInput;

interface EvaluationManifestMember {
  readonly runSha256: string;
  readonly memberKind:
    | "training"
    | "validation"
    | "final-holdout"
    | "sensitivity-variant";
  readonly memberIndex: number;
}

interface PersistedEvaluationManifestRow {
  readonly manifest_sha256: string;
  readonly manifest_kind: string;
  readonly schema_version: string;
  readonly strategy_version: string;
  readonly primary_policy_sha256: string;
  readonly config_sha256: string;
  readonly evaluation_start_at_ms: number;
  readonly evaluation_end_at_ms: number;
  readonly component_run_count: number;
  readonly fold_count: number | null;
  readonly variant_count: number | null;
  readonly manifest_json: string;
  readonly persisted_at_ms: number;
}

export const INSERT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_SQL =
  `INSERT INTO hourly_trend_breakout_evaluation_manifests
    (manifest_sha256, manifest_kind, schema_version, strategy_version,
     primary_policy_sha256, config_sha256, evaluation_start_at_ms,
     evaluation_end_at_ms, component_run_count, fold_count, variant_count,
     manifest_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(manifest_sha256) DO NOTHING`;

export const INSERT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_RUN_SQL =
  `INSERT INTO hourly_trend_breakout_evaluation_manifest_runs
    (manifest_sha256, run_sha256, member_kind, member_index)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(manifest_sha256, run_sha256) DO NOTHING`;

const SELECT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_SQL =
  `SELECT manifest_sha256, manifest_kind, schema_version, strategy_version,
          primary_policy_sha256, config_sha256, evaluation_start_at_ms,
          evaluation_end_at_ms, component_run_count, fold_count, variant_count,
          manifest_json, persisted_at_ms
   FROM hourly_trend_breakout_evaluation_manifests
   WHERE manifest_sha256 = ?`;

const SELECT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_RUNS_SQL =
  `SELECT run_sha256 AS runSha256, member_kind AS memberKind,
          member_index AS memberIndex
   FROM hourly_trend_breakout_evaluation_manifest_runs
   WHERE manifest_sha256 = ?
   ORDER BY member_index`;

function assertPersistenceTime(persistedAtMs: number, endAtMs: number): void {
  if (
    !Number.isSafeInteger(persistedAtMs) ||
    persistedAtMs < endAtMs
  ) {
    throw new Error(
      "evaluation manifest persistence chronology is invalid",
    );
  }
}

function manifestsMatch(
  expected:
    | HourlyTrendBreakoutWalkForwardManifest
    | HourlyTrendBreakoutSensitivityManifest,
  supplied:
    | HourlyTrendBreakoutWalkForwardManifest
    | HourlyTrendBreakoutSensitivityManifest,
): boolean {
  return (
    expected.manifestSha256 === supplied.manifestSha256 &&
    canonicalIntelligenceJson(expected) === canonicalIntelligenceJson(supplied)
  );
}

function walkForwardMembers(
  input: WalkForwardManifestPersistenceInput,
): readonly EvaluationManifestMember[] {
  const members: EvaluationManifestMember[] = [];
  for (const fold of input.folds) {
    members.push(
      {
        runSha256: fold.training.run.runSha256,
        memberKind: "training",
        memberIndex: members.length,
      },
      {
        runSha256: fold.validation.run.runSha256,
        memberKind: "validation",
        memberIndex: members.length + 1,
      },
    );
  }
  members.push({
    runSha256: input.finalHoldout.run.runSha256,
    memberKind: "final-holdout",
    memberIndex: members.length,
  });
  return members;
}

function sensitivityMembers(
  manifest: HourlyTrendBreakoutSensitivityManifest,
): readonly EvaluationManifestMember[] {
  return manifest.variants.map((variant, memberIndex) => ({
    runSha256: variant.runSha256,
    memberKind: "sensitivity-variant",
    memberIndex,
  }));
}

export async function prepareHourlyTrendBreakoutEvaluationManifestPersistence(
  input: HourlyTrendBreakoutEvaluationManifestPersistenceInput,
): Promise<readonly HourlyTrendBreakoutEvaluationManifestStatement[]> {
  let members: readonly EvaluationManifestMember[];
  let headerParams: readonly D1BindValue[];

  if (input.kind === "walk-forward") {
    const reproduced = await prepareHourlyTrendBreakoutWalkForwardManifest(
      input.folds,
      input.finalHoldout,
    );
    if (!manifestsMatch(reproduced, input.manifest)) {
      throw new Error("walk-forward evaluation manifest is not reproducible");
    }
    const firstFold = input.manifest.folds[0];
    if (firstFold === undefined) {
      throw new Error("walk-forward evaluation manifest is empty");
    }
    assertPersistenceTime(
      input.persistedAtMs,
      input.manifest.finalHoldout.endAtMs,
    );
    members = walkForwardMembers(input);
    headerParams = [
      input.manifest.manifestSha256,
      input.kind,
      input.manifest.schemaVersion,
      input.manifest.strategyVersion,
      input.manifest.policySha256,
      input.manifest.configSha256,
      firstFold.trainingStartAtMs,
      input.manifest.finalHoldout.endAtMs,
      members.length,
      input.manifest.folds.length,
      null,
      canonicalIntelligenceJson(input.manifest),
      input.persistedAtMs,
    ];
  } else {
    const reproduced = await prepareHourlyTrendBreakoutSensitivityManifest(
      input.variants,
    );
    if (!manifestsMatch(reproduced, input.manifest)) {
      throw new Error("sensitivity evaluation manifest is not reproducible");
    }
    assertPersistenceTime(
      input.persistedAtMs,
      input.manifest.evaluationEndAtMs,
    );
    members = sensitivityMembers(input.manifest);
    headerParams = [
      input.manifest.manifestSha256,
      input.kind,
      input.manifest.schemaVersion,
      input.manifest.strategyVersion,
      input.manifest.baselinePolicySha256,
      input.manifest.configSha256,
      input.manifest.evaluationStartAtMs,
      input.manifest.evaluationEndAtMs,
      members.length,
      null,
      input.manifest.variants.length,
      canonicalIntelligenceJson(input.manifest),
      input.persistedAtMs,
    ];
  }

  return [
    {
      sql: INSERT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_SQL,
      params: headerParams,
    },
    ...members.map((member) => ({
      sql: INSERT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_RUN_SQL,
      params: [
        input.manifest.manifestSha256,
        member.runSha256,
        member.memberKind,
        member.memberIndex,
      ],
    })),
  ];
}

function rowMatches(
  row: PersistedEvaluationManifestRow,
  input: HourlyTrendBreakoutEvaluationManifestPersistenceInput,
  memberCount: number,
): boolean {
  const manifest = input.manifest;
  const walkForward =
    manifest.schemaVersion ===
    "hourly-trend-breakout-walk-forward-manifest-v1";
  const startAtMs = walkForward
    ? manifest.folds[0]?.trainingStartAtMs
    : manifest.evaluationStartAtMs;
  const endAtMs = walkForward
    ? manifest.finalHoldout.endAtMs
    : manifest.evaluationEndAtMs;
  const primaryPolicySha256 = walkForward
    ? manifest.policySha256
    : manifest.baselinePolicySha256;
  return (
    startAtMs !== undefined &&
    row.manifest_sha256 === manifest.manifestSha256 &&
    row.manifest_kind === input.kind &&
    row.schema_version === manifest.schemaVersion &&
    row.strategy_version === manifest.strategyVersion &&
    row.primary_policy_sha256 === primaryPolicySha256 &&
    row.config_sha256 === manifest.configSha256 &&
    row.evaluation_start_at_ms === startAtMs &&
    row.evaluation_end_at_ms === endAtMs &&
    row.component_run_count === memberCount &&
    row.fold_count === (walkForward ? manifest.folds.length : null) &&
    row.variant_count === (walkForward ? null : manifest.variants.length) &&
    row.manifest_json === canonicalIntelligenceJson(manifest) &&
    row.persisted_at_ms <= input.persistedAtMs &&
    row.persisted_at_ms >= endAtMs
  );
}

export class HourlyTrendBreakoutEvaluationManifestRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: HourlyTrendBreakoutEvaluationManifestPersistenceInput,
  ): Promise<
    | HourlyTrendBreakoutWalkForwardManifest
    | HourlyTrendBreakoutSensitivityManifest
  > {
    const statements =
      await prepareHourlyTrendBreakoutEvaluationManifestPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params),
      ),
    );
    const [row, memberRows] = await Promise.all([
      this.db
        .prepare(SELECT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_SQL)
        .bind(input.manifest.manifestSha256)
        .first<PersistedEvaluationManifestRow>(),
      this.db
        .prepare(SELECT_HOURLY_TREND_BREAKOUT_EVALUATION_MANIFEST_RUNS_SQL)
        .bind(input.manifest.manifestSha256)
        .all<{
          readonly runSha256: string;
          readonly memberKind: string;
          readonly memberIndex: number;
        }>(),
    ]);
    const expectedMembers = statements.slice(1).map((statement) => ({
      runSha256: statement.params[1],
      memberKind: statement.params[2],
      memberIndex: statement.params[3],
    }));
    if (
      row === null ||
      !rowMatches(row, input, expectedMembers.length) ||
      canonicalIntelligenceJson(memberRows.results) !==
        canonicalIntelligenceJson(expectedMembers)
    ) {
      throw new Error(
        "persisted evaluation manifest verification failed",
      );
    }
    return input.manifest;
  }
}
