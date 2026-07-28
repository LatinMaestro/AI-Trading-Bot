import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireRedditOAuthListing,
  createRedditOAuthInfoTarget,
  createRedditOAuthListingTarget,
  createRedditOAuthUserAgent,
  REDDIT_DATA_API_TERMS_REF,
  REDDIT_MAXIMUM_RETENTION_MS,
  REDDIT_OAUTH_ORIGIN,
  REDDIT_PROVIDER_ID,
  REDDIT_PUBLISHER_ID,
  type RedditOAuthFetcher,
  type RedditRateLimitState,
} from "../src/intelligence/redditOAuthAdapter.ts";
import type { ExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";

const SOURCE_ID = "reddit-cryptocurrency-new";
const ACCESS_TOKEN = "token-with-sufficient-length";
const USER_AGENT = createRedditOAuthUserAgent("approved_bot");
const TARGET = createRedditOAuthListingTarget(SOURCE_ID, "CryptoCurrency");

function contract(
  overrides: Partial<ExternalIntelligenceSourceContract> = {},
): ExternalIntelligenceSourceContract {
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
    ...overrides,
  };
}

function listing(): string {
  return JSON.stringify({
    kind: "Listing",
    data: {
      after: "t3_next",
      dist: 1,
      children: [{ kind: "t3", data: { name: "t3_example" } }],
    },
  });
}

function headers(
  overrides: Record<string, string> = {},
): Headers {
  return new Headers({
    "content-type": "application/json; charset=UTF-8",
    "x-ratelimit-used": "100.000",
    "x-ratelimit-remaining": "900.000",
    "x-ratelimit-reset": "600.000",
    ...overrides,
  });
}

function sequenceClock(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error("clock exhausted");
    index += 1;
    return value;
  };
}

function fetcher(
  response: Response,
  inspect?: (input: string, init: RequestInit) => void,
): RedditOAuthFetcher {
  return {
    fetch: async (input, init) => {
      inspect?.(input, init);
      return response;
    },
  };
}

function response(
  body = listing(),
  init: ResponseInit = {},
  url = TARGET.sourceRef,
): Response {
  const value = new Response(body, {
    status: 200,
    headers: headers(),
    ...init,
  });
  Object.defineProperties(value, {
    url: { value: url },
    redirected: { value: false },
  });
  return value;
}

test("builds canonical OAuth-only targets and truthful-format user agents", () => {
  assert.equal(
    TARGET.sourceRef,
    "https://oauth.reddit.com/r/CryptoCurrency/new?limit=100&raw_json=1",
  );
  assert.equal(
    USER_AGENT,
    "cloudflare-worker:ai-crypto-trader:v1.0 (by /u/approved_bot)",
  );
  assert.equal(
    createRedditOAuthInfoTarget(SOURCE_ID, "CryptoCurrency", [
      "t3_def456",
      "t3_abc123",
    ]).sourceRef,
    "https://oauth.reddit.com/r/CryptoCurrency/api/info?id=t3_abc123%2Ct3_def456&raw_json=1",
  );
  assert.throws(
    () => createRedditOAuthListingTarget(SOURCE_ID, "../all"),
    /subreddit is not canonical/,
  );
  assert.throws(
    () =>
      createRedditOAuthInfoTarget(SOURCE_ID, "CryptoCurrency", [
        "t3_same",
        "t3_same",
      ]),
    /duplicate post fullnames/,
  );
  assert.throws(
    () => createRedditOAuthUserAgent("not a user"),
    /username is not canonical/,
  );
});

test("captures bounded OAuth JSON without retaining credentials or the user agent", async () => {
  let sawRequest = false;
  const result = await acquireRedditOAuthListing({
    contract: contract(),
    target: TARGET,
    accessToken: ACCESS_TOKEN,
    userAgent: USER_AGENT,
    scheduledAtMs: 1_000,
    now: sequenceClock(2_000, 2_050, 2_075),
    fetcher: fetcher(response(), (input, init) => {
      sawRequest = true;
      assert.equal(input, TARGET.sourceRef);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      const requestHeaders = new Headers(init.headers);
      assert.equal(
        requestHeaders.get("authorization"),
        `Bearer ${ACCESS_TOKEN}`,
      );
      assert.equal(requestHeaders.get("user-agent"), USER_AGENT);
    }),
  });
  assert.equal(sawRequest, true);
  assert.equal(result.status, "captured");
  if (result.capture === null) throw new Error("expected capture");
  assert.equal(result.capture.payloadRetention, "transient-only");
  assert.equal(result.capture.modelTrainingAllowed, false);
  assert.equal(
    result.capture.deleteByMs,
    result.capture.receivedAtMs + REDDIT_MAXIMUM_RETENTION_MS,
  );
  assert.match(result.capture.captureId, /^[0-9a-f]{64}$/u);
  assert.match(result.capture.payloadSha256, /^[0-9a-f]{64}$/u);
  const retained = JSON.stringify(result);
  assert.equal(retained.includes(ACCESS_TOKEN), false);
  assert.equal(retained.includes(USER_AGENT), false);
});

test("adapts request spacing while preserving a ten-percent free-tier reserve", async () => {
  const result = await acquireRedditOAuthListing({
    contract: contract(),
    target: TARGET,
    accessToken: ACCESS_TOKEN,
    userAgent: USER_AGENT,
    scheduledAtMs: 1_000,
    now: sequenceClock(2_000, 2_050, 2_075),
    fetcher: fetcher(
      response(
        listing(),
        {
          headers: headers({
            "x-ratelimit-used": "899",
            "x-ratelimit-remaining": "101",
            "x-ratelimit-reset": "600",
          }),
        },
      ),
    ),
  });
  assert.equal(result.rateLimit.usedMilliqueries, 899_000);
  assert.equal(result.rateLimit.remainingMilliqueries, 101_000);
  assert.equal(
    result.rateLimit.nextAllowedRequestAtMs,
    result.rateLimit.observedAtMs + 600_000,
  );
});

test("defers without network access while prior adaptive state is active", async () => {
  const previous: RedditRateLimitState = {
    observedAtMs: 1_000,
    usedMilliqueries: 100_000,
    remainingMilliqueries: 900_000,
    resetAtMs: 601_000,
    nextAllowedRequestAtMs: 5_000,
  };
  let called = false;
  const result = await acquireRedditOAuthListing({
    contract: contract(),
    target: TARGET,
    accessToken: ACCESS_TOKEN,
    userAgent: USER_AGENT,
    scheduledAtMs: 4_999,
    previousRateLimit: previous,
    fetcher: {
      fetch: async () => {
        called = true;
        return response();
      },
    },
  });
  assert.equal(result.status, "deferred");
  assert.equal(result.rateLimit, previous);
  assert.equal(called, false);
});

test("rejects prior adaptive state scheduled beyond its reset", async () => {
  await assert.rejects(
    acquireRedditOAuthListing({
      contract: contract(),
      target: TARGET,
      accessToken: ACCESS_TOKEN,
      userAgent: USER_AGENT,
      scheduledAtMs: 4_999,
      previousRateLimit: {
        observedAtMs: 1_000,
        usedMilliqueries: 100_000,
        remainingMilliqueries: 900_000,
        resetAtMs: 5_000,
        nextAllowedRequestAtMs: 5_001,
      },
      fetcher: fetcher(response()),
    }),
    /Previous Reddit rate-limit state is invalid/,
  );
});

test("honours bounded Retry-After without reading a 429 body", async () => {
  const limited = new Response("provider detail must not be retained", {
    status: 429,
    headers: { "retry-after": "120" },
  });
  Object.defineProperties(limited, {
    url: { value: TARGET.sourceRef },
    redirected: { value: false },
  });
  const result = await acquireRedditOAuthListing({
    contract: contract(),
    target: TARGET,
    accessToken: ACCESS_TOKEN,
    userAgent: USER_AGENT,
    scheduledAtMs: 1_000,
    now: sequenceClock(2_000, 2_050),
    fetcher: fetcher(limited),
  });
  assert.equal(result.status, "rate-limited");
  assert.equal(result.capture, null);
  assert.equal(result.rateLimit.nextAllowedRequestAtMs, 122_050);
});

test("rejects contracts without short retention and deletion handling", async () => {
  await assert.rejects(
    acquireRedditOAuthListing({
      contract: contract({
        maximumRetentionMs: REDDIT_MAXIMUM_RETENTION_MS + 1,
      }),
      target: TARGET,
      accessToken: ACCESS_TOKEN,
      userAgent: USER_AGENT,
      scheduledAtMs: 1_000,
      fetcher: fetcher(response()),
    }),
    /outside the approved manifest/,
  );
  await assert.rejects(
    acquireRedditOAuthListing({
      contract: contract({ deletionHandling: "not-applicable" }),
      target: TARGET,
      accessToken: ACCESS_TOKEN,
      userAgent: USER_AGENT,
      scheduledAtMs: 1_000,
      fetcher: fetcher(response()),
    }),
    /outside the approved manifest/,
  );
});

test("fails closed on redirects, media types, malformed limits and non-listings", async () => {
  await assert.rejects(
    acquireRedditOAuthListing({
      contract: contract(),
      target: TARGET,
      accessToken: ACCESS_TOKEN,
      userAgent: USER_AGENT,
      scheduledAtMs: 1_000,
      now: sequenceClock(2_000, 2_050),
      fetcher: fetcher(
        response(listing(), {}, "https://oauth.reddit.com/r/all/new"),
      ),
    }),
    /HTTP 200/,
  );
  await assert.rejects(
    acquireRedditOAuthListing({
      contract: contract(),
      target: TARGET,
      accessToken: ACCESS_TOKEN,
      userAgent: USER_AGENT,
      scheduledAtMs: 1_000,
      now: sequenceClock(2_000, 2_050),
      fetcher: fetcher(
        response(listing(), {
          headers: headers({ "content-type": "text/html" }),
        }),
      ),
    }),
    /unsupported media type/,
  );
  await assert.rejects(
    acquireRedditOAuthListing({
      contract: contract(),
      target: TARGET,
      accessToken: ACCESS_TOKEN,
      userAgent: USER_AGENT,
      scheduledAtMs: 1_000,
      now: sequenceClock(2_000, 2_050),
      fetcher: fetcher(
        response(listing(), {
          headers: headers({ "x-ratelimit-remaining": "1000.001" }),
        }),
      ),
    }),
    /free-access ceiling/,
  );
  await assert.rejects(
    acquireRedditOAuthListing({
      contract: contract(),
      target: TARGET,
      accessToken: ACCESS_TOKEN,
      userAgent: USER_AGENT,
      scheduledAtMs: 1_000,
      now: sequenceClock(2_000, 2_050, 2_075),
      fetcher: fetcher(response(JSON.stringify({ kind: "t3" }))),
    }),
    /not a Listing/,
  );
});
