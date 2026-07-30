import assert from "node:assert/strict";
import test from "node:test";
import {
  CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  decideCrossSectionalMomentum,
  type HourlyClose,
} from "../src/strategies/crossSectionalMomentum.ts";

const HOUR_MS = 3_600_000;
const HOURS = 721;

function history(
  start: number,
  hourlyReturn: number,
  hours = HOURS,
): readonly HourlyClose[] {
  return Array.from({ length: hours }, (_, index) => ({
    timestampMs: index * HOUR_MS,
    close: start * (1 + hourlyReturn) ** index,
  }));
}

function shortReversalHistory(): readonly HourlyClose[] {
  return Array.from({ length: HOURS }, (_, index) => {
    const close = index <= HOURS - 25
      ? 100 - 50 * index / (HOURS - 25)
      : 50 + 49 * (index - (HOURS - 25)) / 24;
    return { timestampMs: index * HOUR_MS, close };
  });
}

function input(
  currentPosition: { pair: string; enteredAtMs: number } | null = null,
) {
  return {
    universeSnapshotSha256: "a".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
    hourlyClosesByPair: {
      "BTC/AUD": history(100, 0.0005),
      "ETH/AUD": history(100, 0.001),
    },
    currentPosition,
  } as const;
}

test("ranks exact eligible membership and enters the strongest positive asset", async () => {
  const decision = await decideCrossSectionalMomentum(input());
  assert.equal(decision.targetPair, "ETH/AUD");
  assert.equal(decision.targetExposurePct, 95);
  assert.equal(decision.reason, "enter-strongest-positive-momentum");
  assert.equal(decision.signals.find((value) => value.pair === "ETH/AUD")!.rank, 1);
  assert.equal(decision.candidateStatus, "research-only-unselected");
  assert.equal(decision.runtimeScopeChanged, false);
  assert.equal(decision.selectionAuthority, "none");
  assert.equal(decision.activationAuthority, "none");
  assert.equal(decision.executionAuthority, "none");
  assert.match(decision.decisionSha256, /^[0-9a-f]{64}$/u);
});

test("retains a positive position during the minimum hold", async () => {
  const decision = await decideCrossSectionalMomentum(
    input({
      pair: "BTC/AUD",
      enteredAtMs: (HOURS - 10) * HOUR_MS,
    }),
  );
  assert.equal(decision.targetPair, "BTC/AUD");
  assert.equal(decision.reason, "retain-during-minimum-hold");
});

test("rotates only when the leader clears the deterministic hysteresis", async () => {
  const rotated = await decideCrossSectionalMomentum(
    input({ pair: "BTC/AUD", enteredAtMs: 0 }),
  );
  assert.equal(rotated.targetPair, "ETH/AUD");
  assert.equal(rotated.reason, "rotate-to-materially-stronger-leader");

  const retained = await decideCrossSectionalMomentum(
    input({ pair: "BTC/AUD", enteredAtMs: 0 }),
    {
      ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
      rotationScoreLead: 0.5,
    },
  );
  assert.equal(retained.targetPair, "BTC/AUD");
  assert.equal(retained.reason, "retain-current-leader");
});

test("holds AUD when absolute momentum is not positive", async () => {
  const value = input();
  const decision = await decideCrossSectionalMomentum({
    ...value,
    hourlyClosesByPair: {
      "BTC/AUD": history(100, -0.0005),
      "ETH/AUD": history(100, -0.001),
    },
  });
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.reason, "no-positive-momentum-hold-aud");
});

test("selects the strongest eligible signal rather than an ineligible top score", async () => {
  const value = input();
  const decision = await decideCrossSectionalMomentum({
    ...value,
    hourlyClosesByPair: {
      "BTC/AUD": history(100, 0.0001),
      "ETH/AUD": shortReversalHistory(),
    },
  });
  assert.ok(
    decision.signals.find((value) => value.pair === "ETH/AUD")!
      .weightedMomentum >
      decision.signals.find((value) => value.pair === "BTC/AUD")!
        .weightedMomentum,
  );
  assert.equal(
    decision.signals.find((value) => value.pair === "ETH/AUD")!
      .entryEligible,
    false,
  );
  assert.equal(decision.targetPair, "BTC/AUD");
});

test("exits an ineligible holding without same-signal replacement", async () => {
  const decision = await decideCrossSectionalMomentum(
    input({ pair: "SOL/AUD", enteredAtMs: 0 }),
  );
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.reason, "exit-ineligible-position-to-aud");
  await assert.rejects(
    decideCrossSectionalMomentum(
      input({
        pair: "SOL/AUD",
        enteredAtMs: (HOURS + 1) * HOUR_MS,
      }),
    ),
    /position chronology is invalid/u,
  );
});

test("fails closed on membership, chronology, history and policy drift", async () => {
  const value = input();
  await assert.rejects(
    decideCrossSectionalMomentum({
      ...value,
      eligiblePairs: ["ETH/AUD", "BTC/AUD"],
    }),
    /not canonical and sorted/u,
  );
  await assert.rejects(
    decideCrossSectionalMomentum({
      ...value,
      hourlyClosesByPair: {
        ...value.hourlyClosesByPair,
        "SOL/AUD": history(100, 0.002),
      },
    }),
    /do not match eligible membership/u,
  );
  await assert.rejects(
    decideCrossSectionalMomentum({
      ...value,
      hourlyClosesByPair: {
        ...value.hourlyClosesByPair,
        "ETH/AUD": value.hourlyClosesByPair["ETH/AUD"].map(
          (observation, index) => index === 50
            ? { ...observation, timestampMs: observation.timestampMs + 1 }
            : observation,
        ),
      },
    }),
    /invalid or non-contiguous/u,
  );
  await assert.rejects(
    decideCrossSectionalMomentum(
      value,
      {
        ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
        shortWeight: 0.3,
      },
    ),
    /policy is invalid/u,
  );
  await assert.rejects(
    decideCrossSectionalMomentum(
      input({
        pair: "BTC/AUD",
        enteredAtMs: (HOURS + 1) * HOUR_MS,
      }),
    ),
    /position chronology is invalid/u,
  );
});
