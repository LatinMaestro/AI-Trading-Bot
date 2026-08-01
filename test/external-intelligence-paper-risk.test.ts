import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { StrategyDecision } from "../src/domain/types.ts";
import type {
  ExternalIntelligenceItem,
  ExternalIntelligencePolicy,
} from "../src/intelligence/externalIntelligence.ts";
import { prepareExternalIntelligenceLinkage } from "../src/intelligence/externalIntelligenceLinking.ts";
import {
  prepareExternalIntelligenceManipulationEvidence,
} from "../src/intelligence/externalIntelligenceManipulation.ts";
import {
  prepareIntegratedExternalIntelligenceAssessments,
} from "../src/intelligence/externalIntelligenceAssessmentIntegration.ts";
import {
  prepareExternalIntelligenceAssessmentIntegrationPersistence,
} from "../src/storage/externalIntelligenceAssessmentIntegration.ts";
import {
  ExternalIntelligencePaperRiskRepository,
} from "../src/risk/externalIntelligencePaperRisk.ts";

const LINKED_AT_MS = Date.parse("2026-07-29T02:00:00.000Z");
const ASSESSED_AT_MS = LINKED_AT_MS + 2_000;
const POLICY: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": 3_600_000,
    regulator: 3_600_000,
    issuer: 3_600_000,
    "mainstream-news": 3_600_000,
    "specialist-news": 3_600_000,
    reddit: 3_600_000,
  },
  maximumReceiptDelayMs: 60_000,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 7_000,
  maximumItems: 20,
};

const BUY: StrategyDecision = {
  strategyVersion: "paper-test-v1",
  action: "buy",
  targetPair: "BTC/AUD",
  targetExposurePct: 90,
  reason: "breakout",
  signals: [],
};

class SQLiteD1 {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(sql: string) {
    let params: Array<string | number | null> = [];
    const prepared = this.sqlite.prepare(sql);
    const statement = {
      bind: (...values: Array<string | number | null>) => {
        params = values;
        return statement;
      },
      all: () => ({ results: prepared.all(...params) }),
      run: () => prepared.run(...params),
    };
    return statement;
  }
}

async function pauseBundle() {
  const item: ExternalIntelligenceItem = {
    itemId: "kraken-incident-1",
    sourceId: "kraken-status",
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: "kraken",
    sourceRef: "https://status.kraken.com/api/v2/incidents.json",
    externalId: "incident-1",
    acquisitionMode: "minute-poll",
    topicKey: "KRAKEN.VENUE",
    assetSymbols: ["KRAKEN.VENUE"],
    eventType: "security-incident",
    stance: "negative",
    publishedAtMs: LINKED_AT_MS - 60_000,
    receivedAtMs: LINKED_AT_MS - 50_000,
    availableAtMs: LINKED_AT_MS - 40_000,
    payloadSha256: "a".repeat(64),
    contentSha256: "b".repeat(64),
    credibilityBps: 10_000,
    confidenceBps: 10_000,
    contentPolicy: "digest-only",
    modelTrainingAllowed: false,
  };
  const linkage = await prepareExternalIntelligenceLinkage({
    linkedAtMs: LINKED_AT_MS,
    topicRules: [
      {
        topicKey: "KRAKEN.VENUE",
        entityKeys: ["KRAKEN.VENUE"],
        tradable: false,
        allowedEventTypes: ["security-incident"],
      },
    ],
    items: [item],
    corrections: [],
  });
  const manipulationEvidence =
    await prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs: LINKED_AT_MS + 1_000,
      linkage,
      policy: {
        minimumNearDuplicateSimilarityBps: 7_500,
        maximumNearDuplicatePublicationSkewMs: 3_600_000,
        rapidRepostWindowMs: 300_000,
        minimumRapidRepostPublishers: 2,
      },
      fingerprints: [],
    });
  const integrations = await prepareIntegratedExternalIntelligenceAssessments({
    assessedAtMs: ASSESSED_AT_MS,
    linkage,
    manipulationEvidence,
    policy: POLICY,
  });
  return { linkage, manipulationEvidence, integrations };
}

async function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    `CREATE TABLE risk_events (
       event_id TEXT PRIMARY KEY,
       cycle_id TEXT NOT NULL,
       severity TEXT NOT NULL,
       code TEXT NOT NULL,
       detail_json TEXT NOT NULL,
       created_at TEXT NOT NULL
     );`,
  );
  for (const name of [
    "0013_external_intelligence_assessment_integration.sql",
    "0014_external_intelligence_paper_risk.sql",
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    );
  }
  const bundle = await pauseBundle();
  const statements =
    await prepareExternalIntelligenceAssessmentIntegrationPersistence({
      ...bundle,
      assessmentPolicy: POLICY,
    });
  for (const statement of statements) {
    sqlite.prepare(statement.sql).run(...statement.params);
  }
  return { sqlite, repository: new ExternalIntelligencePaperRiskRepository(
    new SQLiteD1(sqlite) as unknown as D1Database,
  ) };
}

test("fresh persisted pause evidence suppresses a paper buy and records risk", async () => {
  const { sqlite, repository } = await database();
  const input = {
    cycleId: "cycle-1",
    mode: "paper" as const,
    decision: BUY,
    evaluatedAtMs: ASSESSED_AT_MS + 1_000,
    maximumAssessmentAgeMs: 60_000,
  };
  const result = await repository.apply(input);
  assert.equal(result.evaluated, true);
  assert.equal(result.pausedNewRisk, true);
  assert.equal(result.decision.action, "hold");
  assert.equal(result.decision.targetExposurePct, 0);
  assert.equal(result.assessmentSha256s.length, 1);
  assert.equal(result.integrationSha256s.length, 1);
  await repository.apply(input);
  const row = sqlite
    .prepare(
      "SELECT severity, code, detail_json FROM risk_events",
    )
    .get();
  assert.equal(row?.severity, "pause");
  assert.equal(row?.code, "external-intelligence.pause-new-risk");
  const detail = JSON.parse(String(row?.detail_json));
  assert.equal(detail.resultingAction, "hold");
  assert.match(detail.proposedDecisionSha256, /^[0-9a-f]{64}$/u);
  assert.match(detail.resultingDecisionSha256, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    detail.proposedDecisionSha256,
    detail.resultingDecisionSha256,
  );
  assert.equal(detail.proposedTargetExposurePct, 90);
  assert.equal(detail.resultingTargetExposurePct, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM risk_events").get()?.count,
    1,
  );
  sqlite.close();
});

test("pause-new-risk never blocks a paper exit", async () => {
  const { sqlite, repository } = await database();
  const result = await repository.apply({
    cycleId: "cycle-2",
    mode: "paper",
    decision: { ...BUY, action: "sell" },
    evaluatedAtMs: ASSESSED_AT_MS + 1_000,
    maximumAssessmentAgeMs: 60_000,
  });
  assert.equal(result.pausedNewRisk, false);
  assert.equal(result.decision.action, "sell");
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM risk_events").get()?.count,
    1,
  );
  assert.equal(
    JSON.parse(
      String(
        sqlite.prepare("SELECT detail_json FROM risk_events").get()?.detail_json,
      ),
    ).appliedToProposedBuy,
    false,
  );
  sqlite.close();
});

test("stale assessments cannot pause new paper risk", async () => {
  const { sqlite, repository } = await database();
  const result = await repository.apply({
    cycleId: "cycle-3",
    mode: "paper",
    decision: BUY,
    evaluatedAtMs: ASSESSED_AT_MS + 120_000,
    maximumAssessmentAgeMs: 60_000,
  });
  assert.equal(result.pausedNewRisk, false);
  assert.equal(result.decision.action, "buy");
  sqlite.close();
});

test("non-paper modes remain disconnected and perform no database access", async () => {
  const inaccessible = {
    prepare: () => {
      throw new Error("database should not be used");
    },
  };
  const repository = new ExternalIntelligencePaperRiskRepository(
    inaccessible as unknown as D1Database,
  );
  const result = await repository.apply({
    cycleId: "cycle-4",
    mode: "live",
    decision: BUY,
    evaluatedAtMs: ASSESSED_AT_MS,
    maximumAssessmentAgeMs: 60_000,
  });
  assert.equal(result.evaluated, false);
  assert.equal(result.decision, BUY);
});

test("risk events are immutable and changed exact retries fail closed", async () => {
  const { sqlite, repository } = await database();
  await repository.apply({
    cycleId: "cycle-5",
    mode: "paper",
    decision: BUY,
    evaluatedAtMs: ASSESSED_AT_MS + 1_000,
    maximumAssessmentAgeMs: 60_000,
  });
  assert.throws(
    () => sqlite.prepare("UPDATE risk_events SET severity = 'info'").run(),
    /immutable/u,
  );
  assert.throws(
    () =>
      sqlite
        .prepare(
          `INSERT INTO risk_events
           SELECT event_id, cycle_id, 'kill', code, detail_json, created_at
           FROM risk_events`,
        )
        .run(),
    /identity conflict/u,
  );
  sqlite.close();
});


test("paper risk re-verifies joined linkage and manipulation artifacts", async () => {
  const { sqlite, repository } = await database();
  sqlite.exec("DROP TRIGGER prevent_external_intelligence_linkage_update");
  sqlite
    .prepare(
      "UPDATE external_intelligence_linkages SET linkage_json = '{}' ",
    )
    .run();
  await assert.rejects(
    repository.apply({
      cycleId: "cycle-6",
      mode: "paper",
      decision: BUY,
      evaluatedAtMs: ASSESSED_AT_MS + 1_000,
      maximumAssessmentAgeMs: 60_000,
    }),
    /schema|malformed|unsupported/u,
  );
  sqlite.close();
});

test("risk-event identity changes when the proposed decision changes", async () => {
  const { sqlite, repository } = await database();
  const base = {
    cycleId: "cycle-7",
    mode: "paper" as const,
    evaluatedAtMs: ASSESSED_AT_MS + 1_000,
    maximumAssessmentAgeMs: 60_000,
  };
  await repository.apply({ ...base, decision: BUY });
  await repository.apply({
    ...base,
    decision: { ...BUY, targetExposurePct: 80, reason: "reduced breakout" },
  });
  const rows = sqlite
    .prepare("SELECT event_id, detail_json FROM risk_events ORDER BY event_id")
    .all();
  assert.equal(rows.length, 2);
  const details = rows.map((row) => JSON.parse(String(row.detail_json)));
  assert.notEqual(
    details[0]?.proposedDecisionSha256,
    details[1]?.proposedDecisionSha256,
  );
  sqlite.close();
});
