import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseScenarioRisk,
  evaluateObjectiveProgress,
  generateBlockBootstrapPaths,
  objectiveReferenceEquity,
} from "../src/research/objectiveRisk.ts";
import type { ObjectiveConfig } from "../src/research/objectiveRiskTypes.ts";

const objective: ObjectiveConfig = {
  initialEquity: 200,
  targetEquity: 1_000_000,
  horizonMonths: 60,
};

function closeTo(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("builds the five-year constant-compounding objective path", () => {
  assert.equal(objectiveReferenceEquity(objective, 0), 200);
  closeTo(objectiveReferenceEquity(objective, 12), 1_098.560543, 0.001);
  closeTo(objectiveReferenceEquity(objective, 60), 1_000_000, 0.001);
  closeTo(objectiveReferenceEquity(objective, 72), 1_000_000, 0.001);
});

test("reports objective progress and required forward returns without promises", () => {
  const reference = objectiveReferenceEquity(objective, 12);
  const onTrack = evaluateObjectiveProgress(objective, reference, 12);
  closeTo(onTrack.progressVsReference, 1);
  assert.equal(onTrack.onOrAheadOfReference, true);
  assert.equal(onTrack.remainingMonths, 48);
  assert.ok((onTrack.requiredMonthlyCompoundReturn ?? 0) > 0);

  const behind = evaluateObjectiveProgress(objective, 500, 12);
  assert.equal(behind.onOrAheadOfReference, false);
  assert.ok(
    (behind.requiredMonthlyCompoundReturn ?? 0) >
      (onTrack.requiredMonthlyCompoundReturn ?? 0),
  );

  const expired = evaluateObjectiveProgress(objective, 900_000, 60);
  assert.equal(expired.horizonExpired, true);
  assert.equal(expired.requiredMonthlyCompoundReturn, null);
  assert.equal(expired.requiredAnnualCompoundReturn, null);
});

test("summarises target attainment, loss breaches and terminal wealth", () => {
  const summary = analyseScenarioRisk(
    [
      [200, 100, 1_000_000],
      [200, 1_000_000, 100],
      [200, 50, 100],
      [200, 9, 20],
      [200, 300, 250],
    ],
    objective,
  );

  assert.equal(summary.scenarioCount, 5);
  assert.equal(summary.targetHitProbability, 0.4);
  assert.equal(summary.terminalTargetProbability, 0.2);
  assert.equal(summary.loss50BreachProbability, 0.8);
  assert.equal(summary.loss75BreachProbability, 0.4);
  assert.equal(summary.substantialLossBreachProbability, 0.2);
  assert.equal(summary.terminalWealth.p50, 100);
  assert.equal(summary.medianTerminalMultiple, 0.5);
  assert.ok(summary.maximumDrawdown.p95 > 0.9);
});

test("block bootstrap is deterministic and preserves valid equity paths", () => {
  const config = {
    initialEquity: 200,
    scenarioCount: 4,
    periodsPerScenario: 12,
    blockLength: 3,
    seed: 42,
  } as const;
  const returns = [0.1, -0.05, 0.2, -0.1, 0.03];
  const first = generateBlockBootstrapPaths(returns, config);
  const second = generateBlockBootstrapPaths(returns, config);
  const different = generateBlockBootstrapPaths(returns, { ...config, seed: 43 });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(first.length, 4);
  assert.ok(first.every((path) => path.length === 13));
  assert.ok(first.every((path) => path[0] === 200));
  assert.ok(first.flat().every((equity) => Number.isFinite(equity) && equity >= 0));
});

test("invalid objectives, scenarios and bootstrap inputs fail closed", () => {
  assert.throws(
    () => objectiveReferenceEquity({ ...objective, targetEquity: 200 }, 1),
    /must exceed/,
  );
  assert.throws(() => analyseScenarioRisk([], objective), /at least one path/);
  assert.throws(
    () => analyseScenarioRisk([[201, 300]], objective),
    /begin at initialEquity/,
  );
  assert.throws(
    () => analyseScenarioRisk([[200, -1]], objective),
    /cannot be negative/,
  );
  assert.throws(
    () => analyseScenarioRisk([[200, 100]], objective, 75),
    /greater than 75/,
  );
  assert.throws(
    () =>
      generateBlockBootstrapPaths([0.1, -1], {
        initialEquity: 200,
        scenarioCount: 1,
        periodsPerScenario: 2,
        blockLength: 1,
        seed: 1,
      }),
    /greater than -1/,
  );
});
