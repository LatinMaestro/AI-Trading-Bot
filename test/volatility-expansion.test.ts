import assert from "node:assert/strict";
import test from "node:test";
import {
  decideVolatilityExpansion,
  VOLATILITY_EXPANSION_BASELINE_POLICY,
  type VolatilityExpansionHourlyClose,
} from "../src/strategies/volatilityExpansion.ts";

const HOUR_MS = 3_600_000;
const HOURS = 181;

function expansionHistory(
  positiveExpansionReturn: number,
): readonly VolatilityExpansionHourlyClose[] {
  const closes = [100];
  for (let index = 1; index <= 120; index += 1) {
    closes.push(
      closes[index - 1]! * (index % 2 === 0 ? 1.002 : 0.9985),
    );
  }
  for (let index = 121; index <= 168; index += 1) {
    closes.push(
      closes[index - 1]! * (index % 2 === 0 ? 1.0001 : 0.99995),
    );
  }
  for (let index = 169; index < HOURS; index += 1) {
    closes.push(
      closes[index - 1]! *
        (index % 2 === 0 ? 1 + positiveExpansionReturn : 0.996),
    );
  }
  return closes.map((close, index) => ({
    timestampMs: index * HOUR_MS,
    close,
  }));
}

function quietHistory(): readonly VolatilityExpansionHourlyClose[] {
  const values = expansionHistory(0.012).map((value) => ({ ...value }));
  for (let index = 169; index < HOURS; index += 1) {
    values[index] = {
      timestampMs: index * HOUR_MS,
      close: values[index - 1]!.close *
        (index % 2 === 0 ? 1.0001 : 0.99995),
    };
  }
  return values;
}

function exitHistory(): readonly VolatilityExpansionHourlyClose[] {
  const values = expansionHistory(0.012).map((value) => ({ ...value }));
  const priorLow = Math.min(...values.slice(-25, -1).map(({ close }) => close));
  values[values.length - 1] = {
    timestampMs: (HOURS - 1) * HOUR_MS,
    close: priorLow * 0.8,
  };
  return values;
}

function input(
  currentPosition: { pair: string; enteredAtMs: number } | null = null,
) {
  return {
    universeSnapshotSha256: "c".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
    hourlyClosesByPair: {
      "BTC/AUD": expansionHistory(0.008),
      "ETH/AUD": expansionHistory(0.012),
    },
    currentPosition,
  } as const;
}

test("enters the strongest compression-to-expansion signal with zero authority", async () => {
  const decision = await decideVolatilityExpansion(input());
  assert.equal(decision.targetPair, "ETH/AUD");
  assert.equal(decision.targetExposurePct, 95);
  assert.equal(decision.reason, "enter-strongest-volatility-expansion");
  const signal = decision.signals.find(
    (value) => value.pair === "ETH/AUD",
  )!;
  assert.ok(signal.compressionRatio <= 0.75);
  assert.ok(signal.expansionRatio >= 1.5);
  assert.equal(signal.rank, 1);
  assert.equal(decision.candidateStatus, "research-only-unselected");
  assert.equal(decision.runtimeScopeChanged, false);
  assert.equal(decision.selectionAuthority, "none");
  assert.equal(decision.activationAuthority, "none");
  assert.equal(decision.executionAuthority, "none");
  assert.match(decision.decisionSha256, /^[0-9a-f]{64}$/u);
});

test("holds AUD when recent volatility does not expand", async () => {
  const value = input();
  const decision = await decideVolatilityExpansion({
    ...value,
    hourlyClosesByPair: {
      "BTC/AUD": quietHistory(),
      "ETH/AUD": quietHistory(),
    },
  });
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.reason, "no-volatility-expansion-hold-aud");
});

test("retains during the minimum hold and rotates only above hysteresis", async () => {
  const recentEntry = await decideVolatilityExpansion(
    input({
      pair: "BTC/AUD",
      enteredAtMs: (HOURS - 5) * HOUR_MS,
    }),
  );
  assert.equal(recentEntry.targetPair, "BTC/AUD");
  assert.equal(recentEntry.reason, "retain-during-minimum-hold");

  const rotated = await decideVolatilityExpansion(
    input({ pair: "BTC/AUD", enteredAtMs: 0 }),
  );
  assert.equal(rotated.targetPair, "ETH/AUD");
  assert.equal(rotated.reason, "rotate-to-stronger-volatility-expansion");

  const retained = await decideVolatilityExpansion(
    input({ pair: "BTC/AUD", enteredAtMs: 0 }),
    {
      ...VOLATILITY_EXPANSION_BASELINE_POLICY,
      rotationScoreLead: 1,
    },
  );
  assert.equal(retained.targetPair, "BTC/AUD");
  assert.equal(retained.reason, "retain-active-expansion");
});

test("channel or trend exit overrides the minimum hold", async () => {
  const value = input({
    pair: "BTC/AUD",
    enteredAtMs: (HOURS - 5) * HOUR_MS,
  });
  const decision = await decideVolatilityExpansion({
    ...value,
    hourlyClosesByPair: {
      ...value.hourlyClosesByPair,
      "BTC/AUD": exitHistory(),
    },
  });
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.reason, "exit-channel-or-trend-to-aud");
});

test("exits an ineligible holding without same-signal replacement", async () => {
  const decision = await decideVolatilityExpansion(
    input({ pair: "SOL/AUD", enteredAtMs: 0 }),
  );
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.reason, "exit-ineligible-position-to-aud");
});

test("keeps baseline and compression evidence strictly before the recent window", async () => {
  const decision = await decideVolatilityExpansion(input());
  const signal = decision.signals.find(
    (value) => value.pair === "ETH/AUD",
  )!;
  assert.ok(signal.latestClose > signal.priorBreakoutHigh);
  assert.ok(signal.breakoutDistance > 0);
  assert.ok(
    signal.recentAnnualisedVolatility >
      signal.baselineAnnualisedVolatility,
  );
  assert.ok(
    signal.compressionAnnualisedVolatility <
      signal.baselineAnnualisedVolatility,
  );
  assert.equal(signal.signalTimestampMs, HOURS * HOUR_MS);
});

test("fails closed on identity, membership, time, history and policy drift", async () => {
  const value = input();
  await assert.rejects(
    decideVolatilityExpansion({
      ...value,
      universeSnapshotSha256: "not-a-digest",
    }),
    /snapshot identity is invalid/u,
  );
  await assert.rejects(
    decideVolatilityExpansion({
      ...value,
      eligiblePairs: ["ETH/AUD", "BTC/AUD"],
    }),
    /not canonical and sorted/u,
  );
  await assert.rejects(
    decideVolatilityExpansion({
      ...value,
      hourlyClosesByPair: {
        ...value.hourlyClosesByPair,
        "SOL/AUD": expansionHistory(0.02),
      },
    }),
    /do not match eligible membership/u,
  );
  await assert.rejects(
    decideVolatilityExpansion({
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
    decideVolatilityExpansion(
      value,
      {
        ...VOLATILITY_EXPANSION_BASELINE_POLICY,
        recentVolatilityHours: 180,
      },
    ),
    /policy is invalid/u,
  );
  await assert.rejects(
    decideVolatilityExpansion(
      input({
        pair: "BTC/AUD",
        enteredAtMs: (HOURS + 1) * HOUR_MS,
      }),
    ),
    /position chronology is invalid/u,
  );
});
