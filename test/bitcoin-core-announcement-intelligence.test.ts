import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import {
  BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_ID,
  BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_REF,
  BITCOIN_CORE_LICENCE_REF,
  BITCOIN_CORE_PROVIDER_ID,
  BITCOIN_CORE_PUBLISHER_ID,
  BITCOIN_CORE_RSS_GUIDANCE_REF,
  BITCOIN_CORE_SCOPE,
  BITCOIN_CORE_SOURCE_ORIGIN,
  createBitcoinCoreAnnouncementScheduledSource,
  normaliseBitcoinCoreAnnouncementCapture,
} from "../src/intelligence/bitcoinCoreAnnouncementIntelligence.ts";
import {
  externalIntelligencePayloadCaptureId,
  type ExternalIntelligencePayloadCapture,
} from "../src/intelligence/sourceAdapters.ts";
import {
  createExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContractInput,
} from "../src/intelligence/sourceRegistry.ts";

const RECEIVED_AT_MS = Date.parse("2026-07-28T10:00:00.000Z");
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
    sourceId: BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "issuer",
    authority: "authoritative",
    publisherId: BITCOIN_CORE_PUBLISHER_ID,
    providerId: BITCOIN_CORE_PROVIDER_ID,
    sourceOrigin: BITCOIN_CORE_SOURCE_ORIGIN,
    allowedAcquisitionModes: ["scheduled-poll"],
    contentPolicy: "digest-only",
    licenceRef: BITCOIN_CORE_LICENCE_REF,
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
<rss version="2.0"><channel><title>Bitcoin Core announcements</title>
${items.join("\n")}
</channel></rss>`;
}

function item(
  date: string,
  slug: string,
  title = "Bitcoin Core release announcement",
  guid?: string,
): string {
  const link = `https://bitcoincore.org/en/${date}/${slug}/`;
  return `<item>
<title>${title}</title>
<link>${link}</link>
<guid isPermaLink="true">${guid ?? link}</guid>
<pubDate>Sun, 19 Apr 2026 12:00:00 +0000</pubDate>
</item>`;
}

async function capture(
  xml = rss([item("2026/04/19", "release-31.0")]),
  overrides: Partial<ExternalIntelligencePayloadCapture> = {},
): Promise<ExternalIntelligencePayloadCapture> {
  const { captureId: captureIdOverride, ...captureOverrides } = overrides;
  const bytes = new TextEncoder().encode(xml);
  const payloadSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const values: Omit<ExternalIntelligencePayloadCapture, "captureId"> = {
    sourceId: BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_ID,
    sourceContractSha256: (await contract()).sourceContractSha256,
    sourceKind: "issuer",
    publisherId: BITCOIN_CORE_PUBLISHER_ID,
    providerId: BITCOIN_CORE_PROVIDER_ID,
    sourceRef: BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_REF,
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

test("binds the official scheduled Bitcoin Core announcement manifest", async () => {
  const source = await createBitcoinCoreAnnouncementScheduledSource(
    await contract(),
    policy,
  );
  assert.deepEqual(source.target, {
    sourceId: BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_ID,
    sourceRef: BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    acceptedContentTypes: [
      "application/rss+xml",
      "application/xml",
      "text/xml",
    ],
  });
});

test("normalises neutral BTC.CORE evidence without retaining titles or XML", async () => {
  const result = await normaliseBitcoinCoreAnnouncementCapture(
    await contract(),
    await capture(
      rss([
        item(
          "2026/04/19",
          "release-31.0",
          "Bitcoin Core 31.0 &amp; maintenance",
        ),
        item(
          "2026/02/10",
          "release-29.3",
          "<![CDATA[Bitcoin Core 29.3 released]]>",
        ),
      ]),
    ),
    policy,
  );
  assert.equal(result?.itemRecords.length, 2);
  const first = result?.itemRecords[0];
  if (first === undefined) throw new Error("expected Bitcoin Core item");
  assert.equal(first.item.sourceKind, "issuer");
  assert.equal(first.item.authority, "authoritative");
  assert.equal(first.item.eventType, "other");
  assert.equal(first.item.stance, "neutral");
  assert.deepEqual(first.item.assetSymbols, [BITCOIN_CORE_SCOPE]);
  assert.equal(result?.assessmentRequests[0]?.eventType, "other");
  assert.equal(result?.assessmentRequests[0]?.stance, "neutral");
  assert.match(first.item.itemId, /^[0-9a-f]{64}$/u);
  assert.match(first.item.contentSha256, /^[0-9a-f]{64}$/u);
  const persisted = JSON.stringify(result);
  assert.equal(persisted.includes("Bitcoin Core 29.3 released"), false);
  assert.equal(persisted.includes("<rss"), false);
});

test("is deterministic across feed ordering and returns no empty work", async () => {
  const first = item("2026/02/10", "release-29.3");
  const second = item("2026/04/19", "release-31.0");
  const left = await normaliseBitcoinCoreAnnouncementCapture(
    await contract(),
    await capture(rss([first, second])),
    policy,
  );
  const right = await normaliseBitcoinCoreAnnouncementCapture(
    await contract(),
    await capture(rss([second, first])),
    policy,
  );
  assert.deepEqual(
    left?.itemRecords.map((record) => record.item.itemId),
    right?.itemRecords.map((record) => record.item.itemId),
  );
  assert.equal(
    await normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([])),
      policy,
    ),
    null,
  );
});

test("fails closed on unsafe XML, duplicates and malformed structure", async () => {
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(
        `<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${rss([])}`,
      ),
      policy,
    ),
    /forbidden/u,
  );
  const duplicate = item("2026/04/19", "release-31.0");
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([duplicate, duplicate])),
      policy,
    ),
    /duplicate/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([duplicate.replace("</item>", "")])),
      policy,
    ),
    /malformed item markup/u,
  );
});

test("fails closed on unapproved links, dates, GUIDs and future publication", async () => {
  const valid = item("2026/04/19", "release-31.0");
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([valid.replaceAll("bitcoincore.org", "example.com")])),
      policy,
    ),
    /outside the approved origin/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([item("2026/02/30", "security-advisory")])),
      policy,
    ),
    /invalid date/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(
        rss([
          item("2026/04/19", "release-31.0", "Title", "wrong-guid"),
        ]),
      ),
      policy,
    ),
    /guid does not match/u,
  );
  const impossiblePublication = valid.replace(
    "Sun, 19 Apr 2026 12:00:00 +0000",
    "Sun, 31 Feb 2026 12:00:00 +0000",
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([impossiblePublication])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const wrongWeekday = valid.replace(
    "Sun, 19 Apr 2026 12:00:00 +0000",
    "Mon, 19 Apr 2026 12:00:00 +0000",
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([wrongWeekday])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const future = valid.replace(
    "Sun, 19 Apr 2026 12:00:00 +0000",
    "Wed, 29 Jul 2026 12:00:00 +0000",
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(rss([future])),
      policy,
    ),
    /publication time is invalid/u,
  );
});

test("fails closed on manifest, capture and payload identity mismatch", async () => {
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract({ allowedAcquisitionModes: ["scheduled-poll", "webhook"] }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(undefined, { requestStartedAtMs: 0 }),
      policy,
    ),
    /not active/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(undefined, { captureId: "d".repeat(64) }),
      policy,
    ),
    /identity does not reproduce/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract({ licenceRef: BITCOIN_CORE_RSS_GUIDANCE_REF }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(undefined, { contentType: "text/html" }),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseBitcoinCoreAnnouncementCapture(
      await contract(),
      await capture(undefined, { payloadSha256: "d".repeat(64) }),
      policy,
    ),
    /digest does not match/u,
  );
});
