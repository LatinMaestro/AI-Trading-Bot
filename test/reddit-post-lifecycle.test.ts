import assert from "node:assert/strict";
import test from "node:test";
import {
  REDDIT_DATA_API_TERMS_REF,
  REDDIT_MAXIMUM_RETENTION_MS,
  REDDIT_OAUTH_ORIGIN,
  REDDIT_PROVIDER_ID,
  REDDIT_PUBLISHER_ID,
  createRedditOAuthListingTarget,
  type RedditOAuthListingCapture,
} from "../src/intelligence/redditOAuthAdapter.ts";
import {
  createRedditPostRetentionTarget,
  normaliseRedditPostListing,
  reconcileRedditPostRetention,
} from "../src/intelligence/redditPostLifecycle.ts";
import type { ExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";
import { bytesToHex } from "../src/utils/encoding.ts";

const SOURCE_ID = "reddit-cryptocurrency-new";
const SUBREDDIT = "CryptoCurrency";
const LISTING_TARGET = createRedditOAuthListingTarget(SOURCE_ID, SUBREDDIT);

function contract(): ExternalIntelligenceSourceContract {
  return {
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
    sourceContractSha256: "b".repeat(64),
  };
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
  body: string,
  sourceRef = LISTING_TARGET.sourceRef,
  availableAtMs = 2_100,
  deleteByMs = availableAtMs + REDDIT_MAXIMUM_RETENTION_MS,
): Promise<RedditOAuthListingCapture> {
  const payloadBytes = new TextEncoder().encode(body);
  const payloadSha256 = bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", payloadBytes)),
  );
  return {
    captureId: "c".repeat(64),
    sourceId: SOURCE_ID,
    sourceContractSha256: contract().sourceContractSha256,
    sourceRef,
    acquisitionMode: "minute-poll",
    requestStartedAtMs: availableAtMs - 200,
    receivedAtMs: availableAtMs - 100,
    availableAtMs,
    responseLatencyMs: 100,
    availabilityLatencyMs: 100,
    payloadSha256,
    payloadByteLength: payloadBytes.byteLength,
    payloadBytes,
    contentType: "application/json",
    payloadRetention: "transient-only",
    deleteByMs,
    rateLimit: {
      observedAtMs: availableAtMs,
      usedMilliqueries: 100_000,
      remainingMilliqueries: 900_000,
      resetAtMs: availableAtMs + 600_000,
      nextAllowedRequestAtMs: availableAtMs + 1_000,
    },
    modelTrainingAllowed: false,
  };
}

test("normalises only transient post metadata and excludes provider content", async () => {
  const result = await normaliseRedditPostListing(
    contract(),
    LISTING_TARGET,
    await capture(listing([post("abc123"), post("def456")])),
  );
  assert.equal(result.observations.length, 2);
  assert.equal(result.durableQueueAllowed, false);
  const first = result.observations[0];
  assert.ok(first);
  assert.equal(
    first.deleteByMs - first.availableAtMs,
    REDDIT_MAXIMUM_RETENTION_MS,
  );
  const serialised = JSON.stringify(result);
  for (const forbidden of [
    "forbidden title",
    "forbidden body",
    "forbidden_author",
    "provider_title",
  ]) {
    assert.equal(serialised.includes(forbidden), false);
  }
});

test("ignores posts already marked unavailable by Reddit", async () => {
  const result = await normaliseRedditPostListing(
    contract(),
    LISTING_TARGET,
    await capture(
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
  const batch = await normaliseRedditPostListing(
    contract(),
    LISTING_TARGET,
    await capture(listing([post("def456"), post("abc123")])),
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
    contract(),
    batch.observations,
    target,
    await capture(listing([post("abc123")]), target.sourceRef, 3_000),
  );
  assert.deepEqual(
    sweep.retained.map((entry) => entry.fullname),
    ["t3_abc123"],
  );
  assert.deepEqual(sweep.purges, [
    {
      observationId:
        batch.observations.find((entry) => entry.fullname === "t3_def456")
          ?.observationId,
      reason: "provider-unavailable",
      purgeByMs: 3_000,
    },
  ]);
  assert.equal(sweep.audit.providerUnavailableCount, 1);
  assert.equal(sweep.audit.containsRedditPostData, false);
  assert.equal(
    JSON.stringify(sweep.audit).includes("t3_"),
    false,
  );
});

test("purges every observation no later than its retention deadline", async () => {
  const initial = await capture(
    listing([post("abc123")]),
    LISTING_TARGET.sourceRef,
    2_100,
    3_000,
  );
  const batch = await normaliseRedditPostListing(
    contract(),
    LISTING_TARGET,
    initial,
  );
  const target = createRedditPostRetentionTarget(
    SOURCE_ID,
    SUBREDDIT,
    batch.observations,
  );
  const sweep = await reconcileRedditPostRetention(
    contract(),
    batch.observations,
    target,
    await capture(listing([post("abc123")]), target.sourceRef, 3_000, 4_000),
  );
  assert.equal(sweep.retained.length, 0);
  assert.equal(sweep.purges[0]?.reason, "retention-expired");
  assert.equal(sweep.audit.nextSweepAtMs, null);
});

test("fails closed on changed identity, unrequested posts and payload conflicts", async () => {
  const batch = await normaliseRedditPostListing(
    contract(),
    LISTING_TARGET,
    await capture(listing([post("abc123")])),
  );
  const target = createRedditPostRetentionTarget(
    SOURCE_ID,
    SUBREDDIT,
    batch.observations,
  );
  await assert.rejects(
    reconcileRedditPostRetention(
      contract(),
      batch.observations,
      target,
      await capture(
        listing([post("abc123", { created_utc: 2 })]),
        target.sourceRef,
        3_000,
      ),
    ),
    /immutable metadata changed/,
  );
  await assert.rejects(
    reconcileRedditPostRetention(
      contract(),
      batch.observations,
      target,
      await capture(
        listing([post("abc123"), post("def456")]),
        target.sourceRef,
        3_000,
      ),
    ),
    /unrequested post/,
  );
  const changed = await capture(listing([post("abc123")]));
  changed.payloadBytes[0] = 0;
  await assert.rejects(
    normaliseRedditPostListing(contract(), LISTING_TARGET, changed),
    /payload identity does not match/,
  );
});
