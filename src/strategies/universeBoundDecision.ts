import type {
  AssetSignal,
  Candle,
  StrategyDecision,
} from "../domain/types.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  verifyUniverseSignalTimeMembership,
  type UniverseSignalTimeMembership,
} from "../universe/signalTimeMembership.ts";
import { decideMomentumRotation } from "./momentumRotation.ts";

const CANONICAL_AUD_PAIR = /^[A-Z0-9]{2,20}\/AUD$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

export interface UniverseBoundStrategyDecision {
  readonly schemaVersion: "universe-bound-strategy-decision-v1";
  readonly decisionAtMs: number;
  readonly membershipSha256: string;
  readonly snapshotSha256: string;
  readonly signedPolicySha256: string;
  readonly decision: StrategyDecision;
  readonly bindingSha256: string;
}

export function requireUniverseSnapshotSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_HEX.test(normalized)) {
    throw new Error(
      "UNIVERSE_SNAPSHOT_SHA256 must select one exact persisted snapshot",
    );
  }
  return normalized;
}

function assertDecision(decision: StrategyDecision): void {
  if (
    decision.strategyVersion.trim() !== decision.strategyVersion ||
    decision.strategyVersion.length === 0 ||
    decision.strategyVersion.length > 100
  ) {
    throw new Error("strategy version is invalid");
  }
  if (
    decision.reason.trim() !== decision.reason ||
    decision.reason.length === 0 ||
    decision.reason.length > 500
  ) {
    throw new Error("strategy decision reason is invalid");
  }
  if (
    !Number.isFinite(decision.targetExposurePct) ||
    decision.targetExposurePct < 0 ||
    decision.targetExposurePct > 100
  ) {
    throw new Error("strategy target exposure must be between 0 and 100");
  }
  if (decision.action === "hold") {
    if (
      decision.targetPair !== undefined ||
      decision.targetExposurePct !== 0
    ) {
      throw new Error("hold decisions must target AUD cash");
    }
  } else if (
    decision.targetPair === undefined ||
    !CANONICAL_AUD_PAIR.test(decision.targetPair)
  ) {
    throw new Error("non-hold strategy decisions require a canonical AUD pair");
  }
  if (decision.action === "buy" && decision.targetExposurePct <= 0) {
    throw new Error("buy decisions require positive target exposure");
  }
}

function assertSignals(
  signals: readonly AssetSignal[],
  membership: UniverseSignalTimeMembership,
): void {
  const eligible = new Set(membership.eligiblePairs);
  signals.forEach((signal, index) => {
    if (
      !CANONICAL_AUD_PAIR.test(signal.pair) ||
      (index > 0 && signals[index - 1]!.pair.localeCompare(signal.pair) >= 0)
    ) {
      throw new Error("strategy signals must be canonical, sorted and unique");
    }
    if (!eligible.has(signal.pair)) {
      throw new Error(
        `${signal.pair} strategy signal is outside verified universe membership`,
      );
    }
  });
}

function canonicalDecision(
  decision: StrategyDecision,
): Readonly<Record<string, unknown>> {
  return {
    strategyVersion: decision.strategyVersion,
    action: decision.action,
    targetPair: decision.targetPair ?? null,
    targetExposurePct: decision.targetExposurePct,
    reason: decision.reason,
    signals: decision.signals,
  };
}

function canonicalBinding(
  artifact: Omit<UniverseBoundStrategyDecision, "bindingSha256">,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: artifact.schemaVersion,
    decisionAtMs: artifact.decisionAtMs,
    membershipSha256: artifact.membershipSha256,
    snapshotSha256: artifact.snapshotSha256,
    signedPolicySha256: artifact.signedPolicySha256,
    decision: canonicalDecision(artifact.decision),
  };
}

export async function bindUniverseMembershipToStrategyDecision(
  membership: UniverseSignalTimeMembership,
  decision: StrategyDecision,
): Promise<UniverseBoundStrategyDecision> {
  await verifyUniverseSignalTimeMembership(membership);
  assertDecision(decision);
  assertSignals(decision.signals, membership);
  if (
    decision.action === "buy" &&
    !membership.eligiblePairs.includes(decision.targetPair!)
  ) {
    throw new Error(
      `${decision.targetPair} strategy buy is outside verified universe membership`,
    );
  }
  const artifact = {
    schemaVersion: "universe-bound-strategy-decision-v1",
    decisionAtMs: membership.decisionAtMs,
    membershipSha256: membership.membershipSha256,
    snapshotSha256: membership.snapshotSha256,
    signedPolicySha256: membership.signedPolicySha256,
    decision,
  } as const;
  return {
    ...artifact,
    bindingSha256: await sha256CanonicalIntelligence(
      canonicalBinding(artifact),
    ),
  };
}

export async function verifyUniverseBoundStrategyDecision(
  artifact: UniverseBoundStrategyDecision,
): Promise<void> {
  if (
    artifact.schemaVersion !== "universe-bound-strategy-decision-v1" ||
    !Number.isSafeInteger(artifact.decisionAtMs) ||
    artifact.decisionAtMs < 0
  ) {
    throw new Error("universe-bound strategy decision envelope is invalid");
  }
  for (const digest of [
    artifact.membershipSha256,
    artifact.snapshotSha256,
    artifact.signedPolicySha256,
    artifact.bindingSha256,
  ]) {
    if (!SHA256_HEX.test(digest)) {
      throw new Error("universe-bound strategy decision digest is invalid");
    }
  }
  assertDecision(artifact.decision);
  const expected = await sha256CanonicalIntelligence(
    canonicalBinding({
      schemaVersion: artifact.schemaVersion,
      decisionAtMs: artifact.decisionAtMs,
      membershipSha256: artifact.membershipSha256,
      snapshotSha256: artifact.snapshotSha256,
      signedPolicySha256: artifact.signedPolicySha256,
      decision: artifact.decision,
    }),
  );
  if (
    expected !== artifact.bindingSha256 ||
    canonicalIntelligenceJson(artifact) !==
      canonicalIntelligenceJson({ ...artifact, bindingSha256: expected })
  ) {
    throw new Error("universe-bound strategy decision identity is invalid");
  }
}

export async function decideUniverseBoundMomentumRotation(
  membership: UniverseSignalTimeMembership,
  candlesByPair: Readonly<Record<string, readonly Candle[]>>,
): Promise<UniverseBoundStrategyDecision> {
  await verifyUniverseSignalTimeMembership(membership);
  const eligible = new Set(membership.eligiblePairs);
  const entries = Object.entries(candlesByPair).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [pair] of entries) {
    if (!CANONICAL_AUD_PAIR.test(pair) || !eligible.has(pair)) {
      throw new Error(
        `${pair} strategy input is outside verified universe membership`,
      );
    }
  }
  return bindUniverseMembershipToStrategyDecision(
    membership,
    decideMomentumRotation(Object.fromEntries(entries)),
  );
}
