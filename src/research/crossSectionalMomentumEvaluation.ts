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
  CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
  type CrossSectionalMomentumPolicy,
} from "../strategies/crossSectionalMomentum.ts";

const MAXIMUM_WALK_FORWARD_FOLDS = 50;
const MAXIMUM_SENSITIVITY_VARIANTS = 100;

export interface CrossSectionalMomentumEvaluationRunInput<
  Config,
  Result,
> {
  readonly plan: CrossSectionalMomentumBacktestPlan;
  readonly run: CrossSectionalMomentumResearchRun<Config, Result>;
}

export interface CrossSectionalMomentumWalkForwardFoldInput<
  Config,
  Result,
> {
  readonly foldIndex: number;
  readonly training:
    CrossSectionalMomentumEvaluationRunInput<Config, Result>;
  readonly validation:
    CrossSectionalMomentumEvaluationRunInput<Config, Result>;
}

export interface CrossSectionalMomentumWalkForwardFold {
  readonly foldIndex: number;
  readonly trainingPlanSha256: string;
  readonly trainingRunSha256: string;
  readonly trainingEvidenceSha256: string;
  readonly trainingStartAtMs: number;
  readonly trainingEndAtMs: number;
  readonly validationPlanSha256: string;
  readonly validationRunSha256: string;
  readonly validationEvidenceSha256: string;
  readonly validationStartAtMs: number;
  readonly validationEndAtMs: number;
}

export interface CrossSectionalMomentumHoldoutEvidence {
  readonly planSha256: string;
  readonly runSha256: string;
  readonly evidenceSha256: string;
  readonly startAtMs: number;
  readonly endAtMs: number;
}

export interface CrossSectionalMomentumWalkForwardManifest {
  readonly schemaVersion:
    "cross-sectional-momentum-walk-forward-manifest-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly engineContract: "run-universe-bound-backtest-v1";
  readonly policySha256: string;
  readonly configSha256: string;
  readonly folds: readonly CrossSectionalMomentumWalkForwardFold[];
  readonly finalHoldout: CrossSectionalMomentumHoldoutEvidence;
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly manifestSha256: string;
}

export interface CrossSectionalMomentumSensitivityVariant {
  readonly policy: CrossSectionalMomentumPolicy;
  readonly policySha256: string;
  readonly planSha256: string;
  readonly runSha256: string;
  readonly resultSha256: string;
}

export interface CrossSectionalMomentumSensitivityManifest {
  readonly schemaVersion:
    "cross-sectional-momentum-sensitivity-manifest-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly engineContract: "run-universe-bound-backtest-v1";
  readonly baselinePolicySha256: string;
  readonly configSha256: string;
  readonly evidenceSha256: string;
  readonly evaluationStartAtMs: number;
  readonly evaluationEndAtMs: number;
  readonly decisionCount: number;
  readonly variants:
    readonly CrossSectionalMomentumSensitivityVariant[];
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly manifestSha256: string;
}

interface VerifiedEvaluationRun {
  readonly startAtMs: number;
  readonly endAtMs: number;
  readonly count: number;
  readonly evidenceSha256: string;
}

function researchEvidence(
  plan: CrossSectionalMomentumBacktestPlan,
) {
  return plan.steps.map((step) => ({
    signalTimestampMs: step.signalTimestampMs,
    executionTimestampMs: step.executionTimestampMs,
    hourlyClosesByPair: step.hourlyClosesByPair,
    markets: step.markets,
    universeMembership: step.universeMembership,
  }));
}

async function verifyEvaluationRun<Config, Result>(
  input: CrossSectionalMomentumEvaluationRunInput<Config, Result>,
  runner: RunUniverseBoundBacktest<Config, Result>,
): Promise<VerifiedEvaluationRun> {
  await verifyCrossSectionalMomentumResearchRun(
    input.plan,
    input.run,
    runner,
  );
  const startAtMs =
    input.plan.boundDecisions[0]?.decisionAtMs;
  const endAtMs =
    input.plan.boundDecisions.at(-1)?.decisionAtMs;
  if (startAtMs === undefined || endAtMs === undefined) {
    throw new Error("cross-sectional evaluation plan is empty");
  }
  return {
    startAtMs,
    endAtMs,
    count: input.plan.boundDecisions.length,
    evidenceSha256: await sha256CanonicalIntelligence(
      researchEvidence(input.plan),
    ),
  };
}

function walkForwardEnvelope(
  manifest: Omit<
    CrossSectionalMomentumWalkForwardManifest,
    "manifestSha256"
  >,
) {
  return {
    schemaVersion: manifest.schemaVersion,
    strategyVersion: manifest.strategyVersion,
    engineContract: manifest.engineContract,
    policySha256: manifest.policySha256,
    configSha256: manifest.configSha256,
    folds: manifest.folds,
    finalHoldout: manifest.finalHoldout,
    candidateStatus: manifest.candidateStatus,
    runtimeScopeChanged: manifest.runtimeScopeChanged,
    selectionAuthority: manifest.selectionAuthority,
    activationAuthority: manifest.activationAuthority,
    executionAuthority: manifest.executionAuthority,
  } as const;
}

function sensitivityEnvelope(
  manifest: Omit<
    CrossSectionalMomentumSensitivityManifest,
    "manifestSha256"
  >,
) {
  return {
    schemaVersion: manifest.schemaVersion,
    strategyVersion: manifest.strategyVersion,
    engineContract: manifest.engineContract,
    baselinePolicySha256: manifest.baselinePolicySha256,
    configSha256: manifest.configSha256,
    evidenceSha256: manifest.evidenceSha256,
    evaluationStartAtMs: manifest.evaluationStartAtMs,
    evaluationEndAtMs: manifest.evaluationEndAtMs,
    decisionCount: manifest.decisionCount,
    variants: manifest.variants,
    candidateStatus: manifest.candidateStatus,
    runtimeScopeChanged: manifest.runtimeScopeChanged,
    selectionAuthority: manifest.selectionAuthority,
    activationAuthority: manifest.activationAuthority,
    executionAuthority: manifest.executionAuthority,
  } as const;
}

export async function prepareCrossSectionalMomentumWalkForwardManifest<
  Config,
  Result,
>(
  folds:
    readonly CrossSectionalMomentumWalkForwardFoldInput<
      Config,
      Result
    >[],
  finalHoldout:
    CrossSectionalMomentumEvaluationRunInput<Config, Result>,
  runner: RunUniverseBoundBacktest<Config, Result>,
): Promise<CrossSectionalMomentumWalkForwardManifest> {
  if (
    folds.length < 1 ||
    folds.length > MAXIMUM_WALK_FORWARD_FOLDS
  ) {
    throw new Error(
      "cross-sectional walk-forward folds are empty or unbounded",
    );
  }

  const compactFolds: CrossSectionalMomentumWalkForwardFold[] = [];
  const runSha256s = new Set<string>();
  let expectedPolicyJson: string | undefined;
  let expectedConfigSha256: string | undefined;
  let previousTrainingStartAtMs: number | undefined;
  let previousTrainingEndAtMs: number | undefined;
  let previousValidationEndAtMs: number | undefined;

  for (let index = 0; index < folds.length; index += 1) {
    const fold = folds[index]!;
    if (fold.foldIndex !== index) {
      throw new Error(
        "cross-sectional walk-forward fold indexes must be contiguous",
      );
    }
    const training = await verifyEvaluationRun(
      fold.training,
      runner,
    );
    const validation = await verifyEvaluationRun(
      fold.validation,
      runner,
    );
    const policyJson = canonicalIntelligenceJson(
      fold.training.plan.policy,
    );
    if (
      policyJson !==
        canonicalIntelligenceJson(fold.validation.plan.policy) ||
      (expectedPolicyJson !== undefined &&
        policyJson !== expectedPolicyJson) ||
      fold.training.run.configSha256 !==
        fold.validation.run.configSha256 ||
      (expectedConfigSha256 !== undefined &&
        fold.training.run.configSha256 !==
          expectedConfigSha256) ||
      training.endAtMs >= validation.startAtMs ||
      (previousTrainingStartAtMs !== undefined &&
        training.startAtMs < previousTrainingStartAtMs) ||
      (previousTrainingEndAtMs !== undefined &&
        training.endAtMs <= previousTrainingEndAtMs) ||
      (previousValidationEndAtMs !== undefined &&
        validation.startAtMs <= previousValidationEndAtMs)
    ) {
      throw new Error(
        "cross-sectional walk-forward chronology or identity is invalid",
      );
    }
    for (const runSha256 of [
      fold.training.run.runSha256,
      fold.validation.run.runSha256,
    ]) {
      if (runSha256s.has(runSha256)) {
        throw new Error(
          "cross-sectional walk-forward runs cannot be reused",
        );
      }
      runSha256s.add(runSha256);
    }
    compactFolds.push({
      foldIndex: fold.foldIndex,
      trainingPlanSha256: fold.training.plan.planSha256,
      trainingRunSha256: fold.training.run.runSha256,
      trainingEvidenceSha256: training.evidenceSha256,
      trainingStartAtMs: training.startAtMs,
      trainingEndAtMs: training.endAtMs,
      validationPlanSha256: fold.validation.plan.planSha256,
      validationRunSha256: fold.validation.run.runSha256,
      validationEvidenceSha256: validation.evidenceSha256,
      validationStartAtMs: validation.startAtMs,
      validationEndAtMs: validation.endAtMs,
    });
    expectedPolicyJson = policyJson;
    expectedConfigSha256 = fold.training.run.configSha256;
    previousTrainingStartAtMs = training.startAtMs;
    previousTrainingEndAtMs = training.endAtMs;
    previousValidationEndAtMs = validation.endAtMs;
  }

  const holdout = await verifyEvaluationRun(finalHoldout, runner);
  if (
    expectedPolicyJson === undefined ||
    expectedConfigSha256 === undefined ||
    canonicalIntelligenceJson(finalHoldout.plan.policy) !==
      expectedPolicyJson ||
    finalHoldout.run.configSha256 !== expectedConfigSha256 ||
    previousValidationEndAtMs === undefined ||
    holdout.startAtMs <= previousValidationEndAtMs ||
    runSha256s.has(finalHoldout.run.runSha256)
  ) {
    throw new Error(
      "cross-sectional final holdout chronology or identity is invalid",
    );
  }

  const envelope = {
    schemaVersion:
      "cross-sectional-momentum-walk-forward-manifest-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    engineContract: "run-universe-bound-backtest-v1",
    policySha256: await sha256CanonicalIntelligence(
      finalHoldout.plan.policy,
    ),
    configSha256: expectedConfigSha256,
    folds: compactFolds,
    finalHoldout: {
      planSha256: finalHoldout.plan.planSha256,
      runSha256: finalHoldout.run.runSha256,
      evidenceSha256: holdout.evidenceSha256,
      startAtMs: holdout.startAtMs,
      endAtMs: holdout.endAtMs,
    },
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
  } as const;
  return {
    ...envelope,
    manifestSha256: await sha256CanonicalIntelligence(
      walkForwardEnvelope(envelope),
    ),
  };
}

export async function prepareCrossSectionalMomentumSensitivityManifest<
  Config,
  Result,
>(
  variants:
    readonly CrossSectionalMomentumEvaluationRunInput<
      Config,
      Result
    >[],
  runner: RunUniverseBoundBacktest<Config, Result>,
): Promise<CrossSectionalMomentumSensitivityManifest> {
  if (
    variants.length < 2 ||
    variants.length > MAXIMUM_SENSITIVITY_VARIANTS
  ) {
    throw new Error(
      "cross-sectional sensitivity variants are insufficient or unbounded",
    );
  }

  const baselinePolicySha256 =
    await sha256CanonicalIntelligence(
      CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
    );
  let expectedConfigSha256: string | undefined;
  let expectedEvidence: VerifiedEvaluationRun | undefined;
  const compactVariants:
    CrossSectionalMomentumSensitivityVariant[] = [];

  for (const variant of variants) {
    const evidence = await verifyEvaluationRun(variant, runner);
    if (
      (expectedConfigSha256 !== undefined &&
        variant.run.configSha256 !== expectedConfigSha256) ||
      (expectedEvidence !== undefined &&
        (evidence.startAtMs !== expectedEvidence.startAtMs ||
          evidence.endAtMs !== expectedEvidence.endAtMs ||
          evidence.count !== expectedEvidence.count ||
          evidence.evidenceSha256 !==
            expectedEvidence.evidenceSha256))
    ) {
      throw new Error(
        "cross-sectional sensitivity variants must share exact configuration and evidence",
      );
    }
    compactVariants.push({
      policy: variant.plan.policy,
      policySha256: await sha256CanonicalIntelligence(
        variant.plan.policy,
      ),
      planSha256: variant.plan.planSha256,
      runSha256: variant.run.runSha256,
      resultSha256: variant.run.resultSha256,
    });
    expectedConfigSha256 = variant.run.configSha256;
    expectedEvidence = evidence;
  }

  compactVariants.sort((left, right) =>
    left.policySha256.localeCompare(right.policySha256),
  );
  const policySha256s = compactVariants.map(
    (variant) => variant.policySha256,
  );
  const runSha256s = compactVariants.map(
    (variant) => variant.runSha256,
  );
  if (
    new Set(policySha256s).size !== policySha256s.length ||
    compactVariants.filter(
      (variant) =>
        variant.policySha256 === baselinePolicySha256,
    ).length !== 1
  ) {
    throw new Error(
      "cross-sectional sensitivity policies must be unique and include one baseline",
    );
  }
  if (new Set(runSha256s).size !== runSha256s.length) {
    throw new Error(
      "cross-sectional sensitivity runs cannot be reused",
    );
  }
  if (
    expectedConfigSha256 === undefined ||
    expectedEvidence === undefined
  ) {
    throw new Error(
      "cross-sectional sensitivity evidence is incomplete",
    );
  }

  const envelope = {
    schemaVersion:
      "cross-sectional-momentum-sensitivity-manifest-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    engineContract: "run-universe-bound-backtest-v1",
    baselinePolicySha256,
    configSha256: expectedConfigSha256,
    evidenceSha256: expectedEvidence.evidenceSha256,
    evaluationStartAtMs: expectedEvidence.startAtMs,
    evaluationEndAtMs: expectedEvidence.endAtMs,
    decisionCount: expectedEvidence.count,
    variants: compactVariants,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
  } as const;
  return {
    ...envelope,
    manifestSha256: await sha256CanonicalIntelligence(
      sensitivityEnvelope(envelope),
    ),
  };
}
