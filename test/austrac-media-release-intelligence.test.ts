import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import {
  AUSTRAC_COPYRIGHT_REF,
  AUSTRAC_MEDIA_RELEASES_SOURCE_ID,
  AUSTRAC_MEDIA_RELEASES_SOURCE_REF,
  AUSTRAC_PROVIDER_ID,
  AUSTRAC_PUBLISHER_ID,
  AUSTRAC_REGULATOR_SCOPE,
  AUSTRAC_RSS_GUIDANCE_REF,
  AUSTRAC_SOURCE_ORIGIN,
  createAustracMediaReleaseScheduledSource,
  normaliseAustracMediaReleaseCapture,
} from "../src/intelligence/austracMediaReleaseIntelligence.ts";
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
    sourceId: AUSTRAC_MEDIA_RELEASES_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "regulator",
    authority: "authoritative",
    publisherId: AUSTRAC_PUBLISHER_ID,
    providerId: AUSTRAC_PROVIDER_ID,
    sourceOrigin: AUSTRAC_SOURCE_ORIGIN,
    allowedAcquisitionModes: ["scheduled-poll"],
    contentPolicy: "digest-only",
    licenceRef: AUSTRAC_COPYRIGHT_REF,
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
<rss version="2.0"><channel><title>AUSTRAC media releases</title>
${items.join("\n")}
</channel></rss>`;
}

function item(
  slug: string,
  title = "AUSTRAC regulatory update",
  guid?: string,
  path = "new-and-media/news",
): string {
  const link = `https://www.austrac.gov.au/${path}/${slug}`;
  return `<item>
<title>${title}</title>
<link>${link}</link>
<guid isPermaLink="true">${guid ?? link}</guid>
<pubDate>Mon, 06 Jul 2026 09:30:00 +1000</pubDate>
</item>`;
}

async function capture(
  xml = rss([
    item("austrac-steps-supervision-virtual-assets-sector-reforms-take-effect"),
  ]),
  overrides: Partial<ExternalIntelligencePayloadCapture> = {},
): Promise<ExternalIntelligencePayloadCapture> {
  const { captureId: captureIdOverride, ...captureOverrides } = overrides;
  const bytes = new TextEncoder().encode(xml);
  const payloadSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const values: Omit<ExternalIntelligencePayloadCapture, "captureId"> = {
    sourceId: AUSTRAC_MEDIA_RELEASES_SOURCE_ID,
    sourceContractSha256: (await contract()).sourceContractSha256,
    sourceKind: "regulator",
    publisherId: AUSTRAC_PUBLISHER_ID,
    providerId: AUSTRAC_PROVIDER_ID,
    sourceRef: AUSTRAC_MEDIA_RELEASES_SOURCE_REF,
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

test("binds the official scheduled AUSTRAC media-release manifest", async () => {
  const source = await createAustracMediaReleaseScheduledSource(
    await contract(),
    policy,
  );
  assert.deepEqual(source.target, {
    sourceId: AUSTRAC_MEDIA_RELEASES_SOURCE_ID,
    sourceRef: AUSTRAC_MEDIA_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    acceptedContentTypes: [
      "application/rss+xml",
      "application/xml",
      "text/xml",
    ],
  });
});

test("normalises neutral regulator evidence without retaining titles or XML", async () => {
  const result = await normaliseAustracMediaReleaseCapture(
    await contract(),
    await capture(
      rss([
        item(
          "austrac-steps-supervision-virtual-assets-sector-reforms-take-effect",
          "Virtual assets &amp; reforms",
        ),
        item(
          "anti-money-laundering-laws-cover-thousands-more-businesses",
          "<![CDATA[Expanded AML/CTF coverage]]>",
          undefined,
          "news-and-media/media-release",
        ),
        item(
          "austrac-finalises-enforceable-undertaking-sportsbet",
          "Current news path",
          undefined,
          "news-and-media/news",
        ),
      ]),
    ),
    policy,
  );
  assert.equal(result?.itemRecords.length, 3);
  const first = result?.itemRecords[0];
  if (first === undefined) throw new Error("expected AUSTRAC item");
  assert.equal(first.item.sourceKind, "regulator");
  assert.equal(first.item.authority, "authoritative");
  assert.equal(first.item.eventType, "regulatory-action");
  assert.equal(first.item.stance, "neutral");
  assert.deepEqual(first.item.assetSymbols, [AUSTRAC_REGULATOR_SCOPE]);
  assert.equal(
    result?.assessmentRequests[0]?.eventType,
    "regulatory-action",
  );
  assert.equal(result?.assessmentRequests[0]?.stance, "neutral");
  assert.match(first.item.itemId, /^[0-9a-f]{64}$/u);
  assert.match(first.item.contentSha256, /^[0-9a-f]{64}$/u);
  const persisted = JSON.stringify(result);
  assert.equal(persisted.includes("Expanded AML/CTF coverage"), false);
  assert.equal(persisted.includes("<rss"), false);
});

test("is deterministic across feed ordering and returns no empty work", async () => {
  const first = item("anti-money-laundering-laws-cover-thousands-more-businesses");
  const second = item("austrac-finalises-enforceable-undertaking-sportsbet");
  const left = await normaliseAustracMediaReleaseCapture(
    await contract(),
    await capture(rss([first, second])),
    policy,
  );
  const right = await normaliseAustracMediaReleaseCapture(
    await contract(),
    await capture(rss([second, first])),
    policy,
  );
  assert.deepEqual(
    left?.itemRecords.map((record) => record.item.itemId),
    right?.itemRecords.map((record) => record.item.itemId),
  );
  assert.equal(
    await normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([])),
      policy,
    ),
    null,
  );
});

test("fails closed on unsafe XML, duplicates and malformed structure", async () => {
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${rss([])}`),
      policy,
    ),
    /forbidden/u,
  );
  const duplicate = item("austrac-finalises-enforceable-undertaking-sportsbet");
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([duplicate, duplicate])),
      policy,
    ),
    /duplicate/u,
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([duplicate.replace("</item>", "")])),
      policy,
    ),
    /malformed item markup/u,
  );
});

test("fails closed on unapproved links, GUIDs and future publication", async () => {
  const valid = item("austrac-finalises-enforceable-undertaking-sportsbet");
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([valid.replaceAll("www.austrac.gov.au", "example.com")])),
      policy,
    ),
    /outside the approved origin/u,
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(
        rss([
          item(
            "austrac-finalises-enforceable-undertaking-sportsbet",
            "Title",
            "wrong-guid",
          ),
        ]),
      ),
      policy,
    ),
    /guid does not match/u,
  );
  const unsupportedPath = valid.replace(
    "/new-and-media/news/",
    "/news-and-media/press-release/",
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([unsupportedPath])),
      policy,
    ),
    /unsupported canonical path/u,
  );
  const impossibleDate = valid.replace(
    "Mon, 06 Jul 2026 09:30:00 +1000",
    "Mon, 31 Feb 2026 09:30:00 +1000",
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([impossibleDate])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const wrongWeekday = valid.replace(
    "Mon, 06 Jul 2026 09:30:00 +1000",
    "Tue, 06 Jul 2026 09:30:00 +1000",
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([wrongWeekday])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const future = valid.replace(
    "Mon, 06 Jul 2026 09:30:00 +1000",
    "Wed, 29 Jul 2026 09:30:00 +1000",
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(rss([future])),
      policy,
    ),
    /publication time is invalid/u,
  );
});

test("fails closed on manifest, capture and payload identity mismatch", async () => {
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract({ allowedAcquisitionModes: ["scheduled-poll", "webhook"] }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(undefined, { requestStartedAtMs: 0 }),
      policy,
    ),
    /not active/u,
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(undefined, { captureId: "d".repeat(64) }),
      policy,
    ),
    /identity does not reproduce/u,
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract({ licenceRef: AUSTRAC_RSS_GUIDANCE_REF }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(undefined, { contentType: "text/html" }),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseAustracMediaReleaseCapture(
      await contract(),
      await capture(undefined, { payloadSha256: "d".repeat(64) }),
      policy,
    ),
    /digest does not match/u,
  );
});
