import assert from "node:assert/strict";
import test from "node:test";
import type {
  Candle,
  StrategyDecision,
} from "../src/domain/types.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import {
  bindUniverseMembershipToStrategyDecision,
  decideUniverseBoundMomentumRotation,
  requireUniverseSnapshotSha256,
  verifyUniverseBoundStrategyDecision,
} from "../src/strategies/universeBoundDecision.ts";
import type { UniverseSignalTimeMembership } from "../src/universe/signalTimeMembership.ts";

const DECISION_AT_MS = Date.parse("2026-07-29T04:00:00.000Z");

async function membership(
  eligiblePairs: readonly string[] = ["BTC/AUD", "ETH/AUD"],
): Promise<UniverseSignalTimeMembership> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs: DECISION_AT_MS,
    snapshotAsOfMs: DECISION_AT_MS - 60_000,
    snapshotAvailableAtMs: DECISION_AT_MS - 30_000,
    snapshotSha256: "a".repeat(64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs,
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

function candles(start: number, dailyGrowth: number): readonly Candle[] {
  return Array.from({ length: 240 }, (_, index) => {
    const close = start * (1 + dailyGrowth) ** index;
    return {
      timestampMs: Date.UTC(2025, 0, 1 + index),
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000,
    };
  });
}

function decision(
  overrides: Partial<StrategyDecision> = {},
): StrategyDecision {
  return {
    strategyVersion: "test-v1",
    action: "hold",
    targetExposurePct: 0,
    reason: "No eligible signal",
    signals: [],
    ...overrides,
  };
}

test("binds a deterministic momentum decision to exact verified membership", async () => {
  const verifiedMembership = await membership();
  const first = await decideUniverseBoundMomentumRotation(verifiedMembership, {
    "ETH/AUD": candles(100, 0.001),
    "BTC/AUD": candles(100, 0.002),
  });
  const second = await decideUniverseBoundMomentumRotation(
    verifiedMembership,
    {
      "BTC/AUD": candles(100, 0.002),
      "ETH/AUD": candles(100, 0.001),
    },
  );
  assert.equal(first.bindingSha256, second.bindingSha256);
  assert.equal(first.decision.targetPair, "BTC/AUD");
  assert.deepEqual(
    first.decision.signals.map((signal) => signal.pair),
    ["BTC/AUD", "ETH/AUD"],
  );
  await verifyUniverseBoundStrategyDecision(first);
});

test("keeps a no-signal result in AUD cash", async () => {
  const artifact = await decideUniverseBoundMomentumRotation(
    await membership(),
    {
      "BTC/AUD": candles(100, -0.001),
      "ETH/AUD": candles(100, -0.002),
    },
  );
  assert.equal(artifact.decision.action, "hold");
  assert.equal(artifact.decision.targetExposurePct, 0);
  assert.equal(artifact.decision.targetPair, undefined);
});

test("rejects strategy inputs and buys outside verified membership", async () => {
  const verifiedMembership = await membership(["BTC/AUD"]);
  await assert.rejects(
    decideUniverseBoundMomentumRotation(verifiedMembership, {
      "ETH/AUD": candles(100, 0.002),
    }),
    /outside verified universe membership/u,
  );
  await assert.rejects(
    bindUniverseMembershipToStrategyDecision(
      verifiedMembership,
      decision({
        action: "buy",
        targetPair: "ETH/AUD",
        targetExposurePct: 90,
      }),
    ),
    /outside verified universe membership/u,
  );
});

test("permits an exit after a held pair loses eligibility", async () => {
  const artifact = await bindUniverseMembershipToStrategyDecision(
    await membership([]),
    decision({
      action: "sell",
      targetPair: "BTC/AUD",
      reason: "Exit a formerly eligible holding",
    }),
  );
  assert.equal(artifact.decision.action, "sell");
  await verifyUniverseBoundStrategyDecision(artifact);
});

test("rejects malformed cash targets and tampered bindings", async () => {
  const verifiedMembership = await membership();
  await assert.rejects(
    bindUniverseMembershipToStrategyDecision(
      verifiedMembership,
      decision({ action: "transfer" as StrategyDecision["action"] }),
    ),
    /strategy action is invalid/u,
  );
  await assert.rejects(
    bindUniverseMembershipToStrategyDecision(
      verifiedMembership,
      decision({ targetExposurePct: 10 }),
    ),
    /hold decisions must target AUD cash/u,
  );
  const artifact = await bindUniverseMembershipToStrategyDecision(
    verifiedMembership,
    decision(),
  );
  await assert.rejects(
    verifyUniverseBoundStrategyDecision({
      ...artifact,
      decision: { ...artifact.decision, reason: "Changed after binding" },
    }),
    /identity is invalid/u,
  );
});

test("requires one exact configured persisted snapshot identity", () => {
  assert.equal(
    requireUniverseSnapshotSha256(` ${"A".repeat(64)} `),
    "a".repeat(64),
  );
  assert.throws(
    () => requireUniverseSnapshotSha256(""),
    /must select one exact persisted snapshot/u,
  );
  assert.throws(
    () => requireUniverseSnapshotSha256("a".repeat(63)),
    /must select one exact persisted snapshot/u,
  );
});
