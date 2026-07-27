import assert from "node:assert/strict";
import test from "node:test";
import {
  captureExternalIntelligenceWebhook,
  pollExternalIntelligenceFeed,
} from "../src/intelligence/sourceAdapters.ts";
import {
  createExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContractInput,
} from "../src/intelligence/sourceRegistry.ts";

const SOURCE_REF = "https://feeds.example.com/alerts.xml";
const LICENCE_DIGEST = "a".repeat(64);

async function contract(
  overrides: Partial<ExternalIntelligenceSourceContractInput> = {},
): Promise<ExternalIntelligenceSourceContract> {
  return createExternalIntelligenceSourceContract({
    sourceId: "official-feed",
    contractVersion: 1,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: "exchange-example",
    providerId: "publisher-direct",
    sourceOrigin: "https://feeds.example.com/",
    allowedAcquisitionModes: ["minute-poll", "webhook"],
    contentPolicy: "digest-only",
    licenceRef: "https://feeds.example.com/terms",
    licenceSha256: LICENCE_DIGEST,
    attributionRequired: false,
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

function clock(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error("clock exhausted");
    index += 1;
    return value;
  };
}

test("polls an approved feed with exact payload identity and measured latency", async () => {
  const payload = "<rss><channel><item>halt</item></channel></rss>";
  const result = await pollExternalIntelligenceFeed(
    await contract(),
    {
      sourceId: "official-feed",
      sourceRef: SOURCE_REF,
      acquisitionMode: "minute-poll",
      acceptedContentTypes: ["application/rss+xml"],
    },
    {
      scheduledAtMs: 2_000,
      nowMs: clock([2_000, 2_025, 2_040]),
      fetchImpl: async (_input, init) => {
        assert.equal(
          new Headers(init?.headers).get("accept"),
          "application/rss+xml",
        );
        assert.equal(init?.redirect, "error");
        return new Response(payload, {
          status: 200,
          headers: {
            "content-type": "application/rss+xml; charset=utf-8",
            etag: '"v1"',
          },
        });
      },
    },
  );

  assert.equal(result.status, "payload");
  if (result.status !== "payload") return;
  assert.equal(result.attempts, 1);
  assert.equal(result.capture.responseLatencyMs, 25);
  assert.equal(result.capture.availabilityLatencyMs, 15);
  assert.equal(
    result.capture.payloadByteLength,
    new TextEncoder().encode(payload).byteLength,
  );
  assert.match(result.capture.payloadSha256, /^[0-9a-f]{64}$/u);
  assert.match(result.capture.captureId, /^[0-9a-f]{64}$/u);
  assert.equal(result.capture.payloadRetention, "transient-only");
  assert.equal(result.capture.modelTrainingAllowed, false);
});

test("supports conditional polling and preserves explicit not-modified timing", async () => {
  const result = await pollExternalIntelligenceFeed(
    await contract(),
    {
      sourceId: "official-feed",
      sourceRef: SOURCE_REF,
      acquisitionMode: "minute-poll",
      acceptedContentTypes: ["application/atom+xml"],
    },
    {
      scheduledAtMs: 3_000,
      cacheValidators: { etag: '"v1"', lastModified: null },
      nowMs: clock([3_000, 3_010, 3_012]),
      fetchImpl: async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("if-none-match"), '"v1"');
        return new Response(null, { status: 304 });
      },
    },
  );

  assert.equal(result.status, "not-modified");
  if (result.status !== "not-modified") return;
  assert.equal(result.etag, '"v1"');
  assert.equal(result.responseLatencyMs, 10);
  assert.equal(result.availabilityLatencyMs, 2);
});

test("obeys bounded Retry-After and records the successful attempt", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const result = await pollExternalIntelligenceFeed(
    await contract(),
    {
      sourceId: "official-feed",
      sourceRef: SOURCE_REF,
      acquisitionMode: "minute-poll",
      acceptedContentTypes: ["application/feed+json"],
    },
    {
      scheduledAtMs: 4_000,
      nowMs: clock([4_000, 4_005, 4_100, 4_115, 4_120]),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(null, {
            status: 429,
            headers: { "retry-after": "120" },
          });
        }
        return new Response('{"version":"https://jsonfeed.org/version/1.1"}', {
          status: 200,
          headers: { "content-type": "application/feed+json" },
        });
      },
    },
  );

  assert.equal(result.status, "payload");
  assert.equal(result.attempts, 2);
  assert.deepEqual(sleeps, [60_000]);
});

test("fails closed on unapproved origin, mode, Reddit and expired contracts", async () => {
  const target = {
    sourceId: "official-feed",
    sourceRef: SOURCE_REF,
    acquisitionMode: "minute-poll" as const,
    acceptedContentTypes: ["application/rss+xml"],
  };
  const options = {
    scheduledAtMs: 2_000,
    fetchImpl: async () =>
      new Response("x", {
        headers: { "content-type": "application/rss+xml" },
      }),
  };

  await assert.rejects(
    pollExternalIntelligenceFeed(
      await contract(),
      { ...target, sourceRef: "https://other.example/alerts.xml" },
      options,
    ),
    /outside the approved source origin/u,
  );
  await assert.rejects(
    pollExternalIntelligenceFeed(
      await contract({ allowedAcquisitionModes: ["webhook"] }),
      target,
      options,
    ),
    /does not permit/u,
  );
  await assert.rejects(
    pollExternalIntelligenceFeed(
      await contract({
        sourceKind: "reddit",
        authority: "social",
        attributionRequired: true,
        maximumRetentionMs: 60_000,
        deletionHandling: "required",
      }),
      target,
      options,
    ),
    /separate compliant OAuth collector/u,
  );
  await assert.rejects(
    pollExternalIntelligenceFeed(
      await contract({ expiresAtMs: 2_000 }),
      target,
      options,
    ),
    /not active/u,
  );
});

test("rejects redirects, unsupported content, oversized bodies and credential queries", async () => {
  const target = {
    sourceId: "official-feed",
    sourceRef: SOURCE_REF,
    acquisitionMode: "minute-poll" as const,
    acceptedContentTypes: ["application/rss+xml"],
  };
  await assert.rejects(
    pollExternalIntelligenceFeed(await contract(), target, {
      scheduledAtMs: 2_000,
      nowMs: clock([2_000, 2_001]),
      fetchImpl: async () => {
        const response = new Response("x", {
          headers: { "content-type": "application/rss+xml" },
        });
        Object.defineProperty(response, "url", {
          value: "https://other.example/feed",
        });
        return response;
      },
    }),
    /redirected/u,
  );
  await assert.rejects(
    pollExternalIntelligenceFeed(await contract(), target, {
      scheduledAtMs: 2_000,
      nowMs: clock([2_000, 2_001]),
      fetchImpl: async () =>
        new Response("x", { headers: { "content-type": "text/html" } }),
    }),
    /unsupported/u,
  );
  await assert.rejects(
    pollExternalIntelligenceFeed(await contract(), target, {
      scheduledAtMs: 2_000,
      nowMs: clock([2_000, 2_001]),
      fetchImpl: async () =>
        new Response("x", {
          headers: {
            "content-type": "application/rss+xml",
            "content-length": "1048577",
          },
        }),
    }),
    /Content-Length is outside bounds/u,
  );
  await assert.rejects(
    pollExternalIntelligenceFeed(
      await contract(),
      { ...target, sourceRef: `${SOURCE_REF}?api_key=secret` },
      optionsForRejectedBeforeFetch(),
    ),
    /must not contain credentials/u,
  );
});

function optionsForRejectedBeforeFetch() {
  return {
    scheduledAtMs: 2_000,
    fetchImpl: async () => {
      throw new Error("fetch must not run");
    },
  };
}

test("keeps timeout active through a stalled streamed body", async () => {
  let calls = 0;
  await assert.rejects(
    pollExternalIntelligenceFeed(
      await contract(),
      {
        sourceId: "official-feed",
        sourceRef: SOURCE_REF,
        acquisitionMode: "minute-poll",
        acceptedContentTypes: ["application/rss+xml"],
      },
      {
        scheduledAtMs: 2_000,
        timeoutMs: 5,
        retryDelayMs: 1,
        sleep: async () => undefined,
        fetchImpl: async () => {
          calls += 1;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull() {
                return new Promise<void>(() => undefined);
              },
            }),
            { headers: { "content-type": "application/rss+xml" } },
          );
        },
      },
    ),
    /timed out/u,
  );
  assert.equal(calls, 2);
});

test("captures only authenticated webhooks and measures availability delay", async () => {
  const request = new Request("https://bot.example/webhooks/official-feed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": "valid",
    },
    body: '{"event":"trading-halt"}',
  });
  const capture = await captureExternalIntelligenceWebhook(
    await contract(),
    {
      sourceId: "official-feed",
      sourceRef: SOURCE_REF,
      acceptedContentTypes: ["application/json"],
    },
    request,
    {
      receivedAtMs: 5_000,
      nowMs: () => 5_020,
      verifySignature: ({ body, headers }) =>
        headers.get("x-signature") === "valid" && body.byteLength > 0,
    },
  );

  assert.equal(capture.acquisitionMode, "webhook");
  assert.equal(capture.responseLatencyMs, 0);
  assert.equal(capture.availabilityLatencyMs, 20);
  assert.match(capture.payloadSha256, /^[0-9a-f]{64}$/u);

  await assert.rejects(
    captureExternalIntelligenceWebhook(
      await contract(),
      {
        sourceId: "official-feed",
        sourceRef: SOURCE_REF,
        acceptedContentTypes: ["application/json"],
      },
      new Request("https://bot.example/webhooks/official-feed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      {
        receivedAtMs: 5_000,
        verifySignature: () => false,
      },
    ),
    /signature is invalid/u,
  );
});
