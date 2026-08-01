import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import {
  createRbaMediaReleaseScheduledSource,
  normaliseRbaMediaReleaseCapture,
  RBA_COPYRIGHT_REF,
  RBA_MACRO_SCOPE,
  RBA_MEDIA_RELEASES_SOURCE_ID,
  RBA_MEDIA_RELEASES_SOURCE_REF,
  RBA_PROVIDER_ID,
  RBA_PUBLISHER_ID,
  RBA_RSS_POLICY_REF,
  RBA_SOURCE_ORIGIN,
} from "../src/intelligence/rbaMediaReleaseIntelligence.ts";
import {
  externalIntelligencePayloadCaptureId,
  type ExternalIntelligencePayloadCapture,
} from "../src/intelligence/sourceAdapters.ts";
import {
  createExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContractInput,
} from "../src/intelligence/sourceRegistry.ts";

const RECEIVED_AT_MS = Date.parse("2026-07-28T08:00:00.000Z");
const policy: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": 900_000,
    regulator: 86_400_000,
    issuer: 86_400_000,
    "mainstream-news": 900_000,
    "specialist-news": 900_000,
    reddit: 300_000,
  },
  maximumReceiptDelayMs: 120_000,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 5_000,
  maximumItems: 50,
};

async function contract(
  overrides: Partial<ExternalIntelligenceSourceContractInput> = {},
): Promise<ExternalIntelligenceSourceContract> {
  return createExternalIntelligenceSourceContract({
    sourceId: RBA_MEDIA_RELEASES_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "regulator",
    authority: "authoritative",
    publisherId: RBA_PUBLISHER_ID,
    providerId: RBA_PROVIDER_ID,
    sourceOrigin: RBA_SOURCE_ORIGIN,
    allowedAcquisitionModes: ["scheduled-poll"],
    contentPolicy: "digest-only",
    licenceRef: RBA_COPYRIGHT_REF,
    licenceSha256: "a".repeat(64),
    attributionRequired: true,
    maximumRetentionMs: null,
    deletionHandling: "not-applicable",
    modelTrainingAllowed: false,
    approvedAtMs: 1_000,
    effectiveFromMs: 1_000,
    expiresAtMs: null,
    enabled: true,
    ...overrides,
  });
}

function rss(items: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>RBA Media Releases</title>
${items.join("\n")}
</channel></rss>`;
}

function item(
  id: string,
  title = "Statement by the Monetary Policy Board",
  guid?: string,
): string {
  const [year, number] = id.split("-");
  const link = `https://www.rba.gov.au/media-releases/${year}/mr-${year?.slice(2)}-${number}.html`;
  return `<item>
<title>${title}</title>
<link>${link}</link>
<guid isPermaLink="true">${guid ?? link}</guid>
<pubDate>Wed, 08 Jul 2026 09:30:00 +1000</pubDate>
</item>`;
}

async function capture(
  xml = rss([item("2026-18")]),
  overrides: Partial<ExternalIntelligencePayloadCapture> = {},
): Promise<ExternalIntelligencePayloadCapture> {
  const { captureId: captureIdOverride, ...captureOverrides } = overrides;
  const bytes = new TextEncoder().encode(xml);
  const payloadSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const values: Omit<ExternalIntelligencePayloadCapture, "captureId"> = {
    sourceId: RBA_MEDIA_RELEASES_SOURCE_ID,
    sourceContractSha256: (await contract()).sourceContractSha256,
    sourceKind: "regulator",
    publisherId: RBA_PUBLISHER_ID,
    providerId: RBA_PROVIDER_ID,
    sourceRef: RBA_MEDIA_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    requestStartedAtMs: RECEIVED_AT_MS - 2_000,
    receivedAtMs: RECEIVED_AT_MS,
    availableAtMs: RECEIVED_AT_MS + 1_000,
    responseLatencyMs: 2_000,
    availabilityLatencyMs: 1_000,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    payloadBytes: bytes,
    contentType: "text/xml",
    etag: null,
    lastModified: null,
    payloadRetention: "transient-only",
    modelTrainingAllowed: false,
    ...captureOverrides,
  };
  const captureId =
    captureIdOverride ??
    (await externalIntelligencePayloadCaptureId({
      sourceId: values.sourceId,
      sourceContractSha256: values.sourceContractSha256,
      sourceKind: values.sourceKind,
      sourceRef: values.sourceRef,
      acquisitionMode: values.acquisitionMode,
      requestStartedAtMs: values.requestStartedAtMs,
      receivedAtMs: values.receivedAtMs,
      availableAtMs: values.availableAtMs,
      payloadSha256: values.payloadSha256,
      payloadByteLength: values.payloadByteLength,
      contentType: values.contentType,
      etag: values.etag,
      lastModified: values.lastModified,
    }));
  return { captureId, ...values };
}

test("binds the official scheduled RBA media-release manifest", async () => {
  const source = await createRbaMediaReleaseScheduledSource(await contract(), policy);
  assert.deepEqual(source.target, {
    sourceId: RBA_MEDIA_RELEASES_SOURCE_ID,
    sourceRef: RBA_MEDIA_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    acceptedContentTypes: [
      "text/xml",
      "application/rss+xml",
      "application/xml",
    ],
  });
});

test("normalises neutral AUD macro evidence without retaining titles or XML", async () => {
  const result = await normaliseRbaMediaReleaseCapture(
    await contract(),
    await capture(
      rss([
        item("2026-18", "macro"),
        item("2026-17", "<![CDATA[Review of Payments System Regulation]]>"),
      ]),
    ),
    policy,
  );
  assert.equal(result?.itemRecords.length, 2);
  const first = result?.itemRecords[0];
  if (first === undefined) throw new Error("expected RBA item");
  assert.equal(first.item.externalId, "2026-17");
  assert.equal(first.item.sourceKind, "regulator");
  assert.equal(first.item.authority, "authoritative");
  assert.equal(first.item.eventType, "macro");
  assert.equal(first.item.stance, "neutral");
  assert.deepEqual(first.item.assetSymbols, [RBA_MACRO_SCOPE]);
  assert.equal(result?.assessmentRequests[0]?.eventType, "macro");
  assert.equal(result?.assessmentRequests[0]?.stance, "neutral");
  assert.match(first.item.itemId, /^[0-9a-f]{64}$/u);
  assert.match(first.item.contentSha256, /^[0-9a-f]{64}$/u);
  const persisted = JSON.stringify(result);
  assert.equal(persisted.includes("Review of Payments System Regulation"), false);
  assert.equal(persisted.includes("<rss"), false);
});

test("is deterministic across feed ordering and returns no empty work", async () => {
  const left = await normaliseRbaMediaReleaseCapture(
    await contract(),
    await capture(rss([item("2026-18"), item("2026-17")])),
    policy,
  );
  const right = await normaliseRbaMediaReleaseCapture(
    await contract(),
    await capture(rss([item("2026-17"), item("2026-18")])),
    policy,
  );
  assert.deepEqual(
    left?.itemRecords.map((record) => record.item.itemId),
    right?.itemRecords.map((record) => record.item.itemId),
  );
  assert.equal(
    await normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([])),
      policy,
    ),
    null,
  );
});

test("fails closed on unsafe XML, duplicates and malformed structure", async () => {
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${rss([])}`),
      policy,
    ),
    /forbidden/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([item("2026-18"), item("2026-18")])),
      policy,
    ),
    /duplicate/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([item("2026-18").replace("</item>", "")])),
      policy,
    ),
    /malformed item markup/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(
        `${rss([item("2026-18")])}<rss version="2.0"></rss>`,
      ),
      policy,
    ),
    /canonical RSS root/u,
  );
});

test("fails closed on unapproved links, GUIDs and future publication", async () => {
  const badHost = item("2026-18").replace(
    /https:\/\/www\.rba\.gov\.au/gu,
    "https://example.com",
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([badHost])),
      policy,
    ),
    /outside the approved origin/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([item("2026-18", "Title", "wrong-guid")])),
      policy,
    ),
    /guid does not match/u,
  );
  const nonRssDate = item("2026-18").replace(
    "Wed, 08 Jul 2026 09:30:00 +1000",
    "2026-07-08T09:30:00+10:00",
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([nonRssDate])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const impossibleDate = item("2026-18").replace(
    "Wed, 08 Jul 2026 09:30:00 +1000",
    "Tue, 31 Feb 2026 09:30:00 +1000",
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([impossibleDate])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const wrongWeekday = item("2026-18").replace(
    "Wed, 08 Jul 2026 09:30:00 +1000",
    "Tue, 08 Jul 2026 09:30:00 +1000",
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([wrongWeekday])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const future = item("2026-18").replace(
    "Wed, 08 Jul 2026 09:30:00 +1000",
    "Wed, 29 Jul 2026 09:30:00 +1000",
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(rss([future])),
      policy,
    ),
    /publication time is invalid/u,
  );
});

test("fails closed on manifest, capture and payload identity mismatch", async () => {
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract({ allowedAcquisitionModes: ["scheduled-poll", "webhook"] }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(undefined, { requestStartedAtMs: 0 }),
      policy,
    ),
    /not active/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(undefined, { captureId: "d".repeat(64) }),
      policy,
    ),
    /identity does not reproduce/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract({ licenceRef: RBA_RSS_POLICY_REF }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(undefined, { contentType: "text/html" }),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseRbaMediaReleaseCapture(
      await contract(),
      await capture(undefined, { payloadSha256: "d".repeat(64) }),
      policy,
    ),
    /digest does not match/u,
  );
});
