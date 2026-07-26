import assert from "node:assert/strict";
import test from "node:test";
import {
  captureKrakenLifecycleSources,
  type KrakenLifecycleCaptureTarget,
} from "../src/universe/krakenLifecycleCapture.ts";

const LISTING =
  "https://blog.kraken.com/product/asset-listings/test-is-available-for-trading";
const DELISTING =
  "https://support.kraken.com/articles/notice-of-test-delisting";
const STATUS = "https://status.kraken.com/api/v2/incidents.json";

function responseFor(url: string, suffix = ""): Response {
  return new Response(`<html>${url}${suffix}</html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ETag: `\"${url.length}${suffix}\"`,
      "Last-Modified": "Mon, 27 Jul 2026 00:00:00 GMT",
    },
  });
}

const targets: readonly KrakenLifecycleCaptureTarget[] = [
  { sourceClass: "delisting-notice", sourceRef: DELISTING },
  { sourceClass: "asset-listing", sourceRef: LISTING },
  { sourceClass: "status-incident", sourceRef: STATUS },
];

test("captures official sources deterministically without credentials", async () => {
  const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const fetcher = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input.toString();
    requests.push({ url, init });
    return responseFor(url);
  };
  const first = await captureKrakenLifecycleSources(targets, {
    fetchImpl: fetcher,
    clock: () => 1_000,
    maximumConcurrentRequests: 2,
  });
  const second = await captureKrakenLifecycleSources([...targets].reverse(), {
    fetchImpl: fetcher,
    clock: () => 1_000,
    maximumConcurrentRequests: 2,
  });

  assert.equal(first.runSha256, second.runSha256);
  assert.equal(first.documents.length, 3);
  assert.deepEqual(
    first.documents.map((document) => document.sourceRef),
    [LISTING, DELISTING, STATUS].sort(),
  );
  assert.ok(
    first.documents.every((document) =>
      /^[0-9a-f]{64}$/.test(document.payloadSha256),
    ),
  );
  assert.ok(
    requests.every(
      (request) =>
        request.init?.credentials === "omit" &&
        request.init.redirect === "error" &&
        !(request.init.headers as Record<string, string> | undefined)?.Authorization,
    ),
  );
});

test("enforces bounded request concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return responseFor(input.toString());
  };
  await captureKrakenLifecycleSources(targets, {
    fetchImpl: fetcher,
    clock: () => 2_000,
    maximumConcurrentRequests: 2,
  });
  assert.equal(maximumActive, 2);
});

test("rejects unofficial, duplicate and non-canonical targets", async () => {
  const fetcher = async (): Promise<Response> => responseFor(LISTING);
  await assert.rejects(
    captureKrakenLifecycleSources(
      [{ sourceClass: "asset-listing", sourceRef: "https://example.com/test" }],
      { fetchImpl: fetcher },
    ),
    /not official/,
  );
  await assert.rejects(
    captureKrakenLifecycleSources(
      [targets[0]!, targets[0]!],
      { fetchImpl: fetcher },
    ),
    /Duplicate lifecycle target/,
  );
  await assert.rejects(
    captureKrakenLifecycleSources(
      [
        {
          sourceClass: "delisting-notice",
          sourceRef: `${DELISTING}?tracking=1`,
        },
      ],
      { fetchImpl: fetcher },
    ),
    /canonical HTTPS/,
  );
});

test("rejects HTTP, content-type, UTF-8 and size failures", async () => {
  const target = [targets[0]!];
  await assert.rejects(
    captureKrakenLifecycleSources(target, {
      fetchImpl: async () => new Response("no", { status: 503 }),
    }),
    /HTTP 503/,
  );
  await assert.rejects(
    captureKrakenLifecycleSources(target, {
      fetchImpl: async () =>
        new Response("binary", {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
    }),
    /unsupported Content-Type/,
  );
  await assert.rejects(
    captureKrakenLifecycleSources(target, {
      fetchImpl: async () =>
        new Response(Uint8Array.from([0xff, 0xfe]), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    }),
    /valid UTF-8/,
  );
  await assert.rejects(
    captureKrakenLifecycleSources(target, {
      fetchImpl: async () => responseFor(DELISTING, "x".repeat(100)),
      maximumResponseBytes: 20,
    }),
    /1 to 20 bytes/,
  );
});

test("rejects total-size and chronology failures", async () => {
  await assert.rejects(
    captureKrakenLifecycleSources(targets.slice(0, 2), {
      fetchImpl: async (input) => responseFor(input.toString(), "x".repeat(50)),
      clock: () => 3_000,
      maximumTotalBytes: 80,
    }),
    /exceeded 80 total bytes/,
  );

  const times = [5_000, 4_000];
  await assert.rejects(
    captureKrakenLifecycleSources([targets[0]!], {
      fetchImpl: async () => responseFor(DELISTING),
      clock: () => times.shift() ?? 0,
    }),
    /recordedAtMs precedes/,
  );
});
