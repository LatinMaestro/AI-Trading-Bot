import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseScenarioRisk,
  calculateObjectiveProgress,
  movingBlockBootstrapEquityPaths,
  objectiveReferenceEquity,
} from "../src/research/objectiveMetrics.ts";
import type {
  ObjectiveDefinition,
  ScenarioEquityPath,
} from "../src/research/objectiveMetrics.ts";

const objective: ObjectiveDefinition = {
  currency: "USD",
  initialEquity: 200,
  targetEquity: 1_000_000,
  horizonMonths: 60,
};

function close(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("five-year objective path matches the compound reference milestones", () => {
  close(objectiveReferenceEquity(objective, 0), 200);
  close(objectiveReferenceEquity(objective, 12), 1_098.5605433061174);
  close(objectiveReferenceEquity(objective, 24), 6_034.176336545164);
  close(objectiveReferenceEquity(objective, 36), 33_144.54017339987);
  close(objectiveReferenceEquity(objective, 48), 182_056.42030260802);
  close(objectiveReferenceEquity(objective, 60), 1_000_000, 1e-5);
  close(objectiveReferenceEquity(objective, 72), 1_000_000, 1e-5);
});

test("objective progress reports required forward rates and terminal states", () => {
  const onPathEquity = objectiveReferenceEquity(objective, 24);
  const onPath = calculateObjectiveProgress(objective, onPathEquity, 24);
  assert.equal(onPath.status, "on-path");
  close(onPath.requiredMonthlyCompoundPct ?? -1, 15.25227320976148, 1e-9);
  close(onPath.requiredAnnualCompoundPct ?? -1, 449.28027165305904, 1e-8);

  assert.equal(calculateObjectiveProgress(objective, onPathEquity * 2, 24).status, "ahead");
  assert.equal(calculateObjectiveProgress(objective, onPathEquity / 2, 24).status, "behind");

  const met = calculateObjectiveProgress(objective, 1_100_000, 30);
  assert.equal(met.status, "met");
  assert.equal(met.requiredMonthlyCompoundPct, 0);

  const expired = calculateObjectiveProgress(objective, 999_999, 60);
  assert.equal(expired.status, "expired");
  assert.equal(expired.requiredAnnualCompoundPct, null);

  const ruined = calculateObjectiveProgress(objective, 0, 10);
  assert.equal(ruined.status, "ruined");
  assert.equal(ruined.remainingMultiple, null);
});

test("scenario analysis separates target attainment, terminal loss and drawdown risk", () => {
  const paths: ScenarioEquityPath[] = [
    { scenarioId: "target", periodCadenceMonths: 30, equity: [200, 400, 1_000_000] },
    { scenarioId: "loss-75", periodCadenceMonths: 30, equity: [200, 100, 50] },
    { scenarioId: "loss-95", periodCadenceMonths: 30, equity: [200, 20, 10] },
    { scenarioId: "recovered", periodCadenceMonths: 30, equity: [200, 500, 200] },
  ];
  const result = analyseScenarioRisk(objective, paths);

  assert.equal(result.scenarioCount, 4);
  assert.equal(result.periodsPerScenario, 2);
  assert.equal(result.periodCadenceMonths, 30);
  assert.equal(result.horizonMonths, 60);
  assert.equal(result.targetEverAttainmentProbability, 0.25);
  assert.equal(result.targetTerminalAttainmentProbability, 0.25);
  assert.equal(result.terminalLossProbability50, 0.5);
  assert.equal(result.terminalLossProbability75, 0.5);
  assert.equal(result.terminalSubstantialLossProbability, 0.25);
  assert.equal(result.maximumDrawdownProbability50, 0.75);
  assert.equal(result.maximumDrawdownProbability75, 0.5);
  assert.equal(result.maximumDrawdownSubstantialProbability, 0.25);
  assert.equal(result.terminalWealth.p50, 125);
  close(result.maximumDrawdownFraction.p50, 0.675);
});

test("moving-block bootstrap is deterministic and retains consecutive returns within blocks", () => {
  const returns = [0.1, 0.2, -0.1, -0.2];
  const options = {
    scenarioCount: 3,
    periodsPerScenario: 8,
    blockLength: 2,
    periodCadenceMonths: 1,
    seed: 123456,
  } as const;
  const first = movingBlockBootstrapEquityPaths(200, returns, options);
  const second = movingBlockBootstrapEquityPaths(200, returns, options);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.ok(first.every((path) => path.equity.length === 9));
  assert.ok(first.every((path) => path.equity.every((value) => value >= 0)));

  const sampledReturns = first[0]?.equity.slice(1).map((value, index) => {
    const previous = first[0]?.equity[index];
    if (previous === undefined) throw new Error("Missing prior equity");
    return value / previous - 1;
  });
  if (sampledReturns === undefined) throw new Error("Missing bootstrap path");
  for (let index = 0; index < sampledReturns.length; index += 2) {
    const firstReturn = sampledReturns[index];
    const secondReturn = sampledReturns[index + 1];
    if (firstReturn === undefined || secondReturn === undefined) {
      throw new Error("Incomplete sampled block");
    }
    const sourceIndex = returns.findIndex((value) => Math.abs(value - firstReturn) < 1e-12);
    assert.notEqual(sourceIndex, -1);
    close(secondReturn, returns[(sourceIndex + 1) % returns.length] ?? Number.NaN, 1e-12);
  }
});

test("objective and scenario inputs fail closed when malformed", () => {
  assert.throws(
    () => objectiveReferenceEquity({ ...objective, horizonMonths: 0 }, 1),
    /horizonMonths/,
  );
  assert.throws(() => analyseScenarioRisk(objective, []), /At least one scenario/);
  assert.throws(
    () =>
      analyseScenarioRisk(objective, [
        { scenarioId: "duplicate", periodCadenceMonths: 30, equity: [200, 210] },
        { scenarioId: "duplicate", periodCadenceMonths: 30, equity: [200, 220] },
      ]),
    /Duplicate scenarioId/,
  );
  assert.throws(
    () => analyseScenarioRisk(objective, [{ scenarioId: "wrong-start", periodCadenceMonths: 30, equity: [201, 210] }]),
    /start at initialEquity/,
  );
  assert.throws(
    () =>
      analyseScenarioRisk(objective, [
        { scenarioId: "short", periodCadenceMonths: 30, equity: [200, 210] },
        { scenarioId: "long", periodCadenceMonths: 30, equity: [200, 210, 220] },
      ]),
    /same horizon and cadence/,
  );
  assert.throws(
    () =>
      analyseScenarioRisk(objective, [
        { scenarioId: "monthly", periodCadenceMonths: 1, equity: [200, 210, 220] },
        { scenarioId: "quarterly", periodCadenceMonths: 3, equity: [200, 210, 220] },
      ]),
    /same horizon and cadence/,
  );
  assert.throws(
    () =>
      analyseScenarioRisk(objective, [
        { scenarioId: "wrong-horizon", periodCadenceMonths: 12, equity: [200, 210, 220] },
      ]),
    /objective horizon/,
  );
  assert.throws(
    () =>
      objectiveReferenceEquity(
        { currency: "USD", initialEquity: Number.MIN_VALUE, targetEquity: Number.MAX_VALUE, horizonMonths: 60 },
        1,
      ),
    /finite/,
  );
  assert.throws(
    () => movingBlockBootstrapEquityPaths(200, [0.1, -1.01], {
      scenarioCount: 1,
      periodsPerScenario: 1,
      blockLength: 1,
      periodCadenceMonths: 1,
      seed: 1,
    }),
    /cannot be less than -1/,
  );
  assert.throws(
    () => movingBlockBootstrapEquityPaths(200, [0.1], {
      scenarioCount: 1,
      periodsPerScenario: 1,
      blockLength: 2,
      periodCadenceMonths: 1,
      seed: 1,
    }),
    /blockLength/,
  );
});
