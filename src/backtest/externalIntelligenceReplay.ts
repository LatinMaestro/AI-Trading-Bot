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

const HOUR_MS = 3_600_000;
const MAXIMUM_REPLAY_FRAMES = 100_000;
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
  readonly watchOnlySha256s: readonly string[];
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

function assertSortedUnique(
  name: string,
  values: readonly string[],
): void {
  const sorted = [...values].sort();
  if (
    new Set(sorted).size !== values.length ||
    canonicalIntelligenceJson(values) !== canonicalIntelligenceJson(sorted)
  ) {
    throw new Error(`${name} must be sorted and unique`);
  }
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
    watchOnlySha256s: [...idsFor("watch"), ...idsFor("ignore")].sort(),
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
