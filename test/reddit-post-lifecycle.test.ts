import assert from "node:assert/strict";
import test from "node:test";
import {
  REDDIT_DATA_API_TERMS_REF,
  REDDIT_MAXIMUM_RETENTION_MS,
  REDDIT_OAUTH_ORIGIN,
  REDDIT_PROVIDER_ID,
  REDDIT_PUBLISHER_ID,
  createRedditOAuthInfoTarget,
  createRedditOAuthListingTarget,
  type RedditOAuthListingCapture,
} from "../src/intelligence/redditOAuthAdapter.ts";
import {
  createRedditPostRetentionTarget,
  normaliseRedditPostListing,
  reconcileRedditPostRetention,
} from "../src/intelligence/redditPostLifecycle.ts";
import { externalIntelligencePayloadCaptureId } from "../src/intelligence/sourceAdapters.ts";
import {
  createExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "../src/intelligence/sourceRegistry.ts";
import { bytesToHex } from "../src/utils/encoding.ts";

const SOURCE_ID = "reddit-cryptocurrency-new";
const SUBREDDIT = "CryptoCurrency";
const LISTING_TARGET = createRedditOAuthListingTarget(SOURCE_ID, SUBREDDIT);

async function contract(
  overrides: Partial<Parameters<typeof createExternalIntelligenceSourceContract>[0]> = {},
): Promise<ExternalIntelligenceSourceContract> {
  return createExternalIntelligenceSourceContract({
    sourceId: SOURCE_ID,
    contractVersion: 1,
    sourceKind: "reddit",
    authority: "social",
    publisherId: REDDIT_PUBLISHER_ID,
    providerId: REDDIT_PROVIDER_ID,
    sourceOrigin: REDDIT_OAUTH_ORIGIN,
    allowedAcquisitionModes: ["minute-poll"],
    contentPolicy: "metadata-only",
    licenceRef: REDDIT_DATA_API_TERMS_REF,
    licenceSha256: "a".repeat(64),
    attributionRequired: true,
    maximumRetentionMs: REDDIT_MAXIMUM_RETENTION_MS,
    deletionHandling: "required",
    modelTrainingAllowed: false,
    approvedAtMs: 1_000,
    effectiveFromMs: 1_000,
    expiresAtMs: null,
    enabled: true,
    ...overrides,
  });
}

function post(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      subreddit: SUBREDDIT,
      subreddit_name_prefixed: `r/${SUBREDDIT}`,
      created_utc: 1,
      permalink: `/r/${SUBREDDIT}/comments/${id}/provider_title/`,
      title: `forbidden title ${id}`,
      selftext: `forbidden body ${id}`,
      author: `forbidden_author_${id}`,
      ...overrides,
    },
  };
}

function listing(children: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ kind: "Listing", data: { children } });
}

async function capture(
  currentContract: ExternalIntelligenceSourceContract,
  body: string,
  sourceRef = LISTING_TARGET.sourceRef,
  availableAtMs = 2_100,
): Promise<RedditOAuthListingCapture> {
  const payloadBytes = new TextEncoder().encode(body);
  const payloadSha256 = bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", payloadBytes)),
  );
  const requestStartedAtMs = availableAtMs - 200;
  const receivedAtMs = availableAtMs - 100;
  const maximumRetentionMs = currentContract.maximumRetentionMs;
  if (maximumRetentionMs === null) throw new Error("expected finite retention");
  const captureId = await externalIntelligencePayloadCaptureId({
    sourceId: currentContract.sourceId,
    sourceContractSha256: currentContract.sourceContractSha256,
    sourceKind: "reddit",
    sourceRef,
    acquisitionMode: "minute-poll",
    requestStartedAtMs,
    receivedAtMs,
    availableAtMs,
    payloadSha256,
    payloadByteLength: payloadBytes.byteLength,
    contentType: "application/json",
    etag: null,
    lastModified: null,
  });
  return {
    captureId,
    sourceId: SOURCE_ID,
    sourceContractSha256: currentContract.sourceContractSha256,
    sourceKind: "reddit",
    publisherId: REDDIT_PUBLISHER_ID,
    providerId: REDDIT_PROVIDER_ID,
    sourceRef,
    acquisitionMode: "minute-poll",
    requestStartedAtMs,
    receivedAtMs,
    availableAtMs,
    responseLatencyMs: 100,
    availabilityLatencyMs: 100,
    payloadSha256,
    payloadByteLength: payloadBytes.byteLength,
    payloadBytes,
    contentType: "application/json",
    etag: null,
    lastModified: null,
    payloadRetention: "transient-only",
    deleteByMs: receivedAtMs + maximumRetentionMs,
    rateLimit: {
      observedAtMs: receivedAtMs,
      usedMilliqueries: 100_000,
      remainingMilliqueries: 900_000,
      resetAtMs: receivedAtMs + 600_000,
      nextAllowedRequestAtMs: receivedAtMs + 1_000,
    },
    modelTrainingAllowed: false,
  };
}

test("normalises only transient post metadata and excludes provider content", async () => {
  const currentContract = await contract();
  const result = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    await capture(currentContract, listing([post("abc123"), post("def456")])),
  );
  assert.equal(result.observations.length, 2);
  assert.equal(result.durableQueueAllowed, false);
  const first = result.observations[0];
  assert.ok(first);
  assert.equal(
    first.deleteByMs - first.receivedAtMs,
    REDDIT_MAXIMUM_RETENTION_MS,
  );
  for (const forbidden of [
    "forbidden title",
    "forbidden body",
    "forbidden_author",
    "provider_title",
  ]) {
    assert.equal(JSON.stringify(result).includes(forbidden), false);
  }
});

test("keeps transient observation identity stable across listing captures", async () => {
  const currentContract = await contract();
  const body = listing([post("abc123")]);
  const first = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    await capture(currentContract, body, LISTING_TARGET.sourceRef, 2_100),
  );
  const second = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    await capture(currentContract, body, LISTING_TARGET.sourceRef, 3_100),
  );
  assert.equal(
    first.observations[0]?.observationId,
    second.observations[0]?.observationId,
  );
  assert.notEqual(first.captureId, second.captureId);
});

test("ignores posts already marked unavailable by Reddit", async () => {
  const currentContract = await contract();
  const result = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    await capture(
      currentContract,
      listing([
        post("abc123"),
        post("def456", { author: "[deleted]", selftext: "[deleted]" }),
        post("ghi789", { removed_by_category: "moderator" }),
      ]),
    ),
  );
  assert.deepEqual(
    result.observations.map((entry) => entry.fullname),
    ["t3_abc123"],
  );
  assert.equal(result.ignoredUnavailableCount, 2);
});

test("creates a canonical bounded info target and purges absent posts", async () => {
  const currentContract = await contract();
  const batch = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    await capture(currentContract, listing([post("def456"), post("abc123")])),
  );
  const target = createRedditPostRetentionTarget(
    SOURCE_ID,
    SUBREDDIT,
    batch.observations,
  );
  assert.equal(
    target.sourceRef,
    "https://oauth.reddit.com/r/CryptoCurrency/api/info?id=t3_abc123%2Ct3_def456&raw_json=1",
  );
  const sweep = await reconcileRedditPostRetention(
    currentContract,
    batch.observations,
    target,
    await capture(currentContract, listing([post("abc123")]), target.sourceRef, 3_000),
  );
  assert.deepEqual(
    sweep.retained.map((entry) => entry.fullname),
    ["t3_abc123"],
  );
  assert.equal(sweep.purges[0]?.reason, "provider-unavailable");
  assert.equal(sweep.purges[0]?.purgeByMs, 3_000);
  assert.equal(sweep.audit.providerUnavailableCount, 1);
  assert.equal(sweep.audit.containsRedditPostData, false);
  assert.equal(JSON.stringify(sweep.audit).includes("t3_"), false);
});

test("purges observations at their retention deadline", async () => {
  const currentContract = await contract();
  const initial = await capture(
    currentContract,
    listing([post("abc123")]),
  );
  const batch = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    initial,
  );
  const target = createRedditPostRetentionTarget(
    SOURCE_ID,
    SUBREDDIT,
    batch.observations,
  );
  const deadline = batch.observations[0]?.deleteByMs;
  assert.ok(deadline);
  const sweep = await reconcileRedditPostRetention(
    currentContract,
    batch.observations,
    target,
    await capture(currentContract, listing([post("abc123")]), target.sourceRef, deadline),
  );
  assert.equal(sweep.retained.length, 0);
  assert.equal(sweep.purges[0]?.reason, "retention-expired");
  assert.equal(sweep.audit.nextSweepAtMs, null);
});

test("fails closed on changed identity, unrequested posts and payload conflicts", async () => {
  const currentContract = await contract();
  const batch = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    await capture(currentContract, listing([post("abc123")])),
  );
  const target = createRedditPostRetentionTarget(
    SOURCE_ID,
    SUBREDDIT,
    batch.observations,
  );
  await assert.rejects(
    reconcileRedditPostRetention(
      currentContract,
      batch.observations,
      target,
      await capture(
        currentContract,
        listing([post("abc123", { created_utc: 2 })]),
        target.sourceRef,
        3_000,
      ),
    ),
    /immutable metadata changed/,
  );
  await assert.rejects(
    reconcileRedditPostRetention(
      currentContract,
      batch.observations,
      target,
      await capture(
        currentContract,
        listing([post("abc123"), post("def456")]),
        target.sourceRef,
        3_000,
      ),
    ),
    /unrequested post/,
  );
  const validCapture = await capture(currentContract, listing([post("abc123")]));
  const changedBytes = new Uint8Array(validCapture.payloadBytes);
  changedBytes[0] = 0;
  await assert.rejects(
    normaliseRedditPostListing(
      currentContract,
      LISTING_TARGET,
      { ...validCapture, payloadBytes: changedBytes },
    ),
    /payload identity does not match/,
  );
});

test("reproduces contract, capture and observation identities", async () => {
  const currentContract = await contract();
  const validCapture = await capture(currentContract, listing([post("abc123")]));
  await assert.rejects(
    normaliseRedditPostListing(
      { ...currentContract, sourceContractSha256: "b".repeat(64) },
      LISTING_TARGET,
      validCapture,
    ),
    /digest does not match/,
  );
  await assert.rejects(
    normaliseRedditPostListing(
      currentContract,
      LISTING_TARGET,
      { ...validCapture, captureId: "c".repeat(64) },
    ),
    /capture is inconsistent/,
  );
  const batch = await normaliseRedditPostListing(
    currentContract,
    LISTING_TARGET,
    validCapture,
  );
  const target = createRedditPostRetentionTarget(
    SOURCE_ID,
    SUBREDDIT,
    batch.observations,
  );
  await assert.rejects(
    reconcileRedditPostRetention(
      currentContract,
      [{ ...batch.observations[0]!, metadataSha256: "d".repeat(64) }],
      target,
      await capture(currentContract, listing([post("abc123")]), target.sourceRef, 3_000),
    ),
    /observation is invalid/,
  );
});

test("rejects inactive or broadened source contracts", async () => {
  const valid = await contract();
  await assert.rejects(
    normaliseRedditPostListing(
      await contract({ effectiveFromMs: 3_000 }),
      LISTING_TARGET,
      await capture(valid, listing([post("abc123")])),
    ),
    /not active|does not match/,
  );
  const broadened = await contract({
    allowedAcquisitionModes: ["minute-poll", "scheduled-poll"],
  });
  await assert.rejects(
    normaliseRedditPostListing(
      broadened,
      LISTING_TARGET,
      await capture(broadened, listing([post("abc123")])),
    ),
    /outside the manifest/,
  );
});

test("rejects malformed or duplicate info targets", () => {
  assert.throws(
    () => createRedditOAuthInfoTarget(SOURCE_ID, SUBREDDIT, []),
    /1 to 100/,
  );
  assert.throws(
    () => createRedditOAuthInfoTarget(
      SOURCE_ID,
      SUBREDDIT,
      ["t3_abc123", "t3_abc123"],
    ),
    /duplicate/,
  );
  assert.throws(
    () => createRedditOAuthInfoTarget(SOURCE_ID, SUBREDDIT, ["t1_abc123"]),
    /not canonical/,
  );
});
