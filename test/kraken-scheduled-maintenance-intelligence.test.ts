import assert from "node:assert/strict";
import test from "node:test";
import {
  createKrakenActiveMaintenanceMinuteSource,
  KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
  KRAKEN_ACTIVE_MAINTENANCE_SOURCE_REF,
  KRAKEN_STATUS_API_REF,
  KRAKEN_STATUS_PAGE_ID,
  KRAKEN_STATUS_VENUE_SCOPE,
  normaliseKrakenActiveMaintenanceCapture,
} from "../src/intelligence/krakenScheduledMaintenanceIntelligence.ts";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import type { ExternalIntelligencePayloadCapture } from "../src/intelligence/sourceAdapters.ts";
import type { ExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";

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

function contract(): ExternalIntelligenceSourceContract {
  return {
    sourceId: KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: "kraken-status",
    providerId: "kraken-statuspage",
    sourceOrigin: "https://status.kraken.com/",
    allowedAcquisitionModes: ["minute-poll"],
    contentPolicy: "digest-only",
    licenceRef: KRAKEN_STATUS_API_REF,
    licenceSha256: "a".repeat(64),
    attributionRequired: false,
    maximumRetentionMs: null,
    deletionHandling: "not-applicable",
    modelTrainingAllowed: false,
    approvedAtMs: 1_000,
    effectiveFromMs: 1_000,
    expiresAtMs: null,
    enabled: true,
    sourceContractSha256: "b".repeat(64),
  };
}

function payload(
  impact = "maintenance",
  status = "in_progress",
  body = "Scheduled maintenance is currently in progress.",
) {
  return JSON.stringify({
    page: {
      id: KRAKEN_STATUS_PAGE_ID,
      name: "Kraken",
      url: "https://status.kraken.com",
    },
    scheduled_maintenances: [
      {
        id: "maintenance1",
        name: "Spot API maintenance",
        status,
        impact,
        created_at: "2026-07-28T08:00:00.000Z",
        updated_at: "2026-07-28T09:02:00.000Z",
        page_id: KRAKEN_STATUS_PAGE_ID,
        scheduled_for: "2026-07-28T09:00:00.000Z",
        scheduled_until: "2026-07-28T09:30:00.000Z",
        incident_updates: [
          {
            id: "update1",
            incident_id: "maintenance1",
            status,
            created_at: "2026-07-28T09:00:00.000Z",
            updated_at: "2026-07-28T09:02:00.000Z",
            display_at: "2026-07-28T09:00:00.000Z",
            body,
          },
        ],
      },
    ],
  });
}

async function capture(
  text = payload(),
): Promise<ExternalIntelligencePayloadCapture> {
  const sourceContract = contract();
  const bytes = new TextEncoder().encode(text);
  return {
    captureId: "b".repeat(64),
    sourceId: sourceContract.sourceId,
    sourceContractSha256: sourceContract.sourceContractSha256,
    sourceKind: "official-exchange",
    publisherId: sourceContract.publisherId,
    providerId: sourceContract.providerId,
    sourceRef: KRAKEN_ACTIVE_MAINTENANCE_SOURCE_REF,
    acquisitionMode: "minute-poll",
    requestStartedAtMs: Date.parse("2026-07-28T09:03:00.000Z"),
    receivedAtMs: Date.parse("2026-07-28T09:03:01.000Z"),
    availableAtMs: Date.parse("2026-07-28T09:03:02.000Z"),
    responseLatencyMs: 1_000,
    availabilityLatencyMs: 1_000,
    payloadSha256: Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join(""),
    payloadByteLength: bytes.byteLength,
    payloadBytes: bytes,
    contentType: "application/json",
    etag: null,
    lastModified: null,
    payloadRetention: "transient-only",
    modelTrainingAllowed: false,
  };
}

test("binds the official active-maintenance programmatic endpoint", async () => {
  const source = await createKrakenActiveMaintenanceMinuteSource(
    contract(),
    policy,
  );
  assert.deepEqual(source.target, {
    sourceId: KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
    sourceRef: KRAKEN_ACTIVE_MAINTENANCE_SOURCE_REF,
    acquisitionMode: "minute-poll",
    acceptedContentTypes: ["application/json"],
  });
});

test("normalises provider maintenance into venue-wide neutral evidence without provider text", async () => {
  const body = "Do not retain this maintenance update.";
  const result = await normaliseKrakenActiveMaintenanceCapture(
    contract(),
    await capture(payload("maintenance", "in_progress", body)),
    policy,
  );
  if (result === null) throw new Error("expected a normalised result");
  assert.equal(result.itemRecords.length, 1);
  const item = result.itemRecords[0]?.item;
  if (item === undefined) throw new Error("expected an intelligence item");
  assert.equal(item.eventType, "market-structure");
  assert.equal(item.stance, "neutral");
  assert.deepEqual(item.assetSymbols, [KRAKEN_STATUS_VENUE_SCOPE]);
  assert.equal(result.assessmentRequests[0]?.stance, "neutral");
  assert.equal(JSON.stringify(result).includes(body), false);
  assert.equal(JSON.stringify(result).includes("Spot API maintenance"), false);
});

test("keeps minor active maintenance neutral", async () => {
  const result = await normaliseKrakenActiveMaintenanceCapture(
    contract(),
    await capture(payload("minor")),
    policy,
  );
  assert.equal(result?.itemRecords[0]?.item.stance, "neutral");
  assert.equal(result?.assessmentRequests[0]?.stance, "neutral");
});

test("allows only structured major or critical impact to request a pause candidate", async () => {
  const result = await normaliseKrakenActiveMaintenanceCapture(
    contract(),
    await capture(payload("critical")),
    policy,
  );
  assert.equal(result?.itemRecords[0]?.item.stance, "negative");
  assert.equal(result?.assessmentRequests[0]?.stance, "negative");
});

test("returns no queue work for an empty active-maintenance set", async () => {
  const empty = JSON.stringify({
    page: {
      id: KRAKEN_STATUS_PAGE_ID,
      name: "Kraken",
      url: "https://status.kraken.com",
    },
    scheduled_maintenances: [],
  });
  assert.equal(
    await normaliseKrakenActiveMaintenanceCapture(
      contract(),
      await capture(empty),
      policy,
    ),
    null,
  );
});

test("is deterministic across maintenance ordering", async () => {
  const base = JSON.parse(payload()) as {
    page: unknown;
    scheduled_maintenances: Record<string, unknown>[];
  };
  const second = structuredClone(base.scheduled_maintenances[0]);
  if (second === undefined) throw new Error("expected fixture maintenance");
  second.id = "maintenance0";
  second.name = "Trading maintenance";
  const updates = second.incident_updates as Record<string, unknown>[];
  updates[0] = {
    ...updates[0],
    id: "update0",
    incident_id: "maintenance0",
  };
  const left = JSON.stringify({
    page: base.page,
    scheduled_maintenances: [base.scheduled_maintenances[0], second],
  });
  const right = JSON.stringify({
    page: base.page,
    scheduled_maintenances: [second, base.scheduled_maintenances[0]],
  });
  const first = await normaliseKrakenActiveMaintenanceCapture(
    contract(),
    await capture(left),
    policy,
  );
  const next = await normaliseKrakenActiveMaintenanceCapture(
    contract(),
    await capture(right),
    policy,
  );
  assert.deepEqual(
    first?.itemRecords.map((record) => record.item.itemId),
    next?.itemRecords.map((record) => record.item.itemId),
  );
});

test("fails closed on unsupported severity, inactive state, page and digest conflicts", async () => {
  await assert.rejects(
    normaliseKrakenActiveMaintenanceCapture(
      contract(),
      await capture(payload("catastrophic")),
      policy,
    ),
    /impact is unsupported/,
  );
  await assert.rejects(
    normaliseKrakenActiveMaintenanceCapture(
      contract(),
      await capture(payload("major", "completed")),
      policy,
    ),
    /not active/,
  );
  const wrongPage = JSON.parse(payload()) as {
    page: Record<string, unknown>;
    scheduled_maintenances: unknown[];
  };
  wrongPage.page.id = "otherpage";
  await assert.rejects(
    normaliseKrakenActiveMaintenanceCapture(
      contract(),
      await capture(JSON.stringify(wrongPage)),
      policy,
    ),
    /unapproved status page/,
  );
  await assert.rejects(
    normaliseKrakenActiveMaintenanceCapture(
      contract(),
      { ...(await capture()), payloadSha256: "d".repeat(64) },
      policy,
    ),
    /digest does not match/,
  );
});
