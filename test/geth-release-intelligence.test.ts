import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntelligencePolicy } from "../src/intelligence/externalIntelligence.ts";
import {
  createGethReleaseScheduledSource,
  GETH_PUBLISHER_ID,
  GETH_RELEASES_SOURCE_ID,
  GETH_RELEASES_SOURCE_REF,
  GETH_SCOPE,
  GITHUB_API_ORIGIN,
  GITHUB_API_USER_AGENT,
  GITHUB_RELEASES_PROVIDER_ID,
  GITHUB_TERMS_REF,
  normaliseGethReleaseCapture,
} from "../src/intelligence/gethReleaseIntelligence.ts";
import type { ExternalIntelligencePayloadCapture } from "../src/intelligence/sourceAdapters.ts";
import type { ExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";

const RECEIVED_AT_MS = Date.parse("2026-07-29T00:00:00.000Z");
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
    sourceId: GETH_RELEASES_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "issuer",
    authority: "authoritative",
    publisherId: GETH_PUBLISHER_ID,
    providerId: GITHUB_RELEASES_PROVIDER_ID,
    sourceOrigin: GITHUB_API_ORIGIN,
    allowedAcquisitionModes: ["scheduled-poll"],
    contentPolicy: "digest-only",
    licenceRef: GITHUB_TERMS_REF,
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

function release(
  id = 123,
  tag = "v1.17.2",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    html_url: `https://github.com/ethereum/go-ethereum/releases/tag/${tag}`,
    tag_name: tag,
    name: "Do not retain this release name",
    body: "Do not retain these release notes",
    draft: false,
    prerelease: false,
    created_at: "2026-07-28T20:00:00Z",
    published_at: "2026-07-28T21:00:00Z",
    ...overrides,
  };
}

async function capture(
  value: unknown = [release()],
  overrides: Partial<ExternalIntelligencePayloadCapture> = {},
): Promise<ExternalIntelligencePayloadCapture> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  const payloadSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    captureId: "c".repeat(64),
    sourceId: GETH_RELEASES_SOURCE_ID,
    sourceContractSha256: contract().sourceContractSha256,
    sourceKind: "issuer",
    publisherId: GETH_PUBLISHER_ID,
    providerId: GITHUB_RELEASES_PROVIDER_ID,
    sourceRef: GETH_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    requestStartedAtMs: RECEIVED_AT_MS - 2_000,
    receivedAtMs: RECEIVED_AT_MS,
    availableAtMs: RECEIVED_AT_MS + 1_000,
    responseLatencyMs: 2_000,
    availabilityLatencyMs: 1_000,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    payloadBytes: bytes,
    contentType: "application/json",
    etag: null,
    lastModified: null,
    payloadRetention: "transient-only",
    modelTrainingAllowed: false,
    ...overrides,
  };
}

test("binds the account-free GitHub releases API manifest", async () => {
  const source = await createGethReleaseScheduledSource(contract(), policy);
  assert.deepEqual(source.target, {
    sourceId: GETH_RELEASES_SOURCE_ID,
    sourceRef: GETH_RELEASES_SOURCE_REF,
    acquisitionMode: "scheduled-poll",
    acceptedContentTypes: [
      "application/json",
      "application/vnd.github+json",
    ],
    userAgent: GITHUB_API_USER_AGENT,
  });
});

test("normalises neutral ETH.GETH evidence without retaining provider text", async () => {
  const result = await normaliseGethReleaseCapture(
    contract(),
    await capture([
      release(124, "v1.17.2"),
      release(123, "v1.17.1", {
        name: null,
        body: null,
        prerelease: true,
      }),
    ]),
    policy,
  );
  assert.equal(result?.itemRecords.length, 2);
  const item = result?.itemRecords[0]?.item;
  if (item === undefined) throw new Error("expected Geth release item");
  assert.equal(item.sourceKind, "issuer");
  assert.equal(item.authority, "authoritative");
  assert.equal(item.eventType, "other");
  assert.equal(item.stance, "neutral");
  assert.deepEqual(item.assetSymbols, [GETH_SCOPE]);
  assert.equal(result?.assessmentRequests[0]?.stance, "neutral");
  assert.match(item.itemId, /^[0-9a-f]{64}$/u);
  assert.match(item.contentSha256, /^[0-9a-f]{64}$/u);
  const persisted = JSON.stringify(result);
  assert.equal(persisted.includes("Do not retain this release name"), false);
  assert.equal(persisted.includes("Do not retain these release notes"), false);
});

test("is deterministic across API ordering and returns no empty work", async () => {
  const first = release(123, "v1.17.1");
  const second = release(124, "v1.17.2");
  const left = await normaliseGethReleaseCapture(
    contract(),
    await capture([first, second]),
    policy,
  );
  const right = await normaliseGethReleaseCapture(
    contract(),
    await capture([second, first]),
    policy,
  );
  assert.deepEqual(
    left?.itemRecords.map((record) => record.item.itemId),
    right?.itemRecords.map((record) => record.item.itemId),
  );
  assert.equal(
    await normaliseGethReleaseCapture(contract(), await capture([]), policy),
    null,
  );
});

test("fails closed on drafts, duplicate ids and duplicate tags", async () => {
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture([release(123, "v1.17.2", { draft: true })]),
      policy,
    ),
    /must not contain drafts/u,
  );
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture([release(123, "v1.17.1"), release(123, "v1.17.2")]),
      policy,
    ),
    /duplicate identities/u,
  );
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture([release(123, "v1.17.2"), release(124, "v1.17.2")]),
      policy,
    ),
    /duplicate identities/u,
  );
});

test("fails closed on unapproved links, tags and chronology", async () => {
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture([
        release(123, "v1.17.2", {
          html_url: "https://github.com/other/project/releases/tag/v1.17.2",
        }),
      ]),
      policy,
    ),
    /outside the approved repository/u,
  );
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture([release(123, "latest")]),
      policy,
    ),
    /tag is unsupported/u,
  );
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture([
        release(123, "v1.17.2", {
          published_at: "2026-07-29T01:00:00Z",
        }),
      ]),
      policy,
    ),
    /chronology is invalid/u,
  );
});

test("fails closed on manifest, capture and payload identity mismatch", async () => {
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract({ licenceRef: GETH_RELEASES_SOURCE_REF }),
      await capture(),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture(undefined, { contentType: "text/html" }),
      policy,
    ),
    /approved manifest/u,
  );
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture(undefined, { payloadSha256: "d".repeat(64) }),
      policy,
    ),
    /digest does not match/u,
  );
  await assert.rejects(
    normaliseGethReleaseCapture(
      contract(),
      await capture("{"),
      policy,
    ),
    /valid UTF-8 JSON/u,
  );
});
