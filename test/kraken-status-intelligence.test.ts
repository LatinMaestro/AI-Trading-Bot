import assert from "node:assert/strict";
import test from "node:test";
import {
  createKrakenStatusIncidentMinuteSource,
  KRAKEN_STATUS_INCIDENTS_SOURCE_ID,
  KRAKEN_STATUS_INCIDENTS_SOURCE_REF,
  normaliseKrakenStatusIncidentCapture,
} from "../src/intelligence/krakenStatusIntelligence.ts";
import { createExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import type { ExternalIntelligencePayloadCapture } from "../src/intelligence/sourceAdapters.ts";

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

async function contract() {
  return createExternalIntelligenceSourceContract({
    sourceId: KRAKEN_STATUS_INCIDENTS_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: "kraken-status",
    providerId: "kraken-statuspage",
    sourceOrigin: "https://status.kraken.com/",
    allowedAcquisitionModes: ["minute-poll"],
    contentPolicy: "digest-only",
    licenceRef: "https://status.kraken.com/",
    licenceSha256: "a".repeat(64),
    attributionRequired: false,
    maximumRetentionMs: null,
    deletionHandling: "not-applicable",
    modelTrainingAllowed: false,
    approvedAtMs: 1_000,
    effectiveFromMs: 1_000,
    expiresAtMs: null,
    enabled: true,
  });
}

function payload(impact = "critical", status = "investigating") {
  return JSON.stringify({
    page: { id: "page1", name: "Kraken", url: "https://status.kraken.com" },
    incidents: [
      {
        id: "incident1",
        name: "API connectivity degraded",
        status,
        impact,
        created_at: "2026-07-27T03:00:00.000Z",
        updated_at: "2026-07-27T03:02:00.000Z",
        incident_updates: [
          {
            id: "update1",
            incident_id: "incident1",
            status,
            created_at: "2026-07-27T03:00:00.000Z",
            updated_at: "2026-07-27T03:02:00.000Z",
            display_at: "2026-07-27T03:00:00.000Z",
            body: "We are investigating connectivity.",
          },
        ],
      },
    ],
  });
}

async function capture(
  text = payload(),
): Promise<ExternalIntelligencePayloadCapture> {
  const sourceContract = await contract();
  const bytes = new TextEncoder().encode(text);
  const payloadSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    captureId: "b".repeat(64),
    sourceId: sourceContract.sourceId,
    sourceContractSha256: sourceContract.sourceContractSha256,
    sourceKind: "official-exchange",
    publisherId: sourceContract.publisherId,
    providerId: sourceContract.providerId,
    sourceRef: KRAKEN_STATUS_INCIDENTS_SOURCE_REF,
    acquisitionMode: "minute-poll",
    requestStartedAtMs: Date.parse("2026-07-27T03:03:00.000Z"),
    receivedAtMs: Date.parse("2026-07-27T03:03:01.000Z"),
    availableAtMs: Date.parse("2026-07-27T03:03:02.000Z"),
    responseLatencyMs: 1_000,
    availabilityLatencyMs: 1_000,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    payloadBytes: bytes,
    contentType: "application/json",
    etag: null,
    lastModified: null,
    payloadRetention: "transient-only",
    modelTrainingAllowed: false,
  };
}

test("binds the approved Kraken unresolved-incidents manifest", async () => {
  const source = await createKrakenStatusIncidentMinuteSource(
    await contract(),
    policy,
  );
  assert.deepEqual(source.target, {
    sourceId: KRAKEN_STATUS_INCIDENTS_SOURCE_ID,
    sourceRef: KRAKEN_STATUS_INCIDENTS_SOURCE_REF,
    acquisitionMode: "minute-poll",
    acceptedContentTypes: ["application/json"],
  });
});

test("normalises structured critical incidents without retaining raw body content", async () => {
  const result = await normaliseKrakenStatusIncidentCapture(
    await contract(),
    await capture(),
    policy,
  );
  if (result === null) throw new Error("expected a normalised result");
  assert.equal(result.itemRecords.length, 1);
  const record = result.itemRecords[0];
  if (record === undefined) throw new Error("expected one intelligence item");
  const item = record.item;
  assert.equal(item.eventType, "network-incident");
  assert.equal(item.stance, "negative");
  assert.deepEqual(item.assetSymbols, ["KRAKEN.VENUE"]);
  assert.equal(item.contentPolicy, "digest-only");
  assert.equal(result.assessmentRequests[0]?.stance, "negative");
  assert.match(item.itemId, /^[0-9a-f]{64}$/u);
  assert.match(item.contentSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    JSON.stringify(result).includes("We are investigating connectivity."),
    false,
  );
});

test("keeps minor structured incidents neutral rather than pausing new risk", async () => {
  const result = await normaliseKrakenStatusIncidentCapture(
    await contract(),
    await capture(payload("minor")),
    policy,
  );
  assert.equal(result?.itemRecords[0]?.item.stance, "neutral");
  assert.equal(result?.assessmentRequests[0]?.stance, "neutral");
});

test("returns no queue work when unresolved incidents are empty", async () => {
  const empty = JSON.stringify({
    page: { id: "page1", name: "Kraken" },
    incidents: [],
  });
  assert.equal(
    await normaliseKrakenStatusIncidentCapture(
      await contract(),
      await capture(empty),
      policy,
    ),
    null,
  );
});

test("is deterministic across provider incident ordering", async () => {
  const base = JSON.parse(payload()) as { page: unknown; incidents: unknown[] };
  const second = structuredClone(base.incidents[0]) as Record<string, unknown>;
  second.id = "incident0";
  second.name = "Trading degraded";
  const updates = second.incident_updates as Record<string, unknown>[];
  updates[0] = { ...updates[0], id: "update0", incident_id: "incident0" };
  const left = JSON.stringify({
    page: base.page,
    incidents: [base.incidents[0], second],
  });
  const right = JSON.stringify({
    page: base.page,
    incidents: [second, base.incidents[0]],
  });
  const first = await normaliseKrakenStatusIncidentCapture(
    await contract(),
    await capture(left),
    policy,
  );
  const next = await normaliseKrakenStatusIncidentCapture(
    await contract(),
    await capture(right),
    policy,
  );
  assert.deepEqual(
    first?.itemRecords.map((record) => record.item.itemId),
    next?.itemRecords.map((record) => record.item.itemId),
  );
});

test("fails closed on provider, state, manifest and digest conflicts", async () => {
  await assert.rejects(
    normaliseKrakenStatusIncidentCapture(
      await contract(),
      await capture(payload("catastrophic")),
      policy,
    ),
    /impact is unsupported/,
  );
  await assert.rejects(
    normaliseKrakenStatusIncidentCapture(
      await contract(),
      await capture(payload("major", "resolved")),
      policy,
    ),
    /not an unresolved Kraken incident status/,
  );
  const badCapture = {
    ...(await capture()),
    sourceRef: "https://status.kraken.com/api/v2/incidents.json",
  };
  await assert.rejects(
    normaliseKrakenStatusIncidentCapture(await contract(), badCapture, policy),
    /does not match the approved manifest/,
  );
  const tamperedCapture = {
    ...(await capture()),
    payloadSha256: "d".repeat(64),
  };
  await assert.rejects(
    normaliseKrakenStatusIncidentCapture(
      await contract(),
      tamperedCapture,
      policy,
    ),
    /payload digest does not match/,
  );
});
