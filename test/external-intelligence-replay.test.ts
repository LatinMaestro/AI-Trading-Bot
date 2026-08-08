import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateExternalIntelligenceBacktestGate,
  prepareExternalIntelligenceBacktestReplay,
  type ExternalIntelligenceReplayPolicy,
  type ExternalIntelligenceReplaySnapshot,
} from "../src/backtest/externalIntelligenceReplay.ts";
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
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
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


test("rejects a digest-valid manipulation artifact that omits linkage partitions", async () => {
  const assessedAtMs = DECISION_HOUR;
  const risk = await item(
    "partition-risk",
    "official-exchange",
    "security-incident",
    "negative",
    assessedAtMs - 60_000,
    assessedAtMs - 40_000,
    assessedAtMs - 20_000,
  );
  const positive = await item(
    "partition-positive",
    "mainstream-news",
    "partnership",
    "positive",
    assessedAtMs - 55_000,
    assessedAtMs - 35_000,
    assessedAtMs - 15_000,
  );
  const valid = await snapshot(assessedAtMs, [risk, positive]);
  assert.equal(valid.manipulationEvidence.repostClusters.length, 2);

  const keptCluster = valid.manipulationEvidence.repostClusters[0];
  assert.ok(keptCluster);
  const keptRepresentative =
    valid.manipulationEvidence.representativeItems.find(
      (value) => value.itemId === keptCluster.representativeItemId,
    );
  assert.ok(keptRepresentative);
  const evidenceBody = {
    schemaVersion: valid.manipulationEvidence.schemaVersion,
    analysedAtMs: valid.manipulationEvidence.analysedAtMs,
    linkageSha256: valid.manipulationEvidence.linkageSha256,
    policySha256: valid.manipulationEvidence.policySha256,
    repostClusters: [keptCluster],
    representativeItems: [keptRepresentative],
  } as const;
  const evidenceSha256 = await sha256CanonicalIntelligence(evidenceBody);
  const originalIntegration = valid.integrations.find(
    (value) =>
      value.actionableRepostClusterSha256s.includes(
        keptCluster.repostClusterSha256,
      ) ||
      value.watchOnlyRepostClusterSha256s.includes(
        keptCluster.repostClusterSha256,
      ),
  );
  assert.ok(originalIntegration);
  const integrationBody = {
    schemaVersion: originalIntegration.schemaVersion,
    assessedAtMs: originalIntegration.assessedAtMs,
    linkageSha256: originalIntegration.linkageSha256,
    manipulationEvidenceSha256: evidenceSha256,
    manipulationPolicySha256: originalIntegration.manipulationPolicySha256,
    assessmentPolicySha256: originalIntegration.assessmentPolicySha256,
    assessment: originalIntegration.assessment,
    effectiveReaction: originalIntegration.effectiveReaction,
    actionableRepostClusterSha256s:
      originalIntegration.actionableRepostClusterSha256s,
    watchOnlyRepostClusterSha256s:
      originalIntegration.watchOnlyRepostClusterSha256s,
    warnings: originalIntegration.warnings,
  } as const;
  const incomplete = {
    ...valid,
    manipulationEvidence: {
      ...evidenceBody,
      evidenceSha256,
    },
    integrations: [
      {
        ...integrationBody,
        integrationSha256:
          await sha256CanonicalIntelligence(integrationBody),
      },
    ],
  };
  await assert.rejects(
    prepareExternalIntelligenceBacktestReplay({
      decisionTimestampsMs: [DECISION_HOUR],
      snapshots: [incomplete],
      policy: REPLAY_POLICY,
    }),
    /exact partitions/u,
  );
});
