import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import type {
  IntelligenceReaction,
} from "../intelligence/externalIntelligence.ts";
import {
  verifyExternalIntelligenceLinkageArtifact,
  verifyExternalIntelligenceManipulationEvidenceArtifact,
  verifyIntegratedExternalIntelligenceAssessment,
  type IntegratedExternalIntelligenceAssessment,
} from "../intelligence/externalIntelligenceAssessmentIntegration.ts";
import type {
  ExternalIntelligenceLinkage,
} from "../intelligence/externalIntelligenceLinking.ts";
import type {
  ExternalIntelligenceManipulationEvidence,
} from "../intelligence/externalIntelligenceManipulation.ts";
import { runBacktest } from "./engine.ts";
import type {
  BacktestConfig,
  BacktestResult,
  BacktestStep,
} from "./types.ts";

const HOUR_MS = 3_600_000;
const MAXIMUM_REPLAY_FRAMES = 100_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REACTIONS: readonly IntelligenceReaction[] = [
  "ignore",
  "pause-new-risk",
  "research-candidate",
  "watch",
];

export interface ExternalIntelligenceReplayPolicy {
  readonly maximumReactionAgeMs: Readonly<
    Record<IntelligenceReaction, number>
  >;
  readonly maximumSnapshots: number;
}

export interface ExternalIntelligenceReplaySnapshot {
  readonly assessedAtMs: number;
  readonly linkage: ExternalIntelligenceLinkage;
  readonly manipulationEvidence: ExternalIntelligenceManipulationEvidence;
  readonly integrations: readonly IntegratedExternalIntelligenceAssessment[];
}

export interface ExternalIntelligenceReplayLatency {
  readonly earliestPublishedAtMs: number | null;
  readonly latestReceivedAtMs: number | null;
  readonly latestAvailableAtMs: number | null;
  readonly maximumPublicationToReceiptMs: number;
  readonly maximumReceiptToAvailabilityMs: number;
  readonly maximumAvailabilityToAssessmentMs: number;
  readonly maximumPublicationToAssessmentMs: number;
}

export interface ExternalIntelligenceReplayFrame {
  readonly schemaVersion: "external-intelligence-replay-frame-v1";
  readonly decisionAtMs: number;
  readonly selectedSnapshotSha256: string | null;
  readonly selectedSnapshotAssessedAtMs: number | null;
  readonly selectedSnapshotAgeMs: number | null;
  readonly visibleIntegrationSha256s: readonly string[];
  readonly activePauseNewRiskSha256s: readonly string[];
  readonly activeResearchCandidateSha256s: readonly string[];
  readonly activeWatchSha256s: readonly string[];
  readonly activeIgnoredSha256s: readonly string[];
  readonly expiredIntegrationSha256s: readonly string[];
  readonly latency: ExternalIntelligenceReplayLatency;
  readonly frameSha256: string;
}

export interface ExternalIntelligenceReplay {
  readonly schemaVersion: "external-intelligence-replay-v1";
  readonly policySha256: string;
  readonly snapshotSha256s: readonly string[];
  readonly frames: readonly ExternalIntelligenceReplayFrame[];
  readonly replaySha256: string;
}

export interface PrepareExternalIntelligenceReplayInput {
  readonly decisionTimestampsMs: readonly number[];
  readonly snapshots: readonly ExternalIntelligenceReplaySnapshot[];
  readonly policy: ExternalIntelligenceReplayPolicy;
}

export type ExternalIntelligenceBacktestIntent =
  | "hold"
  | "new-risk"
  | "increase-risk"
  | "reduce-risk"
  | "exit";

export interface ExternalIntelligenceBacktestGateDecision {
  readonly intent: ExternalIntelligenceBacktestIntent;
  readonly allowed: boolean;
  readonly reason:
    | "no-active-pause"
    | "pause-blocks-new-risk"
    | "pause-preserves-reduction";
  readonly pauseEvidenceSha256s: readonly string[];
  readonly researchCandidateSha256s: readonly string[];
}

export interface ExternalIntelligenceBacktestComparison {
  readonly schemaVersion: "external-intelligence-backtest-comparison-v1";
  readonly replaySha256: string;
  readonly baselineResult: BacktestResult;
  readonly intelligenceGatedResult: BacktestResult;
  readonly finalEquityDeltaAud: number;
  readonly totalReturnDeltaPct: number;
  readonly suppressedRequestCount: number;
  readonly suppressedRequestedNotionalAud: number;
  readonly pauseFrameCount: number;
  readonly researchCandidateFrameCount: number;
  readonly comparisonSha256: string;
}

interface VerifiedSnapshot {
  readonly snapshot: ExternalIntelligenceReplaySnapshot;
  readonly snapshotSha256: string;
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertDuration(name: string, value: number): void {
  assertTime(name, value);
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertSortedUnique(
  name: string,
  values: readonly string[],
): void {
  const sorted = [...values].sort();
  if (
    values.length > 500 ||
    new Set(sorted).size !== values.length ||
    canonicalIntelligenceJson(values) !== canonicalIntelligenceJson(sorted)
  ) {
    throw new Error(`${name} must be sorted, unique and bounded`);
  }
  for (const value of values) assertDigest(name, value);
}

function validatePolicy(policy: ExternalIntelligenceReplayPolicy): void {
  if (
    !Number.isSafeInteger(policy.maximumSnapshots) ||
    policy.maximumSnapshots < 1 ||
    policy.maximumSnapshots > 10_000
  ) {
    throw new Error("maximumSnapshots must be an integer from 1 to 10000");
  }
  for (const reaction of REACTIONS) {
    assertDuration(
      `maximumReactionAgeMs.${reaction}`,
      policy.maximumReactionAgeMs[reaction],
    );
  }
}

function validateDecisionTimestamps(values: readonly number[]): void {
  if (values.length < 1 || values.length > MAXIMUM_REPLAY_FRAMES) {
    throw new Error(
      `decisionTimestampsMs must contain 1 to ${MAXIMUM_REPLAY_FRAMES} values`,
    );
  }
  let previous: number | undefined;
  for (const value of values) {
    assertTime("decisionTimestampMs", value);
    if (value % HOUR_MS !== 0) {
      throw new Error("Decision timestamps must be aligned to hourly candles");
    }
    if (previous !== undefined && value <= previous) {
      throw new Error("Decision timestamps must be strictly increasing");
    }
    previous = value;
  }
}

async function verifySnapshot(
  snapshot: ExternalIntelligenceReplaySnapshot,
): Promise<VerifiedSnapshot> {
  assertTime("snapshot assessedAtMs", snapshot.assessedAtMs);
  await verifyExternalIntelligenceLinkageArtifact(snapshot.linkage);
  await verifyExternalIntelligenceManipulationEvidenceArtifact(
    snapshot.manipulationEvidence,
  );
  if (
    snapshot.manipulationEvidence.linkageSha256 !==
      snapshot.linkage.linkageSha256 ||
    snapshot.linkage.linkedAtMs >
      snapshot.manipulationEvidence.analysedAtMs ||
    snapshot.manipulationEvidence.analysedAtMs > snapshot.assessedAtMs
  ) {
    throw new Error("Replay snapshot provenance or chronology is invalid");
  }

  const integrationSha256s = snapshot.integrations
    .map((integration) => integration.integrationSha256)
    .sort();
  assertSortedUnique("snapshot integrationSha256s", integrationSha256s);
  for (const integration of snapshot.integrations) {
    await verifyIntegratedExternalIntelligenceAssessment(integration);
    if (
      integration.assessedAtMs !== snapshot.assessedAtMs ||
      integration.linkageSha256 !== snapshot.linkage.linkageSha256 ||
      integration.manipulationEvidenceSha256 !==
        snapshot.manipulationEvidence.evidenceSha256 ||
      integration.manipulationPolicySha256 !==
        snapshot.manipulationEvidence.policySha256
    ) {
      throw new Error("Replay integration does not belong to its snapshot");
    }
  }

  for (const item of snapshot.manipulationEvidence.representativeItems) {
    if (
      item.publishedAtMs > item.receivedAtMs ||
      item.receivedAtMs > item.availableAtMs ||
      item.availableAtMs > snapshot.linkage.linkedAtMs
    ) {
      throw new Error("Replay item availability chronology is invalid");
    }
  }

  const canonical = {
    schemaVersion: "external-intelligence-replay-snapshot-v1",
    assessedAtMs: snapshot.assessedAtMs,
    linkageSha256: snapshot.linkage.linkageSha256,
    manipulationEvidenceSha256:
      snapshot.manipulationEvidence.evidenceSha256,
    integrationSha256s,
  } as const;
  return {
    snapshot,
    snapshotSha256: await sha256CanonicalIntelligence(canonical),
  };
}

function latencyFor(snapshot: ExternalIntelligenceReplaySnapshot | null):
  ExternalIntelligenceReplayLatency {
  const items = snapshot?.manipulationEvidence.representativeItems ?? [];
  if (snapshot === null || items.length === 0) {
    return {
      earliestPublishedAtMs: null,
      latestReceivedAtMs: null,
      latestAvailableAtMs: null,
      maximumPublicationToReceiptMs: 0,
      maximumReceiptToAvailabilityMs: 0,
      maximumAvailabilityToAssessmentMs: 0,
      maximumPublicationToAssessmentMs: 0,
    };
  }
  return {
    earliestPublishedAtMs: Math.min(...items.map((item) => item.publishedAtMs)),
    latestReceivedAtMs: Math.max(...items.map((item) => item.receivedAtMs)),
    latestAvailableAtMs: Math.max(...items.map((item) => item.availableAtMs)),
    maximumPublicationToReceiptMs: Math.max(
      ...items.map((item) => item.receivedAtMs - item.publishedAtMs),
    ),
    maximumReceiptToAvailabilityMs: Math.max(
      ...items.map((item) => item.availableAtMs - item.receivedAtMs),
    ),
    maximumAvailabilityToAssessmentMs: Math.max(
      ...items.map((item) => snapshot.assessedAtMs - item.availableAtMs),
    ),
    maximumPublicationToAssessmentMs: Math.max(
      ...items.map((item) => snapshot.assessedAtMs - item.publishedAtMs),
    ),
  };
}

async function frameFor(
  decisionAtMs: number,
  selected: VerifiedSnapshot | null,
  policy: ExternalIntelligenceReplayPolicy,
): Promise<ExternalIntelligenceReplayFrame> {
  const integrations = selected?.snapshot.integrations ?? [];
  const visibleIntegrationSha256s = integrations
    .map((integration) => integration.integrationSha256)
    .sort();
  const active = integrations.filter(
    (integration) =>
      decisionAtMs - integration.assessedAtMs <=
      policy.maximumReactionAgeMs[integration.effectiveReaction],
  );
  const activeIds = new Set(
    active.map((integration) => integration.integrationSha256),
  );
  const idsFor = (reaction: IntelligenceReaction): string[] =>
    active
      .filter((integration) => integration.effectiveReaction === reaction)
      .map((integration) => integration.integrationSha256)
      .sort();
  const canonical = {
    schemaVersion: "external-intelligence-replay-frame-v1",
    decisionAtMs,
    selectedSnapshotSha256: selected?.snapshotSha256 ?? null,
    selectedSnapshotAssessedAtMs: selected?.snapshot.assessedAtMs ?? null,
    selectedSnapshotAgeMs:
      selected === null ? null : decisionAtMs - selected.snapshot.assessedAtMs,
    visibleIntegrationSha256s,
    activePauseNewRiskSha256s: idsFor("pause-new-risk"),
    activeResearchCandidateSha256s: idsFor("research-candidate"),
    activeWatchSha256s: idsFor("watch"),
    activeIgnoredSha256s: idsFor("ignore"),
    expiredIntegrationSha256s: visibleIntegrationSha256s.filter(
      (sha256) => !activeIds.has(sha256),
    ),
    latency: latencyFor(selected?.snapshot ?? null),
  } as const;
  return {
    ...canonical,
    frameSha256: await sha256CanonicalIntelligence(canonical),
  };
}

export async function prepareExternalIntelligenceBacktestReplay(
  input: PrepareExternalIntelligenceReplayInput,
): Promise<ExternalIntelligenceReplay> {
  validatePolicy(input.policy);
  validateDecisionTimestamps(input.decisionTimestampsMs);
  if (input.snapshots.length > input.policy.maximumSnapshots) {
    throw new Error("Replay snapshot count exceeds policy");
  }

  const snapshots = await Promise.all(input.snapshots.map(verifySnapshot));
  snapshots.sort(
    (left, right) =>
      left.snapshot.assessedAtMs - right.snapshot.assessedAtMs ||
      left.snapshotSha256.localeCompare(right.snapshotSha256),
  );
  for (let index = 1; index < snapshots.length; index += 1) {
    if (
      snapshots[index - 1]?.snapshot.assessedAtMs ===
      snapshots[index]?.snapshot.assessedAtMs
    ) {
      throw new Error("Replay snapshots must have unique assessment times");
    }
  }

  const frames: ExternalIntelligenceReplayFrame[] = [];
  let selectedIndex = -1;
  for (const decisionAtMs of input.decisionTimestampsMs) {
    while (
      snapshots[selectedIndex + 1] !== undefined &&
      (snapshots[selectedIndex + 1]?.snapshot.assessedAtMs ??
        Number.POSITIVE_INFINITY) <= decisionAtMs
    ) {
      selectedIndex += 1;
    }
    frames.push(
      await frameFor(
        decisionAtMs,
        snapshots[selectedIndex] ?? null,
        input.policy,
      ),
    );
  }

  const policySha256 = await sha256CanonicalIntelligence({
    schemaVersion: "external-intelligence-replay-policy-v1",
    maximumReactionAgeMs: input.policy.maximumReactionAgeMs,
    maximumSnapshots: input.policy.maximumSnapshots,
  });
  const canonical = {
    schemaVersion: "external-intelligence-replay-v1",
    policySha256,
    snapshotSha256s: snapshots.map((snapshot) => snapshot.snapshotSha256),
    frames,
  } as const;
  return {
    ...canonical,
    replaySha256: await sha256CanonicalIntelligence(canonical),
  };
}

function canonicalFrame(
  frame: ExternalIntelligenceReplayFrame,
): Omit<ExternalIntelligenceReplayFrame, "frameSha256"> {
  return {
    schemaVersion: frame.schemaVersion,
    decisionAtMs: frame.decisionAtMs,
    selectedSnapshotSha256: frame.selectedSnapshotSha256,
    selectedSnapshotAssessedAtMs: frame.selectedSnapshotAssessedAtMs,
    selectedSnapshotAgeMs: frame.selectedSnapshotAgeMs,
    visibleIntegrationSha256s: frame.visibleIntegrationSha256s,
    activePauseNewRiskSha256s: frame.activePauseNewRiskSha256s,
    activeResearchCandidateSha256s:
      frame.activeResearchCandidateSha256s,
    activeWatchSha256s: frame.activeWatchSha256s,
    activeIgnoredSha256s: frame.activeIgnoredSha256s,
    expiredIntegrationSha256s: frame.expiredIntegrationSha256s,
    latency: frame.latency,
  };
}

export async function verifyExternalIntelligenceReplayFrame(
  frame: ExternalIntelligenceReplayFrame,
): Promise<void> {
  if (frame.schemaVersion !== "external-intelligence-replay-frame-v1") {
    throw new Error("Unsupported external-intelligence replay frame");
  }
  assertTime("frame decisionAtMs", frame.decisionAtMs);
  if (frame.decisionAtMs % HOUR_MS !== 0) {
    throw new Error("Replay frame decision must be hourly aligned");
  }
  assertDigest("frameSha256", frame.frameSha256);
  for (const [name, values] of [
    ["visibleIntegrationSha256s", frame.visibleIntegrationSha256s],
    ["activePauseNewRiskSha256s", frame.activePauseNewRiskSha256s],
    [
      "activeResearchCandidateSha256s",
      frame.activeResearchCandidateSha256s,
    ],
    ["activeWatchSha256s", frame.activeWatchSha256s],
    ["activeIgnoredSha256s", frame.activeIgnoredSha256s],
    ["expiredIntegrationSha256s", frame.expiredIntegrationSha256s],
  ] as const) {
    assertSortedUnique(name, values);
  }

  const classifications = [
    ...frame.activePauseNewRiskSha256s,
    ...frame.activeResearchCandidateSha256s,
    ...frame.activeWatchSha256s,
    ...frame.activeIgnoredSha256s,
    ...frame.expiredIntegrationSha256s,
  ].sort();
  if (
    canonicalIntelligenceJson(classifications) !==
    canonicalIntelligenceJson(frame.visibleIntegrationSha256s)
  ) {
    throw new Error(
      "Replay frame classifications must partition visible integrations",
    );
  }

  const snapshotFields = [
    frame.selectedSnapshotSha256,
    frame.selectedSnapshotAssessedAtMs,
    frame.selectedSnapshotAgeMs,
  ];
  const hasSnapshot = snapshotFields.every((value) => value !== null);
  if (
    !hasSnapshot &&
    snapshotFields.some((value) => value !== null)
  ) {
    throw new Error("Replay frame snapshot fields must be all null or present");
  }
  if (hasSnapshot) {
    assertDigest(
      "selectedSnapshotSha256",
      frame.selectedSnapshotSha256 ?? "",
    );
    assertTime(
      "selectedSnapshotAssessedAtMs",
      frame.selectedSnapshotAssessedAtMs ?? -1,
    );
    assertDuration(
      "selectedSnapshotAgeMs",
      frame.selectedSnapshotAgeMs ?? -1,
    );
    if (
      frame.decisionAtMs -
        (frame.selectedSnapshotAssessedAtMs ?? 0) !==
      frame.selectedSnapshotAgeMs
    ) {
      throw new Error("Replay frame snapshot age is inconsistent");
    }
  } else if (frame.visibleIntegrationSha256s.length > 0) {
    throw new Error("Replay frame without a snapshot cannot expose evidence");
  }

  const latencyTimes = [
    frame.latency.earliestPublishedAtMs,
    frame.latency.latestReceivedAtMs,
    frame.latency.latestAvailableAtMs,
  ];
  const hasLatency = latencyTimes.every((value) => value !== null);
  if (!hasLatency && latencyTimes.some((value) => value !== null)) {
    throw new Error("Replay latency timestamps must be all null or present");
  }
  for (const [name, value] of Object.entries({
    maximumPublicationToReceiptMs:
      frame.latency.maximumPublicationToReceiptMs,
    maximumReceiptToAvailabilityMs:
      frame.latency.maximumReceiptToAvailabilityMs,
    maximumAvailabilityToAssessmentMs:
      frame.latency.maximumAvailabilityToAssessmentMs,
    maximumPublicationToAssessmentMs:
      frame.latency.maximumPublicationToAssessmentMs,
  })) {
    assertDuration(name, value);
  }
  if (hasLatency) {
    const publishedAtMs = frame.latency.earliestPublishedAtMs ?? 0;
    const receivedAtMs = frame.latency.latestReceivedAtMs ?? 0;
    const availableAtMs = frame.latency.latestAvailableAtMs ?? 0;
    const assessedAtMs = frame.selectedSnapshotAssessedAtMs;
    assertTime("earliestPublishedAtMs", publishedAtMs);
    assertTime("latestReceivedAtMs", receivedAtMs);
    assertTime("latestAvailableAtMs", availableAtMs);
    if (
      assessedAtMs === null ||
      publishedAtMs > receivedAtMs ||
      receivedAtMs > availableAtMs ||
      availableAtMs > assessedAtMs
    ) {
      throw new Error("Replay frame latency chronology is invalid");
    }
  } else if (
    frame.latency.maximumPublicationToReceiptMs !== 0 ||
    frame.latency.maximumReceiptToAvailabilityMs !== 0 ||
    frame.latency.maximumAvailabilityToAssessmentMs !== 0 ||
    frame.latency.maximumPublicationToAssessmentMs !== 0
  ) {
    throw new Error("Replay frame without latency timestamps must use zero delays");
  }

  const expected = await sha256CanonicalIntelligence(canonicalFrame(frame));
  if (expected !== frame.frameSha256) {
    throw new Error("External-intelligence replay frame digest does not match");
  }
}

export async function verifyExternalIntelligenceReplay(
  replay: ExternalIntelligenceReplay,
): Promise<void> {
  if (replay.schemaVersion !== "external-intelligence-replay-v1") {
    throw new Error("Unsupported external-intelligence replay");
  }
  assertDigest("policySha256", replay.policySha256);
  assertDigest("replaySha256", replay.replaySha256);
  if (
    replay.snapshotSha256s.length > 10_000 ||
    new Set(replay.snapshotSha256s).size !== replay.snapshotSha256s.length
  ) {
    throw new Error("Replay snapshot identities must be unique and bounded");
  }
  for (const digest of replay.snapshotSha256s) {
    assertDigest("snapshotSha256s", digest);
  }
  validateDecisionTimestamps(
    replay.frames.map((frame) => frame.decisionAtMs),
  );
  await Promise.all(replay.frames.map(verifyExternalIntelligenceReplayFrame));
  const expected = await sha256CanonicalIntelligence({
    schemaVersion: replay.schemaVersion,
    policySha256: replay.policySha256,
    snapshotSha256s: replay.snapshotSha256s,
    frames: replay.frames,
  });
  if (expected !== replay.replaySha256) {
    throw new Error("External-intelligence replay digest does not match");
  }
}

export async function bindExternalIntelligenceReplayToBacktestSteps(
  steps: readonly BacktestStep[],
  replay: ExternalIntelligenceReplay,
): Promise<readonly BacktestStep[]> {
  await verifyExternalIntelligenceReplay(replay);
  if (steps.length !== replay.frames.length) {
    throw new Error("Replay must contain exactly one frame per backtest step");
  }
  return steps.map((step, index) => {
    if (step.externalIntelligenceGate !== undefined) {
      throw new Error("Backtest step already has an intelligence gate");
    }
    const frame = replay.frames[index];
    if (
      frame === undefined ||
      frame.decisionAtMs !== step.signalTimestampMs
    ) {
      throw new Error("Replay frame does not match backtest signal time");
    }
    return {
      ...step,
      externalIntelligenceGate: {
        schemaVersion: "backtest-external-intelligence-gate-v1",
        decisionAtMs: frame.decisionAtMs,
        frameSha256: frame.frameSha256,
        pauseNewRiskEvidenceSha256s:
          frame.activePauseNewRiskSha256s,
        researchCandidateSha256s:
          frame.activeResearchCandidateSha256s,
      },
    };
  });
}

export async function runExternalIntelligenceBacktestComparison(
  config: BacktestConfig,
  steps: readonly BacktestStep[],
  replay: ExternalIntelligenceReplay,
): Promise<ExternalIntelligenceBacktestComparison> {
  if (steps.some((step) => step.externalIntelligenceGate !== undefined)) {
    throw new Error("Comparison input steps must be ungated");
  }
  const gatedSteps = await bindExternalIntelligenceReplayToBacktestSteps(
    steps,
    replay,
  );
  const baselineResult = runBacktest(config, steps);
  const intelligenceGatedResult = runBacktest(config, gatedSteps);
  const canonical = {
    schemaVersion: "external-intelligence-backtest-comparison-v1",
    replaySha256: replay.replaySha256,
    baselineResult,
    intelligenceGatedResult,
    finalEquityDeltaAud:
      intelligenceGatedResult.finalEquityAud -
      baselineResult.finalEquityAud,
    totalReturnDeltaPct:
      intelligenceGatedResult.totalReturnPct -
      baselineResult.totalReturnPct,
    suppressedRequestCount:
      intelligenceGatedResult.suppressedExecutions.length,
    suppressedRequestedNotionalAud:
      intelligenceGatedResult.suppressedExecutions.reduce(
        (sum, execution) => sum + execution.requestedNotionalAud,
        0,
      ),
    pauseFrameCount: replay.frames.filter(
      (frame) => frame.activePauseNewRiskSha256s.length > 0,
    ).length,
    researchCandidateFrameCount: replay.frames.filter(
      (frame) => frame.activeResearchCandidateSha256s.length > 0,
    ).length,
  } as const;
  return {
    ...canonical,
    comparisonSha256: await sha256CanonicalIntelligence(canonical),
  };
}

export function evaluateExternalIntelligenceBacktestGate(
  intent: ExternalIntelligenceBacktestIntent,
  frame: ExternalIntelligenceReplayFrame,
): ExternalIntelligenceBacktestGateDecision {
  const paused = frame.activePauseNewRiskSha256s.length > 0;
  const addsRisk = intent === "new-risk" || intent === "increase-risk";
  return {
    intent,
    allowed: !paused || !addsRisk,
    reason: !paused
      ? "no-active-pause"
      : addsRisk
        ? "pause-blocks-new-risk"
        : "pause-preserves-reduction",
    pauseEvidenceSha256s: frame.activePauseNewRiskSha256s,
    researchCandidateSha256s: frame.activeResearchCandidateSha256s,
  };
}
