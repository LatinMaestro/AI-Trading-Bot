import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareCrossSectionalMomentumBacktestPlan,
  runCrossSectionalMomentumResearch,
  type CrossSectionalMomentumBacktestFrame,
  type CrossSectionalMomentumBacktestStep,
  type CrossSectionalMomentumUniverseMembership,
} from "../src/backtest/crossSectionalMomentum.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import {
  prepareCrossSectionalMomentumSensitivityManifest,
  prepareCrossSectionalMomentumWalkForwardManifest,
  type CrossSectionalMomentumEvaluationRunInput,
} from "../src/research/crossSectionalMomentumEvaluation.ts";
import {
  CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  type CrossSectionalMomentumPolicy,
  type HourlyClose,
} from "../src/strategies/crossSectionalMomentum.ts";
import {
  prepareCrossSectionalMomentumEvaluationPersistence,
  prepareCrossSectionalMomentumResearchRunPersistence,
} from "../src/storage/crossSectionalMomentumResearch.ts";

const HOUR_MS = 3_600_000;
const HISTORY_LENGTH = 721;
const CONFIG = Object.freeze({ initialCashAud: 200 });

interface ResearchResult {
  readonly decisionCount: number;
  readonly membershipSha256s: readonly string[];
  readonly targetPairs: readonly string[];
}

function runner(
  _config: typeof CONFIG,
  steps: readonly CrossSectionalMomentumBacktestStep[],
): ResearchResult {
  return {
    decisionCount: steps.length,
    membershipSha256s: steps.map(
      (step) => step.universeMembership.membershipSha256,
    ),
    targetPairs: steps.flatMap((step) =>
      step.targets.map((target) => target.pair)
    ),
  };
}

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
): Promise<CrossSectionalMomentumUniverseMembership> {
  const snapshotSeed = (decisionAtMs / HOUR_MS)
    .toString(16)
    .padStart(64, "a")
    .slice(-64);
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs,
    snapshotAsOfMs: decisionAtMs - HOUR_MS,
    snapshotAvailableAtMs: decisionAtMs,
    snapshotSha256: snapshotSeed,
    signedPolicySha256: "b".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

async function frame(
  startHour: number,
  quoteVolumeAud = 1_000_000,
): Promise<CrossSectionalMomentumBacktestFrame> {
  const decisionAtMs = (startHour + HISTORY_LENGTH) * HOUR_MS;
  const closes = {
    "BTC/AUD": history(startHour, 0.0005),
    "ETH/AUD": history(startHour, 0.001),
  } as const;
  return {
    membership: await membership(decisionAtMs),
    hourlyClosesByPair: closes,
    executionTimestampMs: decisionAtMs + HOUR_MS,
    markets: ["BTC/AUD", "ETH/AUD"].map((pair) => ({
      pair,
      midPriceAud:
        closes[pair as keyof typeof closes].at(-1)!.close,
      spreadBps: 5,
      availableQuoteVolumeAud: quoteVolumeAud,
    })),
    executionStyle: "taker",
  };
}

async function evaluationRun(
  startHour: number,
  policy: CrossSectionalMomentumPolicy =
    CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  quoteVolumeAud = 1_000_000,
): Promise<
  CrossSectionalMomentumEvaluationRunInput<
    typeof CONFIG,
    ResearchResult
  >
> {
  const plan = await prepareCrossSectionalMomentumBacktestPlan(
    [await frame(startHour, quoteVolumeAud)],
    policy,
  );
  return {
    plan,
    run: await runCrossSectionalMomentumResearch(
      CONFIG,
      plan,
      runner,
    ),
  };
}

test("binds ordered walk-forward folds and a later final holdout", async () => {
  const manifest =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      [
        {
          foldIndex: 0,
          training: await evaluationRun(0),
          validation: await evaluationRun(2),
        },
        {
          foldIndex: 1,
          training: await evaluationRun(4),
          validation: await evaluationRun(6),
        },
      ],
      await evaluationRun(8),
      runner,
    );
  assert.equal(manifest.folds.length, 2);
  assert.equal(
    manifest.finalHoldout.startAtMs,
    (8 + HISTORY_LENGTH) * HOUR_MS,
  );
  assert.match(
    manifest.finalHoldout.evidenceSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(manifest.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.equal(manifest.candidateStatus, "research-only-unselected");
  assert.equal(manifest.executionAuthority, "none");
  assert.equal("selectedRunSha256" in manifest, false);
});

test("walk-forward identity is deterministic and rejects reused evidence", async () => {
  const fold = {
    foldIndex: 0,
    training: await evaluationRun(0),
    validation: await evaluationRun(2),
  };
  const holdout = await evaluationRun(4);
  const first =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      [fold],
      holdout,
      runner,
    );
  const second =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      [{ ...fold }],
      holdout,
      runner,
    );
  assert.equal(first.manifestSha256, second.manifestSha256);
  await assert.rejects(
    prepareCrossSectionalMomentumWalkForwardManifest(
      [{ foldIndex: 0, training: fold.training, validation: holdout }],
      fold.training,
      runner,
    ),
    /final holdout chronology or identity is invalid/u,
  );
});

test("sensitivity binds exact evidence without ranking or selection", async () => {
  const variantPolicy: CrossSectionalMomentumPolicy = {
    ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
    minimumHoldHours: 48,
  };
  const variant = await evaluationRun(0, variantPolicy);
  const baseline = await evaluationRun(0);
  const first =
    await prepareCrossSectionalMomentumSensitivityManifest(
      [variant, baseline],
      runner,
    );
  const second =
    await prepareCrossSectionalMomentumSensitivityManifest(
      [baseline, variant],
      runner,
    );
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.variants.length, 2);
  assert.equal(
    first.variants.filter(
      (item) =>
        item.policySha256 === first.baselinePolicySha256,
    ).length,
    1,
  );
  assert.equal("selectedPolicySha256" in first, false);
  assert.equal("ranking" in first, false);
  assert.equal(first.selectionAuthority, "none");
});

test("sensitivity fails closed when market evidence differs", async () => {
  await assert.rejects(
    prepareCrossSectionalMomentumSensitivityManifest(
      [
        await evaluationRun(0),
        await evaluationRun(
          0,
          {
            ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
            rotationScoreLead: 0.06,
          },
          900_000,
        ),
      ],
      runner,
    ),
    /share exact configuration and evidence/u,
  );
});

function researchDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0031_cross_sectional_momentum_research.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}

test("persists replayed research runs immutably with zero authority", async () => {
  const evaluation = await evaluationRun(0);
  const persistedAtMs = (HISTORY_LENGTH + 2) * HOUR_MS;
  const statement =
    await prepareCrossSectionalMomentumResearchRunPersistence({
      ...evaluation,
      runner,
      persistedAtMs,
    });
  const retry =
    await prepareCrossSectionalMomentumResearchRunPersistence({
      ...evaluation,
      runner,
      persistedAtMs: persistedAtMs + HOUR_MS,
    });
  const db = researchDatabase();
  db.prepare(statement.sql).run(...statement.params);
  db.prepare(retry.sql).run(...retry.params);
  const row = db
    .prepare(
      `SELECT run_sha256, plan_sha256, result_sha256, decision_count,
              membership_count, persisted_at_ms,
              json_extract(run_canonical_json, '$.candidateStatus')
                AS candidate_status,
              json_extract(run_canonical_json, '$.executionAuthority')
                AS execution_authority
       FROM cross_sectional_momentum_research_runs`,
    )
    .get() as Record<string, string | number>;
  assert.deepEqual({ ...row }, {
    run_sha256: evaluation.run.runSha256,
    plan_sha256: evaluation.plan.planSha256,
    result_sha256: evaluation.run.resultSha256,
    decision_count: 1,
    membership_count: 1,
    persisted_at_ms: persistedAtMs,
    candidate_status: "research-only-unselected",
    execution_authority: "none",
  });

  const conflicting = [...statement.params];
  conflicting[4] = "f".repeat(64);
  assert.throws(
    () => db.prepare(statement.sql).run(...conflicting),
    /research run conflict/u,
  );
  const authorityEscalation = [...statement.params];
  authorityEscalation[13] = String(authorityEscalation[13]).replace(
    '"executionAuthority":"none"',
    '"executionAuthority":"live"',
  );
  const authorityDb = researchDatabase();
  assert.throws(
    () =>
      authorityDb
        .prepare(statement.sql)
        .run(...authorityEscalation),
    /CHECK constraint failed/u,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE cross_sectional_momentum_research_runs
           SET persisted_at_ms = persisted_at_ms + 1`,
        )
        .run(),
    /immutable/u,
  );
});

test("commits only complete evaluation manifests bound to exact stored runs", async () => {
  const folds = [{
    foldIndex: 0,
    training: await evaluationRun(0),
    validation: await evaluationRun(2),
  }];
  const finalHoldout = await evaluationRun(4);
  const manifest =
    await prepareCrossSectionalMomentumWalkForwardManifest(
      folds,
      finalHoldout,
      runner,
    );
  const persistedAtMs = (4 + HISTORY_LENGTH + 2) * HOUR_MS;
  const runInputs = [
    folds[0]!.training,
    folds[0]!.validation,
    finalHoldout,
  ];
  const runStatements = await Promise.all(
    runInputs.map((evaluation) =>
      prepareCrossSectionalMomentumResearchRunPersistence({
        ...evaluation,
        runner,
        persistedAtMs,
      })
    ),
  );
  const statements =
    await prepareCrossSectionalMomentumEvaluationPersistence({
      kind: "walk-forward",
      folds,
      finalHoldout,
      manifest,
      runner,
      persistedAtMs,
    });
  const db = researchDatabase();
  for (const statement of runStatements) {
    db.prepare(statement.sql).run(...statement.params);
  }
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.params);
  }
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.params);
  }
  const row = db
    .prepare(
      `SELECT manifest_kind, component_run_count, fold_count,
              variant_count, persisted_at_ms
       FROM cross_sectional_momentum_evaluation_manifests`,
    )
    .get() as Record<string, string | number | null>;
  assert.deepEqual({ ...row }, {
    manifest_kind: "walk-forward",
    component_run_count: 3,
    fold_count: 1,
    variant_count: null,
    persisted_at_ms: persistedAtMs,
  });
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM cross_sectional_momentum_evaluation_manifest_commits`,
        )
        .get() as { readonly count: number }
    ).count,
    1,
  );

  const incomplete = researchDatabase();
  for (const statement of runStatements) {
    incomplete.prepare(statement.sql).run(...statement.params);
  }
  incomplete.prepare(statements[0]!.sql).run(...statements[0]!.params);
  incomplete.prepare(statements[1]!.sql).run(...statements[1]!.params);
  assert.throws(
    () =>
      incomplete
        .prepare(statements.at(-1)!.sql)
        .run(...statements.at(-1)!.params),
    /manifest is incomplete/u,
  );

  const badMember = [...statements[1]!.params];
  badMember[7] = "e".repeat(64);
  const invalid = researchDatabase();
  for (const statement of runStatements) {
    invalid.prepare(statement.sql).run(...statement.params);
  }
  invalid.prepare(statements[0]!.sql).run(...statements[0]!.params);
  assert.throws(
    () => invalid.prepare(statements[1]!.sql).run(...badMember),
    /member evidence is invalid/u,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "DELETE FROM cross_sectional_momentum_evaluation_manifest_runs",
        )
        .run(),
    /immutable/u,
  );
});

test("persists deterministic sensitivity membership without ranking", async () => {
  const variants = [
    await evaluationRun(0),
    await evaluationRun(0, {
      ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
      rotationScoreLead: 0.06,
    }),
  ];
  const manifest =
    await prepareCrossSectionalMomentumSensitivityManifest(
      variants,
      runner,
    );
  const persistedAtMs = (HISTORY_LENGTH + 2) * HOUR_MS;
  const statements =
    await prepareCrossSectionalMomentumEvaluationPersistence({
      kind: "sensitivity",
      variants,
      manifest,
      runner,
      persistedAtMs,
    });
  const db = researchDatabase();
  for (const evaluation of variants) {
    const statement =
      await prepareCrossSectionalMomentumResearchRunPersistence({
        ...evaluation,
        runner,
        persistedAtMs,
      });
    db.prepare(statement.sql).run(...statement.params);
  }
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.params);
  }
  const memberKinds = db
    .prepare(
      `SELECT member_kind AS memberKind
       FROM cross_sectional_momentum_evaluation_manifest_runs
       ORDER BY member_index`,
    )
    .all() as unknown as {
      readonly memberKind: string;
    }[];
  assert.deepEqual(
    memberKinds.map((row) => row.memberKind),
    ["sensitivity-variant", "sensitivity-variant"],
  );
  const canonicalManifest = db
    .prepare(
      `SELECT manifest_canonical_json AS manifestJson
       FROM cross_sectional_momentum_evaluation_manifests`,
    )
    .get() as { readonly manifestJson: string };
  assert.equal(canonicalManifest.manifestJson.includes("ranking"), false);
  assert.equal(
    canonicalManifest.manifestJson.includes("selectedPolicySha256"),
    false,
  );
});

test("rejects changed or premature persistence evidence", async () => {
  const variants = [
    await evaluationRun(0),
    await evaluationRun(0, {
      ...CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
      minimumHoldHours: 48,
    }),
  ];
  const manifest =
    await prepareCrossSectionalMomentumSensitivityManifest(
      variants,
      runner,
    );
  await assert.rejects(
    prepareCrossSectionalMomentumEvaluationPersistence({
      kind: "sensitivity",
      variants,
      manifest: {
        ...manifest,
        decisionCount: manifest.decisionCount + 1,
      },
      runner,
      persistedAtMs: manifest.evaluationEndAtMs + HOUR_MS,
    }),
    /not reproducible/u,
  );
  await assert.rejects(
    prepareCrossSectionalMomentumEvaluationPersistence({
      kind: "sensitivity",
      variants,
      manifest,
      runner,
      persistedAtMs: manifest.evaluationEndAtMs - 1,
    }),
    /persistence chronology/u,
  );
});
