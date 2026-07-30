import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareCrossSectionalMomentumBacktestPlan,
  runCrossSectionalMomentumResearch,
  verifyCrossSectionalMomentumBacktestPlan,
  verifyCrossSectionalMomentumResearchRun,
  type CrossSectionalMomentumBacktestFrame,
  type CrossSectionalMomentumUniverseMembership,
} from "../src/backtest/crossSectionalMomentum.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import type { HourlyClose } from "../src/strategies/crossSectionalMomentum.ts";

const HOUR_MS = 3_600_000;
const HISTORY_LENGTH = 721;

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
  eligiblePairs: readonly string[] = ["BTC/AUD", "ETH/AUD"],
): Promise<CrossSectionalMomentumUniverseMembership> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs,
    snapshotAsOfMs: decisionAtMs - HOUR_MS,
    snapshotAvailableAtMs: decisionAtMs,
    snapshotSha256: "a".repeat(64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs,
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

async function frame(
  startHour: number,
  eligiblePairs: readonly string[] = ["BTC/AUD", "ETH/AUD"],
  marketPairs: readonly string[] = eligiblePairs,
): Promise<CrossSectionalMomentumBacktestFrame> {
  const decisionAtMs = (startHour + HISTORY_LENGTH) * HOUR_MS;
  const closes = {
    "BTC/AUD": history(startHour, 0.0005),
    "ETH/AUD": history(startHour, 0.001),
  } as const;
  return {
    membership: await membership(decisionAtMs, eligiblePairs),
    hourlyClosesByPair: Object.fromEntries(
      eligiblePairs.map((pair) => [
        pair,
        closes[pair as keyof typeof closes],
      ]),
    ),
    executionTimestampMs: decisionAtMs + HOUR_MS,
    markets: marketPairs.map((pair) => ({
      pair,
      midPriceAud:
        closes[pair as keyof typeof closes].at(-1)!.close,
      spreadBps: 5,
      availableQuoteVolumeAud: 1_000_000,
    })),
    executionStyle: "taker",
  };
}

test("binds exact signal-time membership to execution-aware steps", async () => {
  const plan = await prepareCrossSectionalMomentumBacktestPlan([
    await frame(0),
  ]);
  await verifyCrossSectionalMomentumBacktestPlan(plan);
  assert.equal(
    plan.boundDecisions[0]?.decision.targetPair,
    "ETH/AUD",
  );
  assert.equal(plan.steps[0]?.targets[0]?.targetWeight, 0.95);
  assert.equal(
    plan.steps[0]?.universeMembership.membershipSha256,
    plan.boundDecisions[0]?.membershipSha256,
  );
  assert.equal(plan.candidateStatus, "research-only-unselected");
  assert.equal(plan.executionAuthority, "none");
});

test("carries entry chronology and exits an ineligible holding to AUD", async () => {
  const first = await frame(0);
  const second = await frame(
    2,
    ["BTC/AUD"],
    ["BTC/AUD", "ETH/AUD"],
  );
  const plan = await prepareCrossSectionalMomentumBacktestPlan([
    first,
    second,
  ]);
  assert.deepEqual(plan.boundDecisions[1]?.positionBefore, {
    pair: "ETH/AUD",
    enteredAtMs: first.membership.decisionAtMs,
  });
  assert.equal(
    plan.boundDecisions[1]?.decision.reason,
    "exit-ineligible-position-to-aud",
  );
  assert.equal(plan.boundDecisions[1]?.positionAfter, null);
  assert.deepEqual(plan.steps[1]?.targets, []);
  assert.deepEqual(
    plan.steps[1]?.markets.map((market) => market.pair),
    ["BTC/AUD", "ETH/AUD"],
  );
});

test("passes only the verified plan to the universe-bound engine contract", async () => {
  const plan = await prepareCrossSectionalMomentumBacktestPlan([
    await frame(0),
  ]);
  let observedSteps = 0;
  const run = await runCrossSectionalMomentumResearch(
    { initialCashAud: 200 },
    plan,
    (config, steps) => {
      observedSteps = steps.length;
      return {
        initialCashAud: config.initialCashAud,
        membershipSha256s: steps.map(
          (step) => step.universeMembership.membershipSha256,
        ),
        targetPairs: steps.flatMap((step) =>
          step.targets.map((target) => target.pair)
        ),
      };
    },
  );
  assert.equal(observedSteps, 1);
  assert.equal(run.engineContract, "run-universe-bound-backtest-v1");
  assert.deepEqual(run.config, { initialCashAud: 200 });
  assert.equal(run.result.initialCashAud, 200);
  assert.deepEqual(run.result.targetPairs, ["ETH/AUD"]);
  assert.match(run.resultSha256, /^[0-9a-f]{64}$/u);
  assert.match(run.runSha256, /^[0-9a-f]{64}$/u);
  assert.equal(run.executionAuthority, "none");

  const runner = (
    config: { readonly initialCashAud: number },
    steps: Parameters<
      Parameters<typeof runCrossSectionalMomentumResearch>[2]
    >[1],
  ) => ({
    initialCashAud: config.initialCashAud,
    membershipSha256s: steps.map(
      (step) => step.universeMembership.membershipSha256,
    ),
    targetPairs: steps.flatMap((step) =>
      step.targets.map((target) => target.pair)
    ),
  });
  await verifyCrossSectionalMomentumResearchRun(plan, run, runner);
  await assert.rejects(
    verifyCrossSectionalMomentumResearchRun(
      plan,
      {
        ...run,
        config: { initialCashAud: 201 },
      },
      runner,
    ),
    /not reproducible/u,
  );
});

test("fails closed on time drift, membership tampering and target tampering", async () => {
  const valid = await frame(0);
  await assert.rejects(
    prepareCrossSectionalMomentumBacktestPlan([
      {
        ...valid,
        membership: await membership(
          valid.membership.decisionAtMs + HOUR_MS,
        ),
        executionTimestampMs: valid.executionTimestampMs + HOUR_MS,
      },
    ]),
    /closed-candle time does not match/u,
  );
  await assert.rejects(
    prepareCrossSectionalMomentumBacktestPlan([
      {
        ...valid,
        membership: {
          ...valid.membership,
          eligiblePairs: ["BTC/AUD"],
        },
      },
    ]),
    /membership identity is invalid/u,
  );
  const plan = await prepareCrossSectionalMomentumBacktestPlan([valid]);
  await assert.rejects(
    verifyCrossSectionalMomentumBacktestPlan({
      ...plan,
      steps: [
        {
          ...plan.steps[0]!,
          targets: [
            {
              pair: "BTC/AUD",
              targetWeight: 0.95,
              executionStyle: "taker",
            },
          ],
        },
      ],
    }),
    /evidence binding is invalid|plan identity is invalid/u,
  );
  const originalHistory =
    plan.steps[0]!.hourlyClosesByPair["ETH/AUD"]!;
  await assert.rejects(
    verifyCrossSectionalMomentumBacktestPlan({
      ...plan,
      steps: [
        {
          ...plan.steps[0]!,
          hourlyClosesByPair: {
            ...plan.steps[0]!.hourlyClosesByPair,
            "ETH/AUD": originalHistory.map((observation, index) =>
              index === originalHistory.length - 1
                ? { ...observation, close: observation.close * 0.5 }
                : observation
            ),
          },
        },
      ],
    }),
    /evidence binding is invalid/u,
  );
});
