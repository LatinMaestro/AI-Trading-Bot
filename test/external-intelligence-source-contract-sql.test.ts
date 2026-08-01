import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { ExternalIntelligenceItem } from "../src/intelligence/externalIntelligence.ts";
import {
  createExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "../src/intelligence/sourceRegistry.ts";
import {
  prepareExternalIntelligencePersistence,
  type ExternalIntelligencePersistenceStatement,
} from "../src/storage/externalIntelligence.ts";

const BASE_TIME = Date.UTC(2026, 6, 27, 3);
const digest = (value: string) =>
  (value.charCodeAt(0) % 16).toString(16).repeat(64);

async function sourceContract(
  contractVersion: number,
  effectiveFromMs: number,
  enabled: boolean,
): Promise<ExternalIntelligenceSourceContract> {
  return createExternalIntelligenceSourceContract({
    sourceId: "kraken-official",
    contractVersion,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: "kraken.com",
    providerId: "direct",
    sourceOrigin: "https://kraken.com/",
    allowedAcquisitionModes: ["minute-poll"],
    contentPolicy: "metadata-only",
    licenceRef: "https://kraken.com/terms/",
    licenceSha256: digest(String(contractVersion)),
    attributionRequired: false,
    maximumRetentionMs: null,
    deletionHandling: "required",
    modelTrainingAllowed: false,
    approvedAtMs: effectiveFromMs - 1,
    effectiveFromMs,
    expiresAtMs: null,
    enabled,
  });
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

test("a newer effective disabled source contract revokes the older contract", async () => {
  const db = database();
  const original = await sourceContract(1, BASE_TIME, true);
  const revoked = await sourceContract(2, BASE_TIME + 1_000, false);

  executeAtomically(
    db,
    (
      await prepareExternalIntelligencePersistence({
        recordedAtMs: BASE_TIME + 1,
        sourceContracts: [original],
        itemRecords: [],
        corrections: [],
        assessmentRecords: [],
      })
    ).statements,
  );
  executeAtomically(
    db,
    (
      await prepareExternalIntelligencePersistence({
        recordedAtMs: BASE_TIME + 1_001,
        sourceContracts: [revoked],
        itemRecords: [],
        corrections: [],
        assessmentRecords: [],
      })
    ).statements,
  );

  const item: ExternalIntelligenceItem = {
    itemId: "revoked-contract-item",
    sourceId: original.sourceId,
    sourceKind: original.sourceKind,
    authority: original.authority,
    publisherId: original.publisherId,
    sourceRef: "https://kraken.com/items/revoked-contract-item",
    externalId: "revoked-contract-item",
    acquisitionMode: "minute-poll",
    topicKey: "BTC:listing:20260727",
    assetSymbols: ["BTC"],
    eventType: "listing",
    stance: "positive",
    publishedAtMs: BASE_TIME + 1_100,
    receivedAtMs: BASE_TIME + 1_200,
    availableAtMs: BASE_TIME + 1_300,
    payloadSha256: digest("p"),
    contentSha256: digest("c"),
    credibilityBps: 9_000,
    confidenceBps: 9_000,
    contentPolicy: "metadata-only",
    modelTrainingAllowed: false,
  };
  const prepared = await prepareExternalIntelligencePersistence({
    recordedAtMs: BASE_TIME + 1_400,
    sourceContracts: [original],
    itemRecords: [
      { item, sourceContractSha256: original.sourceContractSha256 },
    ],
    corrections: [],
    assessmentRecords: [],
  });

  assert.throws(
    () => executeAtomically(db, prepared.statements),
    /source contract mismatch/,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM external_intelligence_items",
        )
        .get() as { count: number }
    ).count,
    0,
  );
});
