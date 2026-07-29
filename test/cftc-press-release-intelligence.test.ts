import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import {
  CFTC_PRESS_RELEASES_SOURCE_ID,
  CFTC_PRESS_RELEASES_SOURCE_REF,
  CFTC_PROVIDER_ID,
  CFTC_PUBLISHER_ID,
  CFTC_REGULATOR_SCOPE,
  CFTC_RSS_GUIDANCE_REF,
  CFTC_SOURCE_ORIGIN,
  CFTC_WEB_POLICY_REF,
  createCftcPressReleaseScheduledSource,
  normaliseCftcPressReleaseCapture,
} from "../src/intelligence/cftcPressReleaseIntelligence.ts";
import type { ExternalIntelligencePayloadCapture } from "../src/intelligence/sourceAdapters.ts";
import type { ExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";

const RECEIVED_AT_MS = Date.parse("2026-07-29T01:02:59.000Z");
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

function contract(
  overrides: Partial<ExternalIntelligenceSourceContract> = {},
): ExternalIntelligenceSourceContract {
  return {
    sourceId: CFTC_PRESS_RELEASES_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "regulator",
    authority: "authoritative",
    publisherId: CFTC_PUBLISHER_ID,
    providerId: CFTC_PROVIDER_ID,
    sourceOrigin: CFTC_SOURCE_ORIGIN,
    allowedAcquisitionModes: ["scheduled-poll"],
    contentPolicy: "digest-only",
    licenceRef: CFTC_WEB_POLICY_REF,
    licenceSha256: "a".repeat(64),
    attributionRequired: true,
    maximumRetentionMs: null,
    deletionHandling: "not-applicable",
    modelTrainingAllowed: false,
    approvedAtMs: 1_000,
    effectiveFromMs: 1_000,
    expiresAtMs: null,
    enabled: true,
    sourceContractSha256: "b".repeat(64),
    ...overrides,
  };
}

function rss(items: readonly string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0" xml:base="https://www.cftc.gov/">
<channel><title>Press Releases</title>
${items.join("\n")}
</channel></rss>`;
}

function item(
  releaseNumber: string,
  title = "CFTC market structure update",
  guid?: string,
): string {
  const link = `https://www.cftc.gov/PressRoom/PressReleases/${releaseNumber}`;
  return `<item>
<title>${title}</title>
<link>${link}</link>
<description/>
<pubDate>Fri, 24 Jul 2026 19:30:31 +0000</pubDate>
<dc:creator>publisher</dc:creator>
<guid isPermaLink="true">${guid ?? link}</guid>
</item>`;
}

async function capture(
  xml = rss([item("9273-26")]),
  overrides: Partial<ExternalIntelligencePayloadCapture> = {},
): Promise<ExternalIntelligencePayloadCapture> {
  const bytes = new TextEncoder().encode(xml);
  const payloadSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    captureId: "c".repeat(64),
    sourceId: CFTC_PRESS_RELEASES_SOURCE_ID,
    sourceContractSha256: contract().sourceContractSha256,
    sourceKind: "regulator",
    publisherId: CFTC_PUBLISHER_ID,
    providerId: CFTC_PROVIDER_ID,
    sourceRef: CFTC_PRESS_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    requestStartedAtMs: RECEIVED_AT_MS - 2_000,
    receivedAtMs: RECEIVED_AT_MS,
    availableAtMs: RECEIVED_AT_MS + 1_000,
    responseLatencyMs: 2_000,
    availabilityLatencyMs: 1_000,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    payloadBytes: bytes,
    contentType: "application/rss+xml",
    etag: null,
    lastModified: null,
    payloadRetention: "transient-only",
    modelTrainingAllowed: false,
    ...overrides,
  };
}

test("binds the official scheduled CFTC press-release manifest", async () => {
  const source = await createCftcPressReleaseScheduledSource(
    contract(),
    policy,
  );
  assert.deepEqual(source.target, {
    sourceId: CFTC_PRESS_RELEASES_SOURCE_ID,
    sourceRef: CFTC_PRESS_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    acceptedContentTypes: [
      "application/rss+xml",
      "application/xml",
      "text/xml",
    ],
  });
});

test("normalises neutral regulator evidence without retaining titles or XML", async () => {
  const result = await normaliseCftcPressReleaseCapture(
    contract(),
    await capture(
      rss([
        item("9273-26", "Event contracts &amp; self-certification "),
        item("9272-26", "<![CDATA[Designated contract market update]]>"),
      ]),
    ),
    policy,
  );
  assert.equal(result?.itemRecords.length, 2);
  const first = result?.itemRecords[0];
  if (first === undefined) throw new Error("expected CFTC item");
  assert.equal(first.item.sourceKind, "regulator");
  assert.equal(first.item.authority, "authoritative");
  assert.equal(first.item.eventType, "regulatory-action");
  assert.equal(first.item.stance, "neutral");
  assert.deepEqual(first.item.assetSymbols, [CFTC_REGULATOR_SCOPE]);
  assert.equal(
    result?.assessmentRequests[0]?.eventType,
    "regulatory-action",
  );
  assert.equal(result?.assessmentRequests[0]?.stance, "neutral");
  assert.match(first.item.itemId, /^[0-9a-f]{64}$/u);
  assert.match(first.item.contentSha256, /^[0-9a-f]{64}$/u);
  const persisted = JSON.stringify(result);
  assert.equal(persisted.includes("Designated contract market update"), false);
  assert.equal(persisted.includes("<rss"), false);
});

test("is deterministic across feed ordering and returns no empty work", async () => {
  const first = item("9271-26");
  const second = item("9270-26");
  const left = await normaliseCftcPressReleaseCapture(
    contract(),
    await capture(rss([first, second])),
    policy,
  );
  const right = await normaliseCftcPressReleaseCapture(
    contract(),
    await capture(rss([second, first])),
    policy,
  );
  assert.deepEqual(
    left?.itemRecords.map((record) => record.item.itemId),
    right?.itemRecords.map((record) => record.item.itemId),
  );
  assert.equal(
    await normaliseCftcPressReleaseCapture(
      contract(),
      await capture(rss([])),
      policy,
    ),
    null,
  );
});

test("fails closed on unsafe XML, duplicates and malformed structure", async () => {
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${rss([])}`),
      policy,
    ),
    /forbidden/u,
  );
  const duplicate = item("9271-26");
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(rss([duplicate, duplicate])),
      policy,
    ),
    /duplicate/u,
  );
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(rss([duplicate.replace("</item>", "")])),
      policy,
    ),
    /malformed item markup/u,
  );
});

test("fails closed on unapproved links, GUIDs and future publication", async () => {
  const valid = item("9271-26");
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(rss([valid.replaceAll("www.cftc.gov", "example.com")])),
      policy,
    ),
    /outside the approved origin/u,
  );
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(rss([item("9271-26", "Title", "wrong-guid")])),
      policy,
    ),
    /guid does not match/u,
  );
  const future = valid.replace(
    "Fri, 24 Jul 2026 19:30:31 +0000",
    "Thu, 30 Jul 2026 19:30:31 +0000",
  );
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(rss([future])),
      policy,
    ),
    /publication time is invalid/u,
  );
});

test("fails closed on manifest, capture and payload identity mismatch", async () => {
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract({ licenceRef: CFTC_RSS_GUIDANCE_REF }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(undefined, { contentType: "text/html" }),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseCftcPressReleaseCapture(
      contract(),
      await capture(undefined, { payloadSha256: "d".repeat(64) }),
      policy,
    ),
    /digest does not match/u,
  );
});
