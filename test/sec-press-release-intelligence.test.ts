import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import {
  createSecPressReleaseScheduledSource,
  normaliseSecPressReleaseCapture,
  SEC_PRESS_RELEASES_SOURCE_ID,
  SEC_PRESS_RELEASES_SOURCE_REF,
  SEC_PROVIDER_ID,
  SEC_PUBLISHER_ID,
  SEC_REGULATOR_SCOPE,
  SEC_RSS_POLICY_REF,
  SEC_SOURCE_ORIGIN,
} from "../src/intelligence/secPressReleaseIntelligence.ts";
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
const DECLARED_USER_AGENT =
  "AI-Trading-Bot-External-Intelligence/1 operations@example.com";
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
    sourceId: SEC_PRESS_RELEASES_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "regulator",
    authority: "authoritative",
    publisherId: SEC_PUBLISHER_ID,
    providerId: SEC_PROVIDER_ID,
    sourceOrigin: SEC_SOURCE_ORIGIN,
    allowedAcquisitionModes: ["scheduled-poll"],
    contentPolicy: "digest-only",
    licenceRef: SEC_RSS_POLICY_REF,
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
<rss version="2.0"><channel><title>SEC Press Releases</title>
${items.join("\n")}
</channel></rss>`;
}

function item(
  id: string,
  title = "SEC Announces Deterministic Test",
  guid?: string,
): string {
  const link = `https://www.sec.gov/newsroom/press-releases/${id}-deterministic-test`;
  return `<item>
<title>${title}</title>
<link>${link}</link>
<guid isPermaLink="true">${guid ?? link}</guid>
<pubDate>Mon, 27 Jul 2026 17:00:00 GMT</pubDate>
</item>`;
}

async function capture(
  xml = rss([item("2026-70")]),
  overrides: Partial<ExternalIntelligencePayloadCapture> = {},
): Promise<ExternalIntelligencePayloadCapture> {
  const { captureId: captureIdOverride, ...captureOverrides } = overrides;
  const bytes = new TextEncoder().encode(xml);
  const payloadSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const values: Omit<ExternalIntelligencePayloadCapture, "captureId"> = {
    sourceId: SEC_PRESS_RELEASES_SOURCE_ID,
    sourceContractSha256: (await contract()).sourceContractSha256,
    sourceKind: "regulator",
    publisherId: SEC_PUBLISHER_ID,
    providerId: SEC_PROVIDER_ID,
    sourceRef: SEC_PRESS_RELEASES_SOURCE_REF,
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
    modelTrainingAllowed: false as const,
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

test("binds the approved scheduled SEC manifest and declared contact", async () => {
  const source = await createSecPressReleaseScheduledSource(
    await contract(),
    policy,
    DECLARED_USER_AGENT,
  );
  assert.deepEqual(source.target, {
    sourceId: SEC_PRESS_RELEASES_SOURCE_ID,
    sourceRef: SEC_PRESS_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    acceptedContentTypes: [
      "application/rss+xml",
      "application/xml",
      "text/xml",
    ],
    userAgent: DECLARED_USER_AGENT,
  });
  for (const invalid of [
    "AI-Trading-Bot-External-Intelligence/1",
    " AI-Trading-Bot/1 operations@example.com",
    "AI-Trading-Bot/1 operations@example.com\r\nInjected: true",
  ]) {
    await assert.rejects(
      createSecPressReleaseScheduledSource(await contract(), policy, invalid),
      /truthful contact email/u,
    );
  }
});

test("normalises metadata deterministically without retaining titles or raw XML", async () => {
  const left = await normaliseSecPressReleaseCapture(
    await contract(),
    await capture(
      rss([
        item("2026-71", "other"),
        item("2026-70", "<![CDATA[First bounded title]]>"),
      ]),
    ),
    policy,
  );
  const right = await normaliseSecPressReleaseCapture(
    await contract(),
    await capture(
      rss([
        item("2026-70", "<![CDATA[First bounded title]]>"),
        item("2026-71", "other"),
      ]),
    ),
    policy,
  );
  assert.deepEqual(
    left?.itemRecords.map((record) => record.item.itemId),
    right?.itemRecords.map((record) => record.item.itemId),
  );
  const itemRecord = left?.itemRecords[0];
  if (itemRecord === undefined) throw new Error("expected SEC item");
  assert.equal(itemRecord.item.sourceKind, "regulator");
  assert.equal(itemRecord.item.authority, "authoritative");
  assert.equal(itemRecord.item.eventType, "other");
  assert.equal(itemRecord.item.stance, "neutral");
  assert.deepEqual(itemRecord.item.assetSymbols, [SEC_REGULATOR_SCOPE]);
  assert.equal(left?.assessmentRequests[0]?.stance, "neutral");
  assert.equal(left?.assessmentRequests[0]?.eventType, "other");
  assert.match(itemRecord.item.itemId, /^[0-9a-f]{64}$/u);
  assert.match(itemRecord.item.contentSha256, /^[0-9a-f]{64}$/u);
  const persisted = JSON.stringify(left);
  assert.equal(persisted.includes("First bounded title"), false);
  assert.equal(persisted.includes("<rss"), false);
});

test("returns no work for an empty channel", async () => {
  assert.equal(
    await normaliseSecPressReleaseCapture(
      await contract(),
      await capture(rss([])),
      policy,
    ),
    null,
  );
});

test("fails closed on unsafe XML, duplicate ids and unapproved links", async () => {
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${rss([])}`),
      policy,
    ),
    /forbidden/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(rss([item("2026-70"), item("2026-70")])),
      policy,
    ),
    /duplicate/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(
        rss([item("2026-70").replace("</item>", "")]),
      ),
      policy,
    ),
    /malformed item markup/u,
  );
  const badHost = item("2026-70").replace(
    /https:\/\/www\.sec\.gov/gu,
    "https://example.com",
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(rss([badHost])),
      policy,
    ),
    /outside the approved origin/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(rss([item("2026-70", "Title", "wrong-guid")])),
      policy,
    ),
    /guid does not match/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(
        `${rss([item("2026-70")])}<rss version="2.0"></rss>`,
      ),
      policy,
    ),
    /canonical RSS root/u,
  );
});

test("fails closed on manifest, digest and publication chronology mismatch", async () => {
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract({ allowedAcquisitionModes: ["scheduled-poll", "webhook"] }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract({ maximumRetentionMs: 60_000 }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(undefined, { requestStartedAtMs: 0 }),
      policy,
    ),
    /not active/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(undefined, { captureId: "d".repeat(64) }),
      policy,
    ),
    /identity does not reproduce/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract({ sourceKind: "official-exchange" }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(undefined, { payloadSha256: "d".repeat(64) }),
      policy,
    ),
    /digest does not match/u,
  );
  const malformed = item("2026-70").replace(
    "Mon, 27 Jul 2026 17:00:00 GMT",
    "Tue, 27 Jul 2026 17:00:00 GMT",
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(rss([malformed])),
      policy,
    ),
    /publication time is invalid/u,
  );
  const future = item("2026-70").replace(
    "Mon, 27 Jul 2026 17:00:00 GMT",
    "Wed, 29 Jul 2026 17:00:00 GMT",
  );
  await assert.rejects(
    normaliseSecPressReleaseCapture(
      await contract(),
      await capture(rss([future])),
      policy,
    ),
    /publication time is invalid/u,
  );
});
