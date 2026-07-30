import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareCrossSectionalMomentumBacktestPlan,
  runCrossSectionalMomentumResearch,
  type CrossSectionalMomentumBacktestFrame,
  type CrossSectionalMomentumBacktestStep,
  type CrossSectionalMomentumUniverseMembership,
} from "../src/backtest/crossSectionalMomentum.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import {
  prepareCrossSectionalMomentumSensitivityManifest,
  prepareCrossSectionalMomentumWalkForwardManifest,
  type CrossSectionalMomentumEvaluationRunInput,
} from "../src/research/crossSectionalMomentumEvaluation.ts";
import {
  CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  type CrossSectionalMomentumPolicy,
  type HourlyClose,
} from "../src/strategies/crossSectionalMomentum.ts";

const HOUR_MS = 3_600_000;
const HISTORY_LENGTH = 721;
const CONFIG = Object.freeze({ initialCashAud: 200 });

interface ResearchResult {
  readonly decisionCount: number;
  readonly membershipSha256s: readonly string[];
  readonly targetPairs: readonly string[];
}

function runner(
  _config: typeof CONFIG,
  steps: readonly CrossSectionalMomentumBacktestStep[],
): ResearchResult {
  return {
    decisionCount: steps.length,
    membershipSha256s: steps.map(
      (step) => step.universeMembership.membershipSha256,
    ),
    targetPairs: steps.flatMap((step) =>
      step.targets.map((target) => target.pair)
    ),
  };
}

function history(
  startHour: number,
  hourlyReturn: number,
): readonly HourlyClose[] {
  return Array.from({ length: HISTORY_LENGTH }, (_, index) => ({
    timestampMs: (startHour + index) * HOUR_MS,
    close: 100 * (1 + hourlyReturn) ** index,
  }));
}

async function membership(
  decisionAtMs: number,
): Promise<CrossSectionalMomentumUniverseMembership> {
  const snapshotSeed = (decisionAtMs / HOUR_MS)
    .toString(16)
    .padStart(64, "a")
    .slice(-64);
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs,
    snapshotAsOfMs: decisionAtMs - HOUR_MS,
    snapshotAvailableAtMs: decisionAtMs,
    snapshotSha256: snapshotSeed,
    signedPolicySha256: "b".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

async function frame(
  startHour: number,
  quoteVolumeAud = 1_000_000,
): Promise<CrossSectionalMomentumBacktestFrame> {
  const decisionAtMs = (startHour + HISTORY_LENGTH) * HOUR_MS;
  const closes = {
    "BTC/AUD": history(startHour, 0.0005),
    "ETH/AUD": history(startHour, 0.001),
  } as const;
  return {
    membership: await membership(decisionAtMs),
    hourlyClosesByPair: closes,
    executionTimestampMs: decisionAtMs + HOUR_MS,
    markets: ["BTC/AUD", "ETH/AUD"].map((pair) => ({
      pair,
      midPriceAud:
        closes[pair as keyof typeof closes].at(-1)!.close,
      spreadBps: 5,
      availableQuoteVolumeAud: quoteVolumeAud,
    })),
    executionStyle: "taker",
  };
}

async function evaluationRun(
  startHour: number,
  policy: CrossSectionalMomentumPolicy =
    CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  quoteVolumeAud = 1_000_000,
): Promise<
  CrossSectionalMomentumEvaluationRunInput<
    typeof CONFIG,
    ResearchResult
  >
> {
  const plan = await prepareCrossSectionalMomentumBacktestPlan(
    [await frame(startHour, quoteVolumeAud)],
    policy,
  );
  return {
    plan,
    run: await runCrossSectionalMomentumResearch(
      CONFIG,
      plan,
      runner,
    ),
  };
}

test("binds ordered walk-forward folds and a later final holdout", async () => {
  const manifest =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      [
        {
          foldIndex: 0,
          training: await evaluationRun(0),
          validation: await evaluationRun(2),
        },
        {
          foldIndex: 1,
          training: await evaluationRun(4),
          validation: await evaluationRun(6),
        },
      ],
      await evaluationRun(8),
      runner,
    );
  assert.equal(manifest.folds.length, 2);
  assert.equal(
    manifest.finalHoldout.startAtMs,
    (8 + HISTORY_LENGTH) * HOUR_MS,
  );
  assert.match(
    manifest.finalHoldout.evidenceSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(manifest.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.equal(manifest.candidateStatus, "research-only-unselected");
  assert.equal(manifest.executionAuthority, "none");
  assert.equal("selectedRunSha256" in manifest, false);
});

test("walk-forward identity is deterministic and rejects reused evidence", async () => {
  const fold = {
    foldIndex: 0,
    training: await evaluationRun(0),
    validation: await evaluationRun(2),
  };
  const holdout = await evaluationRun(4);
  const first =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      [fold],
      holdout,
      runner,
    );
  const second =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      [{ ...fold }],
      holdout,
      runner,
    );
  assert.equal(first.manifestSha256, second.manifestSha256);
  await assert.rejects(
    prepareCrossSectionalMomentumWalkForwardManifest(
      [{ foldIndex: 0, training: fold.training, validation: holdout }],
      fold.training,
      runner,
    ),
    /final holdout chronology or identity is invalid/u,
  );
});

test("sensitivity binds exact evidence without ranking or selection", async () => {
  const variantPolicy: CrossSectionalMomentumPolicy = {
    ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
    minimumHoldHours: 48,
  };
  const variant = await evaluationRun(0, variantPolicy);
  const baseline = await evaluationRun(0);
  const first =
    await prepareCrossSectionalMomentumSensitivityManifest(
      [variant, baseline],
      runner,
    );
  const second =
    await prepareCrossSectionalMomentumSensitivityManifest(
      [baseline, variant],
      runner,
    );
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.variants.length, 2);
  assert.equal(
    first.variants.filter(
      (item) =>
        item.policySha256 === first.baselinePolicySha256,
    ).length,
    1,
  );
  assert.equal("selectedPolicySha256" in first, false);
  assert.equal("ranking" in first, false);
  assert.equal(first.selectionAuthority, "none");
});

test("sensitivity fails closed when market evidence differs", async () => {
  await assert.rejects(
    prepareCrossSectionalMomentumSensitivityManifest(
      [
        await evaluationRun(0),
        await evaluationRun(
          0,
          {
            ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
            rotationScoreLead: 0.06,
          },
          900_000,
        ),
      ],
      runner,
    ),
    /share exact configuration and evidence/u,
  );
});
