import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  assessExternalIntelligence,
  type ExternalIntelligenceItem,
  type ExternalIntelligencePolicy,
} from "../src/intelligence/externalIntelligence.ts";
import {
  createExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "../src/intelligence/sourceRegistry.ts";
import { createExternalIntelligenceCorrection } from "../src/intelligence/externalIntelligenceRecords.ts";
import {
  INSERT_EXTERNAL_INTELLIGENCE_BATCH_COMMIT_SQL,
  prepareExternalIntelligencePersistence,
  type ExternalIntelligencePersistenceInput,
  type ExternalIntelligencePersistenceStatement,
} from "../src/storage/externalIntelligence.ts";

const NOW = Date.UTC(2026, 6, 27, 2);
const digest = (value: string) =>
  (value.charCodeAt(0) % 16).toString(16).repeat(64);

const policy: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": 3_600_000,
    regulator: 3_600_000,
    issuer: 3_600_000,
    "mainstream-news": 1_800_000,
    "specialist-news": 900_000,
    reddit: 300_000,
  },
  maximumReceiptDelayMs: 120_000,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 5_000,
  maximumItems: 50,
};

async function sourceContract(
  sourceId = "kraken-official",
  publisherId = "kraken.com",
): Promise<ExternalIntelligenceSourceContract> {
  return createExternalIntelligenceSourceContract({
    sourceId,
    contractVersion: 1,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId,
    providerId: "direct",
    sourceOrigin: `https://${publisherId}/`,
    allowedAcquisitionModes: ["minute-poll", "webhook"],
    contentPolicy: "permitted-excerpt",
    licenceRef: `https://${publisherId}/terms/`,
    licenceSha256: digest("l"),
    attributionRequired: false,
    maximumRetentionMs: 86_400_000,
    deletionHandling: "required",
    modelTrainingAllowed: false,
    approvedAtMs: NOW - 600_000,
    effectiveFromMs: NOW - 300_000,
    expiresAtMs: null,
    enabled: true,
  });
}

function intelligenceItem(
  overrides: Partial<ExternalIntelligenceItem> = {},
): ExternalIntelligenceItem {
  return {
    itemId: "official-item-1",
    sourceId: "kraken-official",
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: "kraken.com",
    sourceRef: "https://kraken.com/items/official-item-1",
    externalId: "official-item-1",
    acquisitionMode: "minute-poll",
    topicKey: "BTC:security-event:20260727",
    assetSymbols: ["BTC"],
    eventType: "security-incident",
    stance: "negative",
    publishedAtMs: NOW - 60_000,
    receivedAtMs: NOW - 30_000,
    availableAtMs: NOW - 20_000,
    payloadSha256: digest("p"),
    contentSha256: digest("c"),
    credibilityBps: 9_000,
    confidenceBps: 8_500,
    contentPolicy: "permitted-excerpt",
    modelTrainingAllowed: false,
    ...overrides,
  };
}

async function completeInput(): Promise<ExternalIntelligencePersistenceInput> {
  const contract = await sourceContract();
  const item = intelligenceItem();
  const assessment = await assessExternalIntelligence(
    item.topicKey,
    item.eventType,
    item.stance,
    [item],
    NOW,
    policy,
  );
  const correction = await createExternalIntelligenceCorrection({
    itemId: item.itemId,
    sourceId: item.sourceId,
    externalId: item.externalId,
    providerEventId: "correction-1",
    correctionKind: "content-update",
    observedAtMs: NOW + 1,
    reasonCode: "publisher-update",
    replacementPayloadSha256: digest("q"),
    replacementContentSha256: digest("d"),
  });
  return {
    recordedAtMs: NOW + 2,
    sourceContracts: [contract],
    itemRecords: [{ item, sourceContractSha256: contract.sourceContractSha256 }],
    corrections: [correction],
    assessmentRecords: [{ assessment, assessedAtMs: NOW, policy }],
  };
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync("migrations/0008_external_intelligence.sql", "utf8"));
  db.exec(
    readFileSync(
      "migrations/0009_external_intelligence_hardening.sql",
      "utf8",
    ),
  );
  return db;
}

function executeAtomically(
  db: DatabaseSync,
  statements: readonly ExternalIntelligencePersistenceStatement[],
): void {
  db.exec("BEGIN");
  try {
    for (const statement of statements) {
      db.prepare(statement.sql).run(...statement.params);
    }
    db.exec("COMMIT");
  } catch (error: unknown) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function count(db: DatabaseSync, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

test("source contracts are deterministic and enforce Reddit rights boundaries", async () => {
  const contract = await sourceContract();
  const { sourceContractSha256: _ignored, ...contractInput } = contract;
  const reordered = await createExternalIntelligenceSourceContract({
    ...contractInput,
    allowedAcquisitionModes: ["webhook", "minute-poll"],
  });
  assert.equal(contract.sourceContractSha256, reordered.sourceContractSha256);
  assert.deepEqual(contract.allowedAcquisitionModes, ["minute-poll", "webhook"]);

  await assert.rejects(
    createExternalIntelligenceSourceContract({
      sourceId: "reddit-watch",
      contractVersion: 1,
      sourceKind: "reddit",
      authority: "social",
      publisherId: "reddit.com",
      providerId: "reddit-api",
      sourceOrigin: "https://reddit.com/",
      allowedAcquisitionModes: ["minute-poll"],
      contentPolicy: "permitted-full",
      licenceRef: "https://redditinc.com/policies/data-api-terms",
      licenceSha256: digest("r"),
      attributionRequired: true,
      maximumRetentionMs: 86_400_000,
      deletionHandling: "required",
      modelTrainingAllowed: false,
      approvedAtMs: NOW,
      effectiveFromMs: NOW,
      expiresAtMs: null,
      enabled: true,
    }),
    /full-content storage is prohibited/,
  );
});

test("prepares a deterministic fixed-statement immutable batch", async () => {
  const input = await completeInput();
  const first = await prepareExternalIntelligencePersistence(input);
  const second = await prepareExternalIntelligencePersistence(input);
  assert.equal(first.batch.batchSha256, second.batch.batchSha256);
  assert.equal(first.statements.length, 10);
  assert.equal(first.batch.assessmentRecords.length, 1);
  assert.match(
    first.batch.assessmentRecords[0]?.policySha256 ?? "",
    /^[0-9a-f]{64}$/,
  );

  const assessmentRecord = input.assessmentRecords[0];
  assert.notEqual(assessmentRecord, undefined);
  const reorderedPolicy: ExternalIntelligencePolicy = {
    maximumItems: policy.maximumItems,
    minimumCredibilityBps: policy.minimumCredibilityBps,
    minimumRiskOnPublishers: policy.minimumRiskOnPublishers,
    maximumReceiptDelayMs: policy.maximumReceiptDelayMs,
    maximumItemAgeMs: {
      reddit: policy.maximumItemAgeMs.reddit,
      "specialist-news": policy.maximumItemAgeMs["specialist-news"],
      "mainstream-news": policy.maximumItemAgeMs["mainstream-news"],
      issuer: policy.maximumItemAgeMs.issuer,
      regulator: policy.maximumItemAgeMs.regulator,
      "official-exchange": policy.maximumItemAgeMs["official-exchange"],
    },
  };
  const reordered = await prepareExternalIntelligencePersistence({
    ...input,
    assessmentRecords: [{ ...assessmentRecord, policy: reorderedPolicy }],
  });
  assert.equal(first.batch.batchSha256, reordered.batch.batchSha256);
  assert.deepEqual(first.statements[7]?.params, reordered.statements[7]?.params);
});

test("persists exact retries atomically with commit membership evidence", async () => {
  const db = database();
  const prepared = await prepareExternalIntelligencePersistence(
    await completeInput(),
  );
  executeAtomically(db, prepared.statements);
  executeAtomically(db, prepared.statements);

  assert.equal(count(db, "external_intelligence_source_contracts"), 1);
  assert.equal(count(db, "external_intelligence_items"), 1);
  assert.equal(count(db, "external_intelligence_corrections"), 1);
  assert.equal(count(db, "external_intelligence_assessments"), 1);
  const assessment = prepared.batch.assessmentRecords[0]?.assessment;
  assert.notEqual(assessment, undefined);
  assert.equal(
    (
      db
        .prepare(
          `SELECT accepted_evidence_sha256_json AS evidence
           FROM external_intelligence_assessments`,
        )
        .get() as { evidence: string }
    ).evidence,
    JSON.stringify(assessment.acceptedEvidenceSha256),
  );
  assert.equal(count(db, "external_intelligence_ingestion_batches"), 1);
  assert.equal(count(db, "external_intelligence_ingestion_batch_commits"), 1);
});

test("changed item identity aborts the complete batch without orphaned provenance", async () => {
  const db = database();
  const original = await completeInput();
  executeAtomically(
    db,
    (await prepareExternalIntelligencePersistence(original)).statements,
  );
  const changedItem = intelligenceItem({ contentSha256: digest("z") });
  const changedAssessment = await assessExternalIntelligence(
    changedItem.topicKey,
    changedItem.eventType,
    changedItem.stance,
    [changedItem],
    NOW,
    policy,
  );
  const changed: ExternalIntelligencePersistenceInput = {
    ...original,
    recordedAtMs: NOW + 3,
    itemRecords: [
      {
        item: changedItem,
        sourceContractSha256:
          original.sourceContracts[0]?.sourceContractSha256 ?? "",
      },
    ],
    corrections: [],
    assessmentRecords: [
      { assessment: changedAssessment, assessedAtMs: NOW, policy },
    ],
  };
  const changedPrepared = await prepareExternalIntelligencePersistence(changed);
  assert.throws(
    () => executeAtomically(db, changedPrepared.statements),
    /item conflict/,
  );
  assert.equal(count(db, "external_intelligence_ingestion_batches"), 1);
});

test("invalid assessments and source-contract mismatches fail before persistence", async () => {
  const input = await completeInput();
  const assessmentRecord = input.assessmentRecords[0];
  assert.notEqual(assessmentRecord, undefined);
  await assert.rejects(
    prepareExternalIntelligencePersistence({
      ...input,
      assessmentRecords: [
        {
          ...assessmentRecord,
          assessment: {
            ...assessmentRecord.assessment,
            reaction: "watch",
          },
        },
      ],
    }),
    /does not reproduce/,
  );
  await assert.rejects(
    prepareExternalIntelligencePersistence({
      ...input,
      itemRecords: [
        {
          ...input.itemRecords[0]!,
          item: intelligenceItem({ acquisitionMode: "stream" }),
        },
      ],
      corrections: [],
      assessmentRecords: [],
    }),
    /unapproved acquisition mode/,
  );
});

test("database blocks incomplete commits and mutation of committed evidence", async () => {
  const db = database();
  const prepared = await prepareExternalIntelligencePersistence(
    await completeInput(),
  );
  executeAtomically(db, prepared.statements);
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE external_intelligence_items SET credibility_bps = 1",
        )
        .run(),
    /items are immutable/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO external_intelligence_batch_items
            (batch_sha256, item_id) VALUES (?, ?)`,
        )
        .run(prepared.batch.batchSha256, "new-item"),
    /Committed external intelligence batch is immutable/,
  );

  const emptyBatch = digest("e");
  db.prepare(
    `INSERT INTO external_intelligence_ingestion_batches
      (batch_sha256, recorded_at_ms, source_contract_count, item_count,
       correction_count, assessment_count)
     VALUES (?, ?, 0, 1, 0, 0)`,
  ).run(emptyBatch, NOW);
  assert.throws(
    () => db.prepare(INSERT_EXTERNAL_INTELLIGENCE_BATCH_COMMIT_SQL).run(emptyBatch),
    /batch is incomplete/,
  );

  const closureBatch = digest("f");
  db.prepare(
    `INSERT INTO external_intelligence_ingestion_batches
      (batch_sha256, recorded_at_ms, source_contract_count, item_count,
       correction_count, assessment_count)
     VALUES (?, ?, 0, 1, 0, 0)`,
  ).run(closureBatch, NOW + 2);
  db.prepare(
    `INSERT INTO external_intelligence_batch_items
      (batch_sha256, item_id) VALUES (?, ?)`,
  ).run(closureBatch, "official-item-1");
  assert.throws(
    () => db.prepare(INSERT_EXTERNAL_INTELLIGENCE_BATCH_COMMIT_SQL).run(closureBatch),
    /batch is incomplete/,
  );
});
