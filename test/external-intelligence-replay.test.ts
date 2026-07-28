import assert from "node:assert/strict";
import test from "node:test";
import {
  bindExternalIntelligenceReplayToBacktestSteps,
  evaluateExternalIntelligenceBacktestGate,
  prepareExternalIntelligenceBacktestReplay,
  runExternalIntelligenceBacktestComparison,
  type ExternalIntelligenceReplayPolicy,
  type ExternalIntelligenceReplaySnapshot,
} from "../src/backtest/externalIntelligenceReplay.ts";
import { runBacktest } from "../src/backtest/engine.ts";
import type {
  BacktestConfig,
  BacktestMarket,
  BacktestStep,
} from "../src/backtest/types.ts";
import {
  prepareIntegratedExternalIntelligenceAssessments,
} from "../src/intelligence/externalIntelligenceAssessmentIntegration.ts";
import type {
  ExternalIntelligenceItem,
  ExternalIntelligencePolicy,
} from "../src/intelligence/externalIntelligence.ts";
import { prepareExternalIntelligenceLinkage } from "../src/intelligence/externalIntelligenceLinking.ts";
import {
  createPermittedContentFingerprint,
  prepareExternalIntelligenceManipulationEvidence,
} from "../src/intelligence/externalIntelligenceManipulation.ts";
import { sha256Hex } from "../src/utils/crypto.ts";

const HOUR_MS = 3_600_000;
const DECISION_HOUR = Date.parse("2026-07-29T03:00:00.000Z");
const ASSESSMENT_POLICY: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": 86_400_000,
    regulator: 86_400_000,
    issuer: 86_400_000,
    "mainstream-news": 86_400_000,
    "specialist-news": 86_400_000,
    reddit: HOUR_MS,
  },
  maximumReceiptDelayMs: HOUR_MS,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 7_000,
  maximumItems: 20,
};
const REPLAY_POLICY: ExternalIntelligenceReplayPolicy = {
  maximumReactionAgeMs: {
    ignore: 0,
    watch: HOUR_MS,
    "research-candidate": 24 * HOUR_MS,
    "pause-new-risk": HOUR_MS,
  },
  maximumSnapshots: 20,
};
const MANIPULATION_POLICY = {
  minimumNearDuplicateSimilarityBps: 7_500,
  maximumNearDuplicatePublicationSkewMs: HOUR_MS,
  rapidRepostWindowMs: 300_000,
  minimumRapidRepostPublishers: 2,
} as const;

const BACKTEST_CONFIG: BacktestConfig = {
  initialCashAud: 200,
  defaultExitStyle: "taker",
  assumptions: {
    makerFeeBps: 0,
    takerFeeBps: 0,
    takerSlippageBps: 0,
    makerAdverseSelectionBps: 0,
    impactCoefficientBps: 0,
    maximumImpactBps: 0,
    maximumParticipationRate: 1,
    makerFillRate: 1,
    minimumOrderAud: 0,
    cashReserveAud: 0,
  },
};

function market(
  pair: string,
  midPriceAud: number,
): BacktestMarket {
  return {
    pair,
    midPriceAud,
    spreadBps: 0,
    availableQuoteVolumeAud: 1_000_000,
  };
}

function backtestStep(
  signalTimestampMs: number,
  targets: BacktestStep["targets"],
): BacktestStep {
  return {
    signalTimestampMs,
    executionTimestampMs: signalTimestampMs + HOUR_MS,
    markets: [market("BTC/AUD", 100)],
    targets,
  };
}

async function item(
  id: string,
  sourceKind: ExternalIntelligenceItem["sourceKind"],
  eventType: ExternalIntelligenceItem["eventType"],
  stance: ExternalIntelligenceItem["stance"],
  publishedAtMs: number,
  receivedAtMs: number,
  availableAtMs: number,
): Promise<ExternalIntelligenceItem> {
  return {
    itemId: id,
    sourceId: `source-${id}`,
    sourceKind,
    authority:
      sourceKind === "official-exchange"
        ? "authoritative"
        : sourceKind === "reddit"
          ? "social"
          : "reputable",
    publisherId: `publisher-${id}`,
    sourceRef: `https://${id}.example/event`,
    externalId: `external-${id}`,
    acquisitionMode: "minute-poll",
    topicKey: "BTC.EVENT",
    assetSymbols: ["BTC"],
    eventType,
    stance,
    publishedAtMs,
    receivedAtMs,
    availableAtMs,
    payloadSha256: "a".repeat(64),
    contentSha256: await sha256Hex(
      `permitted external intelligence evidence item ${id}`,
    ),
    credibilityBps: 9_000,
    confidenceBps: 9_000,
    contentPolicy: "permitted-excerpt",
    modelTrainingAllowed: false,
  };
}

async function snapshot(
  assessedAtMs: number,
  items: readonly ExternalIntelligenceItem[],
): Promise<ExternalIntelligenceReplaySnapshot> {
  const linkedAtMs = assessedAtMs - 2_000;
  const analysedAtMs = assessedAtMs - 1_000;
  const linkage = await prepareExternalIntelligenceLinkage({
    linkedAtMs,
    topicRules: [
      {
        topicKey: "BTC.EVENT",
        entityKeys: ["BTC"],
        tradable: true,
        allowedEventTypes: ["partnership", "security-incident"],
      },
    ],
    items,
    corrections: [],
  });
  const fingerprints = await Promise.all(
    items.map((value) =>
      createPermittedContentFingerprint({
        item: value,
        permittedContent:
          `permitted external intelligence evidence item ${value.itemId}`,
        fingerprintedAtMs: linkedAtMs + 500,
      }),
    ),
  );
  const manipulationEvidence =
    await prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs,
      linkage,
      policy: MANIPULATION_POLICY,
      fingerprints,
    });
  const integrations = await prepareIntegratedExternalIntelligenceAssessments({
    assessedAtMs,
    linkage,
    manipulationEvidence,
    policy: ASSESSMENT_POLICY,
  });
  return { assessedAtMs, linkage, manipulationEvidence, integrations };
}

test("uses an assessment only at or after its exact availability boundary", async () => {
  const assessedAtMs = DECISION_HOUR;
  const risk = await item(
    "risk",
    "official-exchange",
    "security-incident",
    "negative",
    assessedAtMs - 60_000,
    assessedAtMs - 40_000,
    assessedAtMs - 20_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR - HOUR_MS, DECISION_HOUR],
    snapshots: [await snapshot(assessedAtMs, [risk])],
    policy: REPLAY_POLICY,
  });
  assert.equal(replay.frames[0]?.selectedSnapshotSha256, null);
  assert.equal(replay.frames[1]?.activePauseNewRiskSha256s.length, 1);
});

test("preserves publication, receipt, availability and assessment latency", async () => {
  const assessedAtMs = DECISION_HOUR;
  const risk = await item(
    "latency",
    "official-exchange",
    "security-incident",
    "negative",
    assessedAtMs - 120_000,
    assessedAtMs - 90_000,
    assessedAtMs - 30_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR],
    snapshots: [await snapshot(assessedAtMs, [risk])],
    policy: REPLAY_POLICY,
  });
  assert.deepEqual(replay.frames[0]?.latency, {
    earliestPublishedAtMs: assessedAtMs - 120_000,
    latestReceivedAtMs: assessedAtMs - 90_000,
    latestAvailableAtMs: assessedAtMs - 30_000,
    maximumPublicationToReceiptMs: 30_000,
    maximumReceiptToAvailabilityMs: 60_000,
    maximumAvailabilityToAssessmentMs: 30_000,
    maximumPublicationToAssessmentMs: 120_000,
  });
});

test("a later complete snapshot cannot rewrite an earlier decision", async () => {
  const firstAssessment = DECISION_HOUR;
  const secondAssessment = DECISION_HOUR + HOUR_MS;
  const risk = await item(
    "risk",
    "official-exchange",
    "security-incident",
    "negative",
    firstAssessment - 60_000,
    firstAssessment - 40_000,
    firstAssessment - 20_000,
  );
  const positiveOne = await item(
    "positive-one",
    "mainstream-news",
    "partnership",
    "positive",
    secondAssessment - 60_000,
    secondAssessment - 40_000,
    secondAssessment - 20_000,
  );
  const positiveTwo = await item(
    "positive-two",
    "mainstream-news",
    "partnership",
    "positive",
    secondAssessment - 50_000,
    secondAssessment - 30_000,
    secondAssessment - 10_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [firstAssessment, secondAssessment],
    snapshots: [
      await snapshot(secondAssessment, [positiveOne, positiveTwo]),
      await snapshot(firstAssessment, [risk]),
    ],
    policy: REPLAY_POLICY,
  });
  assert.equal(replay.frames[0]?.activePauseNewRiskSha256s.length, 1);
  assert.equal(replay.frames[0]?.activeResearchCandidateSha256s.length, 0);
  assert.equal(replay.frames[1]?.activePauseNewRiskSha256s.length, 0);
  assert.equal(replay.frames[1]?.activeResearchCandidateSha256s.length, 1);
});

test("pause blocks additions, preserves exits and never promotes research candidates", async () => {
  const assessedAtMs = DECISION_HOUR;
  const risk = await item(
    "risk",
    "official-exchange",
    "security-incident",
    "negative",
    assessedAtMs - 60_000,
    assessedAtMs - 40_000,
    assessedAtMs - 20_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR],
    snapshots: [await snapshot(assessedAtMs, [risk])],
    policy: REPLAY_POLICY,
  });
  const frame = replay.frames[0];
  assert.ok(frame);
  assert.equal(
    evaluateExternalIntelligenceBacktestGate("new-risk", frame).allowed,
    false,
  );
  assert.equal(
    evaluateExternalIntelligenceBacktestGate("increase-risk", frame).allowed,
    false,
  );
  assert.equal(
    evaluateExternalIntelligenceBacktestGate("reduce-risk", frame).allowed,
    true,
  );
  assert.equal(
    evaluateExternalIntelligenceBacktestGate("exit", frame).allowed,
    true,
  );
});

test("is deterministic across snapshot input order and expires stale reactions", async () => {
  const firstAssessment = DECISION_HOUR - 2 * HOUR_MS;
  const secondAssessment = DECISION_HOUR;
  const first = await item(
    "first",
    "official-exchange",
    "security-incident",
    "negative",
    firstAssessment - 60_000,
    firstAssessment - 40_000,
    firstAssessment - 20_000,
  );
  const second = await item(
    "second",
    "official-exchange",
    "security-incident",
    "negative",
    secondAssessment - 60_000,
    secondAssessment - 40_000,
    secondAssessment - 20_000,
  );
  const snapshots = [
    await snapshot(firstAssessment, [first]),
    await snapshot(secondAssessment, [second]),
  ];
  const input = {
    decisionTimestampsMs: [DECISION_HOUR, DECISION_HOUR + 2 * HOUR_MS],
    policy: REPLAY_POLICY,
  };
  const ordered = await prepareExternalIntelligenceBacktestReplay({
    ...input,
    snapshots,
  });
  const reversed = await prepareExternalIntelligenceBacktestReplay({
    ...input,
    snapshots: [...snapshots].reverse(),
  });
  assert.equal(ordered.replaySha256, reversed.replaySha256);
  assert.equal(ordered.frames[1]?.activePauseNewRiskSha256s.length, 0);
  assert.equal(ordered.frames[1]?.expiredIntegrationSha256s.length, 1);
});

test("fails closed on tampering, future availability and duplicate snapshot times", async () => {
  const assessedAtMs = DECISION_HOUR;
  const risk = await item(
    "risk",
    "official-exchange",
    "security-incident",
    "negative",
    assessedAtMs - 60_000,
    assessedAtMs - 40_000,
    assessedAtMs - 20_000,
  );
  const valid = await snapshot(assessedAtMs, [risk]);
  const tampered = {
    ...valid,
    integrations: valid.integrations.map((integration) => ({
      ...integration,
      effectiveReaction: "watch" as const,
    })),
  };
  await assert.rejects(
    prepareExternalIntelligenceBacktestReplay({
      decisionTimestampsMs: [DECISION_HOUR],
      snapshots: [tampered],
      policy: REPLAY_POLICY,
    }),
    /digest does not match/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceBacktestReplay({
      decisionTimestampsMs: [DECISION_HOUR],
      snapshots: [valid, valid],
      policy: REPLAY_POLICY,
    }),
    /unique assessment times/u,
  );

  const late = {
    ...valid,
    manipulationEvidence: {
      ...valid.manipulationEvidence,
      representativeItems:
        valid.manipulationEvidence.representativeItems.map((value) => ({
          ...value,
          availableAtMs: valid.linkage.linkedAtMs + 1,
        })),
    },
  };
  await assert.rejects(
    prepareExternalIntelligenceBacktestReplay({
      decisionTimestampsMs: [DECISION_HOUR],
      snapshots: [late],
      policy: REPLAY_POLICY,
    }),
    /digest does not match|availability chronology/u,
  );
});

test("binds every request to its exact frame and blocks paused buys before fills", async () => {
  const risk = await item(
    "execution-risk",
    "official-exchange",
    "security-incident",
    "negative",
    DECISION_HOUR - 60_000,
    DECISION_HOUR - 40_000,
    DECISION_HOUR - 20_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR],
    snapshots: [await snapshot(DECISION_HOUR, [risk])],
    policy: REPLAY_POLICY,
  });
  const comparison = await runExternalIntelligenceBacktestComparison(
    BACKTEST_CONFIG,
    [
      backtestStep(DECISION_HOUR, [
        {
          pair: "BTC/AUD",
          targetWeight: 1,
          executionStyle: "taker",
        },
      ]),
    ],
    replay,
  );
  assert.equal(comparison.baselineResult.executions.length, 1);
  assert.equal(comparison.intelligenceGatedResult.executions.length, 0);
  assert.equal(comparison.suppressedRequestCount, 1);
  assert.equal(comparison.suppressedRequestedNotionalAud, 200);
  assert.equal(
    comparison.intelligenceGatedResult.suppressedExecutions[0]?.frameSha256,
    replay.frames[0]?.frameSha256,
  );
  assert.equal(
    comparison.intelligenceGatedResult.suppressedExecutions[0]
      ?.pauseEvidenceSha256s[0],
    replay.frames[0]?.activePauseNewRiskSha256s[0],
  );
  assert.match(comparison.comparisonSha256, /^[0-9a-f]{64}$/u);
});

test("preserves an exit while a fresh pause is active", async () => {
  const risk = await item(
    "exit-risk",
    "official-exchange",
    "security-incident",
    "negative",
    DECISION_HOUR - 60_000,
    DECISION_HOUR - 40_000,
    DECISION_HOUR - 20_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR - HOUR_MS, DECISION_HOUR],
    snapshots: [await snapshot(DECISION_HOUR, [risk])],
    policy: REPLAY_POLICY,
  });
  const comparison = await runExternalIntelligenceBacktestComparison(
    BACKTEST_CONFIG,
    [
      backtestStep(DECISION_HOUR - HOUR_MS, [
        {
          pair: "BTC/AUD",
          targetWeight: 1,
          executionStyle: "taker",
        },
      ]),
      backtestStep(DECISION_HOUR, []),
    ],
    replay,
  );
  assert.deepEqual(
    comparison.intelligenceGatedResult.executions.map(
      (execution) => execution.side,
    ),
    ["buy", "sell"],
  );
  assert.equal(
    comparison.intelligenceGatedResult.suppressedExecutions.length,
    0,
  );
  assert.equal(
    comparison.intelligenceGatedResult.finalPositions.length,
    0,
  );
});

test("blocks a paused increase after a partial fill", async () => {
  const risk = await item(
    "increase-risk",
    "official-exchange",
    "security-incident",
    "negative",
    DECISION_HOUR - 60_000,
    DECISION_HOUR - 40_000,
    DECISION_HOUR - 20_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR - HOUR_MS, DECISION_HOUR],
    snapshots: [await snapshot(DECISION_HOUR, [risk])],
    policy: REPLAY_POLICY,
  });
  const config: BacktestConfig = {
    ...BACKTEST_CONFIG,
    assumptions: {
      ...BACKTEST_CONFIG.assumptions,
      makerFillRate: 0.25,
    },
  };
  const comparison = await runExternalIntelligenceBacktestComparison(
    config,
    [
      backtestStep(DECISION_HOUR - HOUR_MS, [
        {
          pair: "BTC/AUD",
          targetWeight: 1,
          executionStyle: "maker",
        },
      ]),
      backtestStep(DECISION_HOUR, [
        {
          pair: "BTC/AUD",
          targetWeight: 1,
          executionStyle: "maker",
        },
      ]),
    ],
    replay,
  );
  assert.equal(
    comparison.intelligenceGatedResult.executions[0]
      ?.filledReferenceNotionalAud,
    50,
  );
  assert.equal(
    comparison.intelligenceGatedResult.suppressedExecutions[0]
      ?.requestedNotionalAud,
    150,
  );
  assert.equal(
    comparison.intelligenceGatedResult.executions.length,
    1,
  );
});

test("research candidates remain measurable and cannot suppress or add exposure", async () => {
  const positiveOne = await item(
    "candidate-one",
    "mainstream-news",
    "partnership",
    "positive",
    DECISION_HOUR - 60_000,
    DECISION_HOUR - 40_000,
    DECISION_HOUR - 20_000,
  );
  const positiveTwo = await item(
    "candidate-two",
    "mainstream-news",
    "partnership",
    "positive",
    DECISION_HOUR - 50_000,
    DECISION_HOUR - 30_000,
    DECISION_HOUR - 10_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR],
    snapshots: [
      await snapshot(DECISION_HOUR, [positiveOne, positiveTwo]),
    ],
    policy: REPLAY_POLICY,
  });
  const comparison = await runExternalIntelligenceBacktestComparison(
    BACKTEST_CONFIG,
    [backtestStep(DECISION_HOUR, [])],
    replay,
  );
  assert.equal(comparison.researchCandidateFrameCount, 1);
  assert.equal(comparison.suppressedRequestCount, 0);
  assert.equal(
    comparison.intelligenceGatedResult.executions.length,
    0,
  );
  assert.equal(comparison.baselineResult.executions.length, 0);
});

test("rejects replay tampering, signal mismatch and incomplete gate coverage", async () => {
  const risk = await item(
    "invalid-risk",
    "official-exchange",
    "security-incident",
    "negative",
    DECISION_HOUR - 60_000,
    DECISION_HOUR - 40_000,
    DECISION_HOUR - 20_000,
  );
  const replay = await prepareExternalIntelligenceBacktestReplay({
    decisionTimestampsMs: [DECISION_HOUR],
    snapshots: [await snapshot(DECISION_HOUR, [risk])],
    policy: REPLAY_POLICY,
  });
  const tampered = {
    ...replay,
    frames: replay.frames.map((frame) => ({
      ...frame,
      activePauseNewRiskSha256s: [],
    })),
  };
  await assert.rejects(
    bindExternalIntelligenceReplayToBacktestSteps(
      [backtestStep(DECISION_HOUR, [])],
      tampered,
    ),
    /classifications|digest does not match/u,
  );
  await assert.rejects(
    bindExternalIntelligenceReplayToBacktestSteps(
      [backtestStep(DECISION_HOUR - HOUR_MS, [])],
      replay,
    ),
    /does not match backtest signal time/u,
  );

  const [gated] = await bindExternalIntelligenceReplayToBacktestSteps(
    [backtestStep(DECISION_HOUR, [])],
    replay,
  );
  assert.ok(gated);
  assert.throws(
    () =>
      runBacktest(BACKTEST_CONFIG, [
        gated,
        backtestStep(DECISION_HOUR + HOUR_MS, []),
      ]),
    /must cover every backtest step/u,
  );
});
