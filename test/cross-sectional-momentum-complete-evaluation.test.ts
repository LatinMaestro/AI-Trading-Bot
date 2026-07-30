import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareCrossSectionalMomentumBacktestPlan,
  runCrossSectionalMomentumResearch,
  type CrossSectionalMomentumBacktestFrame,
  type CrossSectionalMomentumBacktestStep,
  type CrossSectionalMomentumResearchRun,
  type CrossSectionalMomentumUniverseMembership,
} from "../src/backtest/crossSectionalMomentum.ts";
import type {
  BacktestConfig,
  BacktestExecution,
  BacktestResult,
} from "../src/backtest/types.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import {
  REQUIRED_CROSS_SECTIONAL_MOMENTUM_EVALUATION_WARNINGS,
  prepareCrossSectionalMomentumCompleteEvaluation,
} from "../src/research/crossSectionalMomentumCompleteEvaluation.ts";
import {
  prepareCrossSectionalMomentumSensitivityManifest,
  prepareCrossSectionalMomentumWalkForwardManifest,
  type CrossSectionalMomentumSensitivityManifest,
  type CrossSectionalMomentumWalkForwardManifest,
} from "../src/research/crossSectionalMomentumEvaluation.ts";
import {
  prepareCrossSectionalMomentumExecutionCalibration,
  prepareCrossSectionalMomentumExecutionStressManifest,
} from "../src/research/crossSectionalMomentumExecutionStress.ts";
import type {
  ResearchEquitySeries,
  ResearchReportInput,
} from "../src/research/researchReport.ts";
import {
  CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  type CrossSectionalMomentumPolicy,
  type HourlyClose,
} from "../src/strategies/crossSectionalMomentum.ts";
import {
  prepareCrossSectionalMomentumCompleteEvaluationPersistence,
} from "../src/storage/crossSectionalMomentumCompleteEvaluation.ts";
import {
  prepareCrossSectionalMomentumEvaluationPersistence,
  prepareCrossSectionalMomentumResearchRunPersistence,
} from "../src/storage/crossSectionalMomentumResearch.ts";

const HOUR_MS = 3_600_000;
const HISTORY_LENGTH = 721;
const CONFIG: BacktestConfig = {
  initialCashAud: 200,
  defaultExitStyle: "taker",
  assumptions: {
    makerFeeBps: 10,
    takerFeeBps: 20,
    takerSlippageBps: 5,
    makerAdverseSelectionBps: 2,
    impactCoefficientBps: 3,
    maximumImpactBps: 20,
    maximumParticipationRate: 0.5,
    makerFillRate: 0.8,
    minimumOrderAud: 10,
    cashReserveAud: 10,
  },
};

function history(
  offsetHours: number,
  hourlyReturn: number,
): readonly HourlyClose[] {
  return Array.from({ length: HISTORY_LENGTH }, (_, index) => ({
    timestampMs: (offsetHours + index) * HOUR_MS,
    close: 100 * (1 + hourlyReturn) ** index,
  }));
}

async function membership(
  offsetHours: number,
): Promise<CrossSectionalMomentumUniverseMembership> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs: (offsetHours + HISTORY_LENGTH) * HOUR_MS,
    snapshotAsOfMs:
      (offsetHours + HISTORY_LENGTH - 1) * HOUR_MS,
    snapshotAvailableAtMs:
      (offsetHours + HISTORY_LENGTH) * HOUR_MS,
    snapshotSha256: "a".repeat(64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
  } as const;
  return {
    ...envelope,
    membershipSha256:
      await sha256CanonicalIntelligence(envelope),
  };
}

async function frame(
  offsetHours: number,
): Promise<CrossSectionalMomentumBacktestFrame> {
  const closes = {
    "BTC/AUD": history(offsetHours, 0.0005),
    "ETH/AUD": history(offsetHours, 0.001),
  } as const;
  return {
    membership: await membership(offsetHours),
    hourlyClosesByPair: closes,
    executionTimestampMs:
      (offsetHours + HISTORY_LENGTH + 1) * HOUR_MS,
    markets: ["BTC/AUD", "ETH/AUD"].map((pair) => ({
      pair,
      midPriceAud:
        closes[pair as keyof typeof closes].at(-1)!.close,
      spreadBps: 5,
      availableQuoteVolumeAud: 10_000,
    })),
    executionStyle: "taker",
  };
}

function runner(
  config: BacktestConfig,
  steps: readonly CrossSectionalMomentumBacktestStep[],
): BacktestResult {
  const executions: BacktestExecution[] = steps.flatMap((step) =>
    step.targets.map((target) => {
      const market = step.markets.find(
        (candidate) => candidate.pair === target.pair,
      )!;
      const requestedNotionalAud =
        (config.initialCashAud -
          config.assumptions.cashReserveAud) *
        target.targetWeight;
      const fillRate =
        target.executionStyle === "maker"
          ? config.assumptions.makerFillRate
          : 1;
      const filledReferenceNotionalAud =
        Math.min(
          requestedNotionalAud,
          market.availableQuoteVolumeAud *
            config.assumptions.maximumParticipationRate,
        ) * fillRate;
      const missedNotionalAud =
        requestedNotionalAud - filledReferenceNotionalAud;
      const feeBps =
        target.executionStyle === "maker"
          ? config.assumptions.makerFeeBps
          : config.assumptions.takerFeeBps;
      const slippageBps =
        target.executionStyle === "maker"
          ? config.assumptions.makerAdverseSelectionBps
          : config.assumptions.takerSlippageBps;
      const impactBps = Math.min(
        config.assumptions.maximumImpactBps,
        config.assumptions.impactCoefficientBps *
          Math.sqrt(
            filledReferenceNotionalAud /
              market.availableQuoteVolumeAud,
          ),
      );
      return {
        timestampMs: step.executionTimestampMs,
        pair: target.pair,
        side: "buy",
        executionStyle: target.executionStyle,
        status:
          missedNotionalAud > 0
            ? "partially-filled"
            : "filled",
        requestedNotionalAud,
        filledReferenceNotionalAud,
        missedNotionalAud,
        units:
          filledReferenceNotionalAud / market.midPriceAud,
        referenceMidPriceAud: market.midPriceAud,
        executionPriceAud: market.midPriceAud,
        feeAud:
          filledReferenceNotionalAud * feeBps / 10_000,
        spreadCostAud:
          filledReferenceNotionalAud * market.spreadBps / 20_000,
        slippageCostAud:
          filledReferenceNotionalAud * slippageBps / 10_000,
        impactCostAud:
          filledReferenceNotionalAud * impactBps / 10_000,
        impactBps,
      };
    }),
  );
  const costs = {
    feesAud: executions.reduce(
      (sum, execution) => sum + execution.feeAud,
      0,
    ),
    spreadAud: executions.reduce(
      (sum, execution) => sum + execution.spreadCostAud,
      0,
    ),
    slippageAud: executions.reduce(
      (sum, execution) => sum + execution.slippageCostAud,
      0,
    ),
    impactAud: executions.reduce(
      (sum, execution) => sum + execution.impactCostAud,
      0,
    ),
    missedFillNotionalAud: executions.reduce(
      (sum, execution) => sum + execution.missedNotionalAud,
      0,
    ),
    totalAud: 0,
  };
  costs.totalAud =
    costs.feesAud +
    costs.spreadAud +
    costs.slippageAud +
    costs.impactAud;
  const finalEquityAud = Math.max(
    0,
    config.initialCashAud * 1.1 -
      costs.totalAud -
      costs.missedFillNotionalAud * 0.001,
  );
  const maximumDrawdownPct = Math.max(
    0,
    100 - finalEquityAud / config.initialCashAud * 100,
  );
  return {
    initialEquityAud: config.initialCashAud,
    finalEquityAud,
    totalReturnPct:
      (finalEquityAud / config.initialCashAud - 1) * 100,
    maximumDrawdownPct,
    turnoverMultiple:
      executions.reduce(
        (sum, execution) =>
          sum + execution.requestedNotionalAud,
        0,
      ) / config.initialCashAud,
    executions,
    equityCurve: [
      {
        timestampMs: steps[0]!.signalTimestampMs,
        equityAud: config.initialCashAud,
        cashAud: config.initialCashAud,
        grossExposureAud: 0,
        drawdownPct: 0,
      },
      {
        timestampMs: steps.at(-1)!.executionTimestampMs,
        equityAud: finalEquityAud,
        cashAud: 0,
        grossExposureAud: finalEquityAud,
        drawdownPct: maximumDrawdownPct,
      },
    ],
    finalPositions: [],
    costs,
    executionGateFrameSha256s: [],
    universeMembershipSha256s: steps.map(
      (step) => step.universeMembership.membershipSha256,
    ),
    suppressedExecutions: [],
  };
}

async function evaluationRun(
  offsetHours: number,
  policy: CrossSectionalMomentumPolicy =
    CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
) {
  const plan =
    await prepareCrossSectionalMomentumBacktestPlan(
      [await frame(offsetHours)],
      policy,
    );
  const run = await runCrossSectionalMomentumResearch(
    CONFIG,
    plan,
    runner,
  );
  return { plan, run };
}

function series(
  kind: ResearchEquitySeries["kind"],
  id: string,
  points: ResearchEquitySeries["points"],
  source: string,
): ResearchEquitySeries {
  return {
    seriesId: id,
    kind,
    currency: "AUD",
    points,
    sourceDigests: [source],
  };
}

async function reportInput(
  finalHoldout: {
    readonly plan: Awaited<ReturnType<typeof evaluationRun>>["plan"];
    readonly run: CrossSectionalMomentumResearchRun<
      BacktestConfig,
      BacktestResult
    >;
  },
  walkForward: CrossSectionalMomentumWalkForwardManifest,
  sensitivity: CrossSectionalMomentumSensitivityManifest,
  stressSha256: string,
  generatedAtMs: number,
): Promise<ResearchReportInput> {
  const strategyPoints =
    finalHoldout.run.result.equityCurve.map((point) => ({
      timestampMs: point.timestampMs,
      equity: point.equityAud,
    }));
  const universeSha256 =
    await sha256CanonicalIntelligence(
      finalHoldout.plan.steps.map(
        (step) => step.universeMembership,
      ),
    );
  const runSha256s = [
    ...walkForward.folds.flatMap((fold) => [
      fold.trainingRunSha256,
      fold.validationRunSha256,
    ]),
    walkForward.finalHoldout.runSha256,
    ...sensitivity.variants.map((variant) => variant.runSha256),
  ];
  const finalEquity = finalHoldout.run.result.finalEquityAud;
  return {
    reportId: "cross-sectional-final-holdout-v1",
    generatedAt: new Date(generatedAtMs).toISOString(),
    evaluationSplit: "final-holdout",
    periodStartMs: strategyPoints[0]!.timestampMs,
    periodEndMs: strategyPoints.at(-1)!.timestampMs,
    strategy: {
      seriesId: "cross-sectional-strategy",
      kind: "strategy",
      currency: "AUD",
      points: strategyPoints,
      sourceDigests: [
        finalHoldout.plan.planSha256,
        finalHoldout.run.runSha256,
        finalHoldout.run.resultSha256,
      ],
    },
    benchmarks: [
      series(
        "aud-cash",
        "aud-cash",
        [
          { timestampMs: strategyPoints[0]!.timestampMs, equity: 200 },
          { timestampMs: strategyPoints.at(-1)!.timestampMs, equity: 200 },
        ],
        "c".repeat(64),
      ),
      series(
        "btc-hold",
        "btc-hold",
        [
          { timestampMs: strategyPoints[0]!.timestampMs, equity: 200 },
          { timestampMs: strategyPoints.at(-1)!.timestampMs, equity: 210 },
        ],
        "d".repeat(64),
      ),
      series(
        "equal-weight-hold",
        "equal-weight-hold",
        [
          { timestampMs: strategyPoints[0]!.timestampMs, equity: 200 },
          { timestampMs: strategyPoints.at(-1)!.timestampMs, equity: 205 },
        ],
        "e".repeat(64),
      ),
      series(
        "objective-path",
        "objective-path",
        [
          { timestampMs: strategyPoints[0]!.timestampMs, equity: 200 },
          {
            timestampMs: strategyPoints.at(-1)!.timestampMs,
            equity: finalEquity,
          },
        ],
        "f".repeat(64),
      ),
    ],
    objectiveProgress: {
      currency: "AUD",
      elapsedMonths: 1,
      remainingMonths: 59,
      currentEquity: finalEquity,
      referenceEquity: finalEquity,
      progressRatioToReference: 1,
      remainingMultiple: 1_000_000 / finalEquity,
      requiredMonthlyCompoundPct: 15,
      requiredAnnualCompoundPct: 449,
      status: "on-path",
    },
    scenarioRisk: {
      scenarioCount: 100,
      periodsPerScenario: 60,
      substantialLossFraction: 0.95,
      targetEverAttainmentProbability: 0.01,
      targetTerminalAttainmentProbability: 0.01,
      terminalLossProbability50: 0.2,
      terminalLossProbability75: 0.1,
      terminalSubstantialLossProbability: 0.05,
      maximumDrawdownProbability50: 0.4,
      maximumDrawdownProbability75: 0.2,
      maximumDrawdownSubstantialProbability: 0.1,
      terminalWealth: {
        p05: 0,
        p25: 50,
        p50: 200,
        p75: 1_000,
        p95: 1_000_000,
      },
      maximumDrawdownFraction: {
        p05: 0.1,
        p25: 0.25,
        p50: 0.5,
        p75: 0.75,
        p95: 1,
      },
    },
    provenance: {
      codeSha256: "1".repeat(64),
      dataSha256: walkForward.finalHoldout.evidenceSha256,
      universeSha256,
      strategyConfigSha256:
        await sha256CanonicalIntelligence(
          finalHoldout.plan.policy,
        ),
      executionConfigSha256: finalHoldout.run.configSha256,
      objectiveConfigSha256: "2".repeat(64),
      benchmarkConfigSha256: "3".repeat(64),
      externalIntelligenceComparisonSha256s: [],
      strategyBacktestRunSha256s: [...new Set(runSha256s)],
      strategyEvaluationManifestSha256s: [
        walkForward.manifestSha256,
        sensitivity.manifestSha256,
        stressSha256,
      ],
    },
    warnings:
      REQUIRED_CROSS_SECTIONAL_MOMENTUM_EVALUATION_WARNINGS,
  };
}

async function fixture() {
  const training = await evaluationRun(0);
  const validation = await evaluationRun(3);
  const finalHoldout = await evaluationRun(6);
  const variant = await evaluationRun(6, {
    ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
    minimumWeightedMomentum: 0.01,
  });
  const walkForward =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      [{
        foldIndex: 0,
        training,
        validation,
      }],
      finalHoldout,
      runner,
    );
  const sensitivity =
    await prepareCrossSectionalMomentumSensitivityManifest(
      [finalHoldout, variant],
      runner,
    );
  const lastExecutionAtMs =
    finalHoldout.plan.steps.at(-1)!.executionTimestampMs;
  const calibration =
    await prepareCrossSectionalMomentumExecutionCalibration(
      finalHoldout.plan,
      finalHoldout.run,
      runner,
      {
        calibratedAtMs: lastExecutionAtMs,
        availableAtMs: lastExecutionAtMs + 1_000,
        validUntilMs: lastExecutionAtMs + 100_000,
        sourceSha256s: ["4".repeat(64)],
      },
    );
  const stress =
    await prepareCrossSectionalMomentumExecutionStressManifest(
      finalHoldout.plan,
      finalHoldout.run,
      runner,
      calibration,
      lastExecutionAtMs + 2_000,
    );
  const report = await reportInput(
    finalHoldout,
    walkForward,
    sensitivity,
    stress.manifestSha256,
    lastExecutionAtMs + 3_000,
  );
  return {
    training,
    validation,
    walkForward,
    sensitivity,
    finalHoldout,
    variant,
    calibration,
    stress,
    report,
  };
}

function completeEvaluationDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE research_reports (
      report_sha256 TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      report_id TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      evaluation_split TEXT NOT NULL,
      period_start_at_ms INTEGER NOT NULL,
      period_end_at_ms INTEGER NOT NULL,
      canonical_byte_length INTEGER NOT NULL CHECK (
        canonical_byte_length > 0
      ),
      chunk_count INTEGER NOT NULL CHECK (
        chunk_count BETWEEN 1 AND 90
      ),
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE research_report_chunks (
      report_sha256 TEXT NOT NULL,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      chunk_sha256 TEXT NOT NULL,
      chunk_byte_length INTEGER NOT NULL CHECK (
        chunk_byte_length > 0
      ),
      chunk_text TEXT NOT NULL,
      PRIMARY KEY (report_sha256, chunk_index),
      FOREIGN KEY (report_sha256)
        REFERENCES research_reports(report_sha256)
    );
    CREATE TABLE research_report_commits (
      report_sha256 TEXT PRIMARY KEY,
      chunk_count INTEGER NOT NULL,
      canonical_byte_length INTEGER NOT NULL,
      persisted_at_ms INTEGER NOT NULL,
      FOREIGN KEY (report_sha256)
        REFERENCES research_reports(report_sha256)
    );
    CREATE TRIGGER enforce_research_report_commit
    BEFORE INSERT ON research_report_commits
    WHEN NOT EXISTS (
      SELECT 1
      FROM research_reports report
      WHERE report.report_sha256 = NEW.report_sha256
        AND report.chunk_count = NEW.chunk_count
        AND report.canonical_byte_length =
          NEW.canonical_byte_length
        AND report.persisted_at_ms <= NEW.persisted_at_ms
        AND (
          SELECT COUNT(*)
          FROM research_report_chunks chunk
          WHERE chunk.report_sha256 = NEW.report_sha256
        ) = NEW.chunk_count
        AND (
          SELECT SUM(chunk.chunk_byte_length)
          FROM research_report_chunks chunk
          WHERE chunk.report_sha256 = NEW.report_sha256
        ) = NEW.canonical_byte_length
        AND (
          SELECT MIN(chunk.chunk_index)
          FROM research_report_chunks chunk
          WHERE chunk.report_sha256 = NEW.report_sha256
        ) = 0
        AND (
          SELECT MAX(chunk.chunk_index)
          FROM research_report_chunks chunk
          WHERE chunk.report_sha256 = NEW.report_sha256
        ) = NEW.chunk_count - 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'Research report is incomplete');
    END;
    CREATE TRIGGER prevent_research_report_update
    BEFORE UPDATE ON research_reports
    BEGIN
      SELECT RAISE(ABORT, 'Research reports are immutable');
    END;
    CREATE TRIGGER prevent_research_report_delete
    BEFORE DELETE ON research_reports
    BEGIN
      SELECT RAISE(ABORT, 'Research reports are immutable');
    END;
    CREATE TRIGGER prevent_research_report_chunk_update
    BEFORE UPDATE ON research_report_chunks
    BEGIN
      SELECT RAISE(ABORT, 'Research report chunks are immutable');
    END;
    CREATE TRIGGER prevent_research_report_chunk_delete
    BEFORE DELETE ON research_report_chunks
    BEGIN
      SELECT RAISE(ABORT, 'Research report chunks are immutable');
    END;
    CREATE TRIGGER prevent_research_report_commit_update
    BEFORE UPDATE ON research_report_commits
    BEGIN
      SELECT RAISE(ABORT, 'Research report commits are immutable');
    END;
    CREATE TRIGGER prevent_research_report_commit_delete
    BEFORE DELETE ON research_report_commits
    BEGIN
      SELECT RAISE(ABORT, 'Research report commits are immutable');
    END;
  `);
  for (const migration of [
    "../migrations/0031_cross_sectional_momentum_research.sql",
    "../migrations/0032_cross_sectional_momentum_complete_evaluations.sql",
  ]) {
    db.exec(
      readFileSync(new URL(migration, import.meta.url), "utf8"),
    );
  }
  return db;
}

function executeStatements(
  db: DatabaseSync,
  statements: readonly {
    readonly sql: string;
    readonly params: readonly (string | number | null)[];
  }[],
): void {
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.params);
  }
}

async function persistedFixture() {
  const evidence = await fixture();
  const input = {
    walkForwardManifest: evidence.walkForward,
    sensitivityManifest: evidence.sensitivity,
    finalHoldout: evidence.finalHoldout,
    runner,
    executionCalibration: evidence.calibration,
    executionStressManifest: evidence.stress,
    report: evidence.report,
  } as const;
  const evaluation =
    await prepareCrossSectionalMomentumCompleteEvaluation(input);
  const persistedAtMs = Date.parse(evidence.report.generatedAt) + 1_000;
  const db = completeEvaluationDatabase();
  const researchRuns = [
    evidence.training,
    evidence.validation,
    evidence.finalHoldout,
    evidence.variant,
  ];
  for (const researchRun of researchRuns) {
    const statement =
      await prepareCrossSectionalMomentumResearchRunPersistence({
        ...researchRun,
        runner,
        persistedAtMs,
      });
    executeStatements(db, [statement]);
  }
  executeStatements(
    db,
    await prepareCrossSectionalMomentumEvaluationPersistence({
      kind: "walk-forward",
      folds: [{
        foldIndex: 0,
        training: evidence.training,
        validation: evidence.validation,
      }],
      finalHoldout: evidence.finalHoldout,
      manifest: evidence.walkForward,
      runner,
      persistedAtMs,
    }),
  );
  executeStatements(
    db,
    await prepareCrossSectionalMomentumEvaluationPersistence({
      kind: "sensitivity",
      variants: [evidence.finalHoldout, evidence.variant],
      manifest: evidence.sensitivity,
      runner,
      persistedAtMs,
    }),
  );
  const statements =
    await prepareCrossSectionalMomentumCompleteEvaluationPersistence({
      input,
      evaluation,
      persistedAtMs,
    });
  return {
    db,
    evidence,
    input,
    evaluation,
    persistedAtMs,
    statements,
  };
}

test("binds a canonical complete report to every exact evidence identity", async () => {
  const evidence = await fixture();
  const evaluation =
    await prepareCrossSectionalMomentumCompleteEvaluation({
      walkForwardManifest: evidence.walkForward,
      sensitivityManifest: evidence.sensitivity,
      finalHoldout: evidence.finalHoldout,
      runner,
      executionCalibration: evidence.calibration,
      executionStressManifest: evidence.stress,
      report: evidence.report,
    });
  assert.equal(
    evaluation.walkForwardManifestSha256,
    evidence.walkForward.manifestSha256,
  );
  assert.equal(
    evaluation.executionStressManifestSha256,
    evidence.stress.manifestSha256,
  );
  assert.equal(evaluation.report.benchmarks.length, 4);
  assert.equal(evaluation.report.scenarioRisk.scenarioCount, 100);
  assert.equal(
    evaluation.executionCapacitySummary.stressResultCount,
    40,
  );
  assert.equal(
    evaluation.executionCapacitySummary
      .capacityConstrainedCapitalLevelsAud.includes(1_000_000),
    true,
  );
  assert.equal(evaluation.candidateStatus, "research-only-unselected");
  assert.equal(evaluation.executionAuthority, "none");
  assert.equal("selectedPolicySha256" in evaluation, false);
});

test("is reproducible and rejects changed report evidence", async () => {
  const evidence = await fixture();
  const input = {
    walkForwardManifest: evidence.walkForward,
    sensitivityManifest: evidence.sensitivity,
    finalHoldout: evidence.finalHoldout,
    runner,
    executionCalibration: evidence.calibration,
    executionStressManifest: evidence.stress,
    report: evidence.report,
  } as const;
  assert.deepEqual(
    await prepareCrossSectionalMomentumCompleteEvaluation(input),
    await prepareCrossSectionalMomentumCompleteEvaluation(input),
  );
  await assert.rejects(
    prepareCrossSectionalMomentumCompleteEvaluation({
      ...input,
      report: {
        ...evidence.report,
        provenance: {
          ...evidence.report.provenance,
          dataSha256: "9".repeat(64),
        },
      },
    }),
    /provenance is inconsistent/u,
  );
});

test("rejects manifest drift and a missing non-promotion warning", async () => {
  const evidence = await fixture();
  const input = {
    walkForwardManifest: evidence.walkForward,
    sensitivityManifest: evidence.sensitivity,
    finalHoldout: evidence.finalHoldout,
    runner,
    executionCalibration: evidence.calibration,
    executionStressManifest: evidence.stress,
    report: evidence.report,
  } as const;
  await assert.rejects(
    prepareCrossSectionalMomentumCompleteEvaluation({
      ...input,
      sensitivityManifest: {
        ...evidence.sensitivity,
        executionAuthority: "paper" as never,
      },
    }),
    /manifest identity is invalid/u,
  );
  await assert.rejects(
    prepareCrossSectionalMomentumCompleteEvaluation({
      ...input,
      report: {
        ...evidence.report,
        warnings: evidence.report.warnings.filter(
          (warning) =>
            warning !==
              "strategy-candidate-is-not-selected-or-promoted",
        ),
      },
    }),
    /requires warning/u,
  );
});

test("rejects stale reports and objective metrics detached from holdout", async () => {
  const evidence = await fixture();
  const input = {
    walkForwardManifest: evidence.walkForward,
    sensitivityManifest: evidence.sensitivity,
    finalHoldout: evidence.finalHoldout,
    runner,
    executionCalibration: evidence.calibration,
    executionStressManifest: evidence.stress,
    report: evidence.report,
  } as const;
  await assert.rejects(
    prepareCrossSectionalMomentumCompleteEvaluation({
      ...input,
      report: {
        ...evidence.report,
        generatedAt: new Date(
          evidence.stress.evaluatedAtMs - 1,
        ).toISOString(),
      },
    }),
    /predates execution stress/u,
  );
  await assert.rejects(
    prepareCrossSectionalMomentumCompleteEvaluation({
      ...input,
      report: {
        ...evidence.report,
        objectiveProgress: {
          ...evidence.report.objectiveProgress,
          currentEquity:
            evidence.report.objectiveProgress.currentEquity + 1,
        },
      },
    }),
    /metrics do not reproduce/u,
  );
});

test("persists complete cross-sectional evidence immutably and idempotently", async () => {
  const persisted = await persistedFixture();
  executeStatements(persisted.db, persisted.statements);
  executeStatements(persisted.db, persisted.statements);

  const counts = persisted.db
    .prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM cross_sectional_momentum_execution_stress_results)
           AS stress_results,
         (SELECT COUNT(*)
          FROM cross_sectional_momentum_execution_stress_commits)
           AS stress_commits,
         (SELECT COUNT(*)
          FROM research_report_commits) AS report_commits,
         (SELECT COUNT(*)
          FROM cross_sectional_momentum_complete_evaluations)
           AS complete_evaluations`,
    )
    .get() as Record<string, number>;
  assert.deepEqual({ ...counts }, {
    stress_results: 40,
    stress_commits: 1,
    report_commits: 1,
    complete_evaluations: 1,
  });

  const row = persisted.db
    .prepare(
      `SELECT evaluation_sha256, report_sha256,
              execution_stress_manifest_sha256, persisted_at_ms
       FROM cross_sectional_momentum_complete_evaluations`,
    )
    .get() as Record<string, string | number>;
  assert.deepEqual({ ...row }, {
    evaluation_sha256: persisted.evaluation.evaluationSha256,
    report_sha256: persisted.evaluation.report.reportSha256,
    execution_stress_manifest_sha256:
      persisted.evaluation.executionStressManifestSha256,
    persisted_at_ms: persisted.persistedAtMs,
  });
  assert.throws(
    () =>
      persisted.db
        .prepare(
          `UPDATE cross_sectional_momentum_complete_evaluations
           SET persisted_at_ms = persisted_at_ms + 1`,
        )
        .run(),
    /immutable/u,
  );
});

test("rejects incomplete stress and report commits", async () => {
  const persisted = await persistedFixture();
  const calibration = persisted.statements[0]!;
  const stress = persisted.statements[1]!;
  const stressResults = persisted.statements.slice(2, 42);
  const stressCommit = persisted.statements[42]!;
  const report = persisted.statements[43]!;
  const reportChunks = persisted.statements.slice(44, -2);
  const reportCommit = persisted.statements.at(-2)!;

  executeStatements(persisted.db, [
    calibration,
    stress,
    ...stressResults.slice(0, -1),
  ]);
  assert.throws(
    () => executeStatements(persisted.db, [stressCommit]),
    /stress membership is incomplete/u,
  );
  executeStatements(persisted.db, [stressResults.at(-1)!, stressCommit]);

  executeStatements(persisted.db, [report]);
  assert.ok(reportChunks.length > 0);
  assert.throws(
    () => executeStatements(persisted.db, [reportCommit]),
    /Research report is incomplete/u,
  );
});

test("rejects changed stress membership and uncommitted complete evidence", async () => {
  const persisted = await persistedFixture();
  executeStatements(persisted.db, persisted.statements.slice(0, 2));
  const firstResult = persisted.statements[2]!;
  const changed = [...firstResult.params];
  changed[5] = "f".repeat(64);
  assert.throws(
    () =>
      executeStatements(persisted.db, [{
        sql: firstResult.sql,
        params: changed,
      }]),
    /stress result is invalid/u,
  );

  const completeEvaluation = persisted.statements.at(-1)!;
  assert.throws(
    () => executeStatements(persisted.db, [completeEvaluation]),
    /complete evaluation evidence is not committed/u,
  );
});
