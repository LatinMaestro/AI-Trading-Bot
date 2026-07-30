import assert from "node:assert/strict";
import test from "node:test";
import {
  decideMultiTimeframeBreakout,
  MULTI_TIMEFRAME_BREAKOUT_BASELINE_POLICY,
  type MultiTimeframeHourlyClose,
} from "../src/strategies/multiTimeframeBreakout.ts";

const HOUR_MS = 3_600_000;
const HOURS = 721;

function breakoutHistory(
  breakoutPct: number,
): readonly MultiTimeframeHourlyClose[] {
  const closes = Array.from(
    { length: HOURS - 1 },
    (_, index) => 100 * 1.0002 ** index,
  );
  for (let index = HOURS - 25; index < HOURS - 1; index += 1) {
    const previous = closes[index - 1]!;
    closes[index] = previous * (index % 2 === 0 ? 1.004 : 0.997);
  }
  closes.push(Math.max(...closes.slice(-168)) * (1 + breakoutPct));
  return closes.map((close, index) => ({
    timestampMs: index * HOUR_MS,
    close,
  }));
}

function noBreakoutHistory(): readonly MultiTimeframeHourlyClose[] {
  const values = breakoutHistory(0.01).map((value) => ({ ...value }));
  const priorHigh = Math.max(...values.slice(-25, -1).map(({ close }) => close));
  values[values.length - 1] = {
    timestampMs: (HOURS - 1) * HOUR_MS,
    close: priorHigh * 0.999,
  };
  return values;
}

function exitHistory(): readonly MultiTimeframeHourlyClose[] {
  const values = breakoutHistory(0.01).map((value) => ({ ...value }));
  const priorLow = Math.min(...values.slice(-73, -1).map(({ close }) => close));
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
    universeSnapshotSha256: "b".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
    hourlyClosesByPair: {
      "BTC/AUD": breakoutHistory(0.01),
      "ETH/AUD": breakoutHistory(0.03),
    },
    currentPosition,
  } as const;
}

test("enters the strongest exact-universe multi-timeframe breakout with zero authority", async () => {
  const decision = await decideMultiTimeframeBreakout(input());
  assert.equal(decision.targetPair, "ETH/AUD");
  assert.equal(decision.targetExposurePct, 95);
  assert.equal(
    decision.reason,
    "enter-strongest-multi-timeframe-breakout",
  );
  assert.equal(
    decision.signals.find((value) => value.pair === "ETH/AUD")!.rank,
    1,
  );
  assert.equal(decision.candidateStatus, "research-only-unselected");
  assert.equal(decision.runtimeScopeChanged, false);
  assert.equal(decision.selectionAuthority, "none");
  assert.equal(decision.activationAuthority, "none");
  assert.equal(decision.executionAuthority, "none");
  assert.match(decision.decisionSha256, /^[0-9a-f]{64}$/u);
});

test("holds AUD when no pair clears every entry gate", async () => {
  const value = input();
  const decision = await decideMultiTimeframeBreakout({
    ...value,
    hourlyClosesByPair: {
      "BTC/AUD": noBreakoutHistory(),
      "ETH/AUD": noBreakoutHistory(),
    },
  });
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.reason, "no-breakout-hold-aud");
});

test("retains during the minimum hold and rotates only above hysteresis", async () => {
  const recentEntry = await decideMultiTimeframeBreakout(
    input({
      pair: "BTC/AUD",
      enteredAtMs: (HOURS - 10) * HOUR_MS,
    }),
  );
  assert.equal(recentEntry.targetPair, "BTC/AUD");
  assert.equal(recentEntry.reason, "retain-during-minimum-hold");

  const rotated = await decideMultiTimeframeBreakout(
    input({ pair: "BTC/AUD", enteredAtMs: 0 }),
  );
  assert.equal(rotated.targetPair, "ETH/AUD");
  assert.equal(rotated.reason, "rotate-to-stronger-breakout");

  const retained = await decideMultiTimeframeBreakout(
    input({ pair: "BTC/AUD", enteredAtMs: 0 }),
    {
      ...MULTI_TIMEFRAME_BREAKOUT_BASELINE_POLICY,
      rotationScoreLead: 1,
    },
  );
  assert.equal(retained.targetPair, "BTC/AUD");
  assert.equal(retained.reason, "retain-open-trend");
});

test("channel or long-trend exit overrides the minimum hold", async () => {
  const value = input({
    pair: "BTC/AUD",
    enteredAtMs: (HOURS - 10) * HOUR_MS,
  });
  const decision = await decideMultiTimeframeBreakout({
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
  const decision = await decideMultiTimeframeBreakout(
    input({ pair: "SOL/AUD", enteredAtMs: 0 }),
  );
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.reason, "exit-ineligible-position-to-aud");
});

test("uses prior closed candles rather than including the signal candle in channels", async () => {
  const decision = await decideMultiTimeframeBreakout(input());
  const signal = decision.signals.find(
    (value) => value.pair === "ETH/AUD",
  )!;
  assert.ok(signal.latestClose > signal.fastPriorHigh);
  assert.ok(signal.latestClose > signal.mediumPriorHigh);
  assert.ok(signal.fastBreakoutDistance > 0);
  assert.ok(signal.mediumHighDistance > 0);
  assert.equal(signal.signalTimestampMs, HOURS * HOUR_MS);
});

test("fails closed on identity, membership, time, history and policy drift", async () => {
  const value = input();
  await assert.rejects(
    decideMultiTimeframeBreakout({
      ...value,
      universeSnapshotSha256: "not-a-digest",
    }),
    /snapshot identity is invalid/u,
  );
  await assert.rejects(
    decideMultiTimeframeBreakout({
      ...value,
      eligiblePairs: ["ETH/AUD", "BTC/AUD"],
    }),
    /not canonical and sorted/u,
  );
  await assert.rejects(
    decideMultiTimeframeBreakout({
      ...value,
      hourlyClosesByPair: {
        ...value.hourlyClosesByPair,
        "SOL/AUD": breakoutHistory(0.04),
      },
    }),
    /do not match eligible membership/u,
  );
  await assert.rejects(
    decideMultiTimeframeBreakout({
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
    decideMultiTimeframeBreakout(
      value,
      {
        ...MULTI_TIMEFRAME_BREAKOUT_BASELINE_POLICY,
        mediumBreakoutHours: 12,
      },
    ),
    /policy is invalid/u,
  );
  await assert.rejects(
    decideMultiTimeframeBreakout(
      input({
        pair: "BTC/AUD",
        enteredAtMs: (HOURS + 1) * HOUR_MS,
      }),
    ),
    /position chronology is invalid/u,
  );
});
