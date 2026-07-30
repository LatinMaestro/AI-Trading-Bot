import {
  verifyCrossSectionalMomentumResearchRun,
  type CrossSectionalMomentumBacktestPlan,
  type CrossSectionalMomentumResearchRun,
  type RunUniverseBoundBacktest,
} from "../backtest/crossSectionalMomentum.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  prepareCrossSectionalMomentumSensitivityManifest,
  prepareCrossSectionalMomentumWalkForwardManifest,
  type CrossSectionalMomentumEvaluationRunInput,
  type CrossSectionalMomentumSensitivityManifest,
  type CrossSectionalMomentumWalkForwardFoldInput,
  type CrossSectionalMomentumWalkForwardManifest,
} from "../research/crossSectionalMomentumEvaluation.ts";

type D1BindValue = string | number | null;

export interface CrossSectionalMomentumPersistenceStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export interface CrossSectionalMomentumResearchRunPersistenceInput<
  Config,
  Result,
> {
  readonly plan: CrossSectionalMomentumBacktestPlan;
  readonly run: CrossSectionalMomentumResearchRun<Config, Result>;
  readonly runner: RunUniverseBoundBacktest<Config, Result>;
  readonly persistedAtMs: number;
}

export interface CrossSectionalMomentumWalkForwardPersistenceInput<
  Config,
  Result,
> {
  readonly kind: "walk-forward";
  readonly folds:
    readonly CrossSectionalMomentumWalkForwardFoldInput<
      Config,
      Result
    >[];
  readonly finalHoldout:
    CrossSectionalMomentumEvaluationRunInput<Config, Result>;
  readonly manifest: CrossSectionalMomentumWalkForwardManifest;
  readonly runner: RunUniverseBoundBacktest<Config, Result>;
  readonly persistedAtMs: number;
}

export interface CrossSectionalMomentumSensitivityPersistenceInput<
  Config,
  Result,
> {
  readonly kind: "sensitivity";
  readonly variants:
    readonly CrossSectionalMomentumEvaluationRunInput<
      Config,
      Result
    >[];
  readonly manifest: CrossSectionalMomentumSensitivityManifest;
  readonly runner: RunUniverseBoundBacktest<Config, Result>;
  readonly persistedAtMs: number;
}

export type CrossSectionalMomentumEvaluationPersistenceInput<
  Config,
  Result,
> =
  | CrossSectionalMomentumWalkForwardPersistenceInput<Config, Result>
  | CrossSectionalMomentumSensitivityPersistenceInput<Config, Result>;

interface EvaluationMember {
  readonly runSha256: string;
  readonly planSha256: string;
  readonly resultSha256: string;
  readonly policySha256: string;
  readonly evidenceSha256: string;
  readonly memberKind:
    | "training"
    | "validation"
    | "final-holdout"
    | "sensitivity-variant";
  readonly memberIndex: number;
}

export const INSERT_CROSS_SECTIONAL_MOMENTUM_RESEARCH_RUN_SQL =
  `INSERT INTO cross_sectional_momentum_research_runs
    (run_sha256, plan_sha256, config_sha256, result_sha256,
     policy_sha256, evidence_sha256, schema_version, strategy_version,
     engine_contract, first_decision_at_ms, last_decision_at_ms,
     decision_count, membership_count, run_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(run_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_MOMENTUM_EVALUATION_MANIFEST_SQL =
  `INSERT INTO cross_sectional_momentum_evaluation_manifests
    (manifest_sha256, manifest_kind, schema_version, strategy_version,
     engine_contract, primary_policy_sha256, config_sha256,
     evidence_sha256, evaluation_start_at_ms, evaluation_end_at_ms,
     component_run_count, fold_count, variant_count,
     manifest_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(manifest_sha256) DO NOTHING`;

export const INSERT_CROSS_SECTIONAL_MOMENTUM_EVALUATION_MEMBER_SQL =
  `INSERT INTO cross_sectional_momentum_evaluation_manifest_runs
    (manifest_sha256, member_index, member_kind, run_sha256,
     plan_sha256, result_sha256, policy_sha256, evidence_sha256)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(manifest_sha256, member_index) DO NOTHING`;

export const COMMIT_CROSS_SECTIONAL_MOMENTUM_EVALUATION_MANIFEST_SQL =
  `INSERT INTO cross_sectional_momentum_evaluation_manifest_commits
    (manifest_sha256, committed_at_ms)
   VALUES (?, ?)
   ON CONFLICT(manifest_sha256) DO NOTHING`;

function assertPersistenceTime(
  persistedAtMs: number,
  evidenceEndAtMs: number,
): void {
  if (
    !Number.isSafeInteger(persistedAtMs) ||
    persistedAtMs < evidenceEndAtMs
  ) {
    throw new Error(
      "cross-sectional persistence chronology is invalid",
    );
  }
}

function researchEvidence(plan: CrossSectionalMomentumBacktestPlan) {
  return plan.steps.map((step) => ({
    signalTimestampMs: step.signalTimestampMs,
    executionTimestampMs: step.executionTimestampMs,
    hourlyClosesByPair: step.hourlyClosesByPair,
    markets: step.markets,
    universeMembership: step.universeMembership,
  }));
}

export async function prepareCrossSectionalMomentumResearchRunPersistence<
  Config,
  Result,
>(
  input: CrossSectionalMomentumResearchRunPersistenceInput<
    Config,
    Result
  >,
): Promise<CrossSectionalMomentumPersistenceStatement> {
  await verifyCrossSectionalMomentumResearchRun(
    input.plan,
    input.run,
    input.runner,
  );
  const firstDecisionAtMs =
    input.plan.boundDecisions[0]?.decisionAtMs;
  const lastDecisionAtMs =
    input.plan.boundDecisions.at(-1)?.decisionAtMs;
  if (
    firstDecisionAtMs === undefined ||
    lastDecisionAtMs === undefined
  ) {
    throw new Error("cross-sectional research plan is empty");
  }
  assertPersistenceTime(input.persistedAtMs, lastDecisionAtMs);
  return {
    sql: INSERT_CROSS_SECTIONAL_MOMENTUM_RESEARCH_RUN_SQL,
    params: [
      input.run.runSha256,
      input.run.planSha256,
      input.run.configSha256,
      input.run.resultSha256,
      await sha256CanonicalIntelligence(input.plan.policy),
      await sha256CanonicalIntelligence(researchEvidence(input.plan)),
      input.run.schemaVersion,
      input.run.strategyVersion,
      input.run.engineContract,
      firstDecisionAtMs,
      lastDecisionAtMs,
      input.plan.boundDecisions.length,
      input.plan.steps.length,
      canonicalIntelligenceJson(input.run),
      input.persistedAtMs,
    ],
  };
}

function manifestsMatch(
  expected:
    | CrossSectionalMomentumWalkForwardManifest
    | CrossSectionalMomentumSensitivityManifest,
  supplied:
    | CrossSectionalMomentumWalkForwardManifest
    | CrossSectionalMomentumSensitivityManifest,
): boolean {
  return (
    expected.manifestSha256 === supplied.manifestSha256 &&
    canonicalIntelligenceJson(expected) ===
      canonicalIntelligenceJson(supplied)
  );
}

function walkForwardMembers<Config, Result>(
  input: CrossSectionalMomentumWalkForwardPersistenceInput<
    Config,
    Result
  >,
): readonly EvaluationMember[] {
  const members: EvaluationMember[] = [];
  input.folds.forEach((fold, foldIndex) => {
    const compact = input.manifest.folds[foldIndex]!;
    members.push(
      {
        runSha256: fold.training.run.runSha256,
        planSha256: compact.trainingPlanSha256,
        resultSha256: fold.training.run.resultSha256,
        policySha256: input.manifest.policySha256,
        evidenceSha256: compact.trainingEvidenceSha256,
        memberKind: "training",
        memberIndex: members.length,
      },
      {
        runSha256: fold.validation.run.runSha256,
        planSha256: compact.validationPlanSha256,
        resultSha256: fold.validation.run.resultSha256,
        policySha256: input.manifest.policySha256,
        evidenceSha256: compact.validationEvidenceSha256,
        memberKind: "validation",
        memberIndex: members.length + 1,
      },
    );
  });
  members.push({
    runSha256: input.finalHoldout.run.runSha256,
    planSha256: input.manifest.finalHoldout.planSha256,
    resultSha256: input.finalHoldout.run.resultSha256,
    policySha256: input.manifest.policySha256,
    evidenceSha256: input.manifest.finalHoldout.evidenceSha256,
    memberKind: "final-holdout",
    memberIndex: members.length,
  });
  return members;
}

function sensitivityMembers<Config, Result>(
  input: CrossSectionalMomentumSensitivityPersistenceInput<
    Config,
    Result
  >,
): readonly EvaluationMember[] {
  const variantsByRun = new Map(
    input.variants.map((variant) => [
      variant.run.runSha256,
      variant,
    ]),
  );
  return input.manifest.variants.map((compact, memberIndex) => {
    const variant = variantsByRun.get(compact.runSha256);
    if (variant === undefined) {
      throw new Error(
        "cross-sectional sensitivity member evidence is missing",
      );
    }
    return {
      runSha256: compact.runSha256,
      planSha256: compact.planSha256,
      resultSha256: compact.resultSha256,
      policySha256: compact.policySha256,
      evidenceSha256: input.manifest.evidenceSha256,
      memberKind: "sensitivity-variant",
      memberIndex,
    };
  });
}

export async function prepareCrossSectionalMomentumEvaluationPersistence<
  Config,
  Result,
>(
  input: CrossSectionalMomentumEvaluationPersistenceInput<
    Config,
    Result
  >,
): Promise<readonly CrossSectionalMomentumPersistenceStatement[]> {
  let members: readonly EvaluationMember[];
  let headerParams: readonly D1BindValue[];
  if (input.kind === "walk-forward") {
    const reproduced =
      await prepareCrossSectionalMomentumWalkForwardManifest(
        input.folds,
        input.finalHoldout,
        input.runner,
      );
    if (!manifestsMatch(reproduced, input.manifest)) {
      throw new Error(
        "cross-sectional walk-forward manifest is not reproducible",
      );
    }
    const firstFold = input.manifest.folds[0];
    if (firstFold === undefined) {
      throw new Error(
        "cross-sectional walk-forward manifest is empty",
      );
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
      input.manifest.engineContract,
      input.manifest.policySha256,
      input.manifest.configSha256,
      null,
      firstFold.trainingStartAtMs,
      input.manifest.finalHoldout.endAtMs,
      members.length,
      input.manifest.folds.length,
      null,
      canonicalIntelligenceJson(input.manifest),
      input.persistedAtMs,
    ];
  } else {
    const reproduced =
      await prepareCrossSectionalMomentumSensitivityManifest(
        input.variants,
        input.runner,
      );
    if (!manifestsMatch(reproduced, input.manifest)) {
      throw new Error(
        "cross-sectional sensitivity manifest is not reproducible",
      );
    }
    assertPersistenceTime(
      input.persistedAtMs,
      input.manifest.evaluationEndAtMs,
    );
    members = sensitivityMembers(input);
    headerParams = [
      input.manifest.manifestSha256,
      input.kind,
      input.manifest.schemaVersion,
      input.manifest.strategyVersion,
      input.manifest.engineContract,
      input.manifest.baselinePolicySha256,
      input.manifest.configSha256,
      input.manifest.evidenceSha256,
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
      sql: INSERT_CROSS_SECTIONAL_MOMENTUM_EVALUATION_MANIFEST_SQL,
      params: headerParams,
    },
    ...members.map((member) => ({
      sql: INSERT_CROSS_SECTIONAL_MOMENTUM_EVALUATION_MEMBER_SQL,
      params: [
        input.manifest.manifestSha256,
        member.memberIndex,
        member.memberKind,
        member.runSha256,
        member.planSha256,
        member.resultSha256,
        member.policySha256,
        member.evidenceSha256,
      ],
    })),
    {
      sql: COMMIT_CROSS_SECTIONAL_MOMENTUM_EVALUATION_MANIFEST_SQL,
      params: [
        input.manifest.manifestSha256,
        input.persistedAtMs,
      ],
    },
  ];
}

export class CrossSectionalMomentumResearchRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async persistRun<Config, Result>(
    input: CrossSectionalMomentumResearchRunPersistenceInput<
      Config,
      Result
    >,
  ): Promise<CrossSectionalMomentumResearchRun<Config, Result>> {
    const statement =
      await prepareCrossSectionalMomentumResearchRunPersistence(input);
    await this.#db
      .prepare(statement.sql)
      .bind(...statement.params)
      .run();
    return input.run;
  }

  async persistEvaluation<Config, Result>(
    input: CrossSectionalMomentumEvaluationPersistenceInput<
      Config,
      Result
    >,
  ): Promise<
    | CrossSectionalMomentumWalkForwardManifest
    | CrossSectionalMomentumSensitivityManifest
  > {
    const statements =
      await prepareCrossSectionalMomentumEvaluationPersistence(input);
    await this.#db.batch(
      statements.map((statement) =>
        this.#db.prepare(statement.sql).bind(...statement.params)
      ),
    );
    return input.manifest;
  }
}
