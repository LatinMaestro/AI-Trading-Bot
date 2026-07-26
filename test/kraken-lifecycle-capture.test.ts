import assert from "node:assert/strict";
import test from "node:test";
import {
  KRAKEN_LIFECYCLE_CAPTURE_TARGETS,
  captureKrakenLifecycleTarget,
  isKrakenLifecycleCaptureDue,
  runScheduledKrakenLifecycleCapture,
  type KrakenLifecycleCaptureSink,
  type KrakenLifecycleSourceCapture,
} from "../src/universe/krakenLifecycleCapture.ts";

const FETCHED_AT = Date.UTC(2026, 6, 27);

function response(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      ETag: '"capture-v1"',
      "Last-Modified": "Mon, 27 Jul 2026 00:00:00 GMT",
    },
  });
}

function sourceResponse(url: URL, status = 200): Response {
  if (url.hostname === "status.kraken.com") {
    return response(
      JSON.stringify({ page: { id: "kraken" }, items: [] }),
      "application/json; charset=utf-8",
      status,
    );
  }
  return response(
    `<html><body>${url.pathname}</body></html>`,
    "text/html; charset=UTF-8",
    status,
  );
}

test("captures exact UTF-8 payloads as deterministic content-addressed chunks", async () => {
  const body = `start-${"é".repeat(20_000)}-end`;
  const target = KRAKEN_LIFECYCLE_CAPTURE_TARGETS[0];
  if (target === undefined) throw new Error("Missing capture target");
  const fetchImpl = (async () => response(body, "text/html; charset=utf-8")) as typeof fetch;
  const first = await captureKrakenLifecycleTarget(target, FETCHED_AT, {
    fetchImpl,
    timeoutMs: 1_000,
  });
  const second = await captureKrakenLifecycleTarget(target, FETCHED_AT, {
    fetchImpl,
    timeoutMs: 1_000,
  });

  assert.equal(first.captureId, second.captureId);
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.ok(first.chunks.length > 1);
  assert.equal(first.chunks.map((chunk) => chunk.text).join(""), body);
  assert.equal(
    first.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    new TextEncoder().encode(body).byteLength,
  );
  assert.ok(first.chunks.every((chunk) => chunk.byteLength <= 32_768));
  assert.equal(first.contentType, "text/html");
  assert.equal(first.etag, '"capture-v1"');
});

test("runs the four allowlisted source captures only at the daily UTC slot", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    requests.push(url.toString());
    return sourceResponse(url);
  }) as typeof fetch;
  let persisted: readonly KrakenLifecycleSourceCapture[] | undefined;
  let committedAt: number | undefined;
  const sink: KrakenLifecycleCaptureSink = {
    async persistCaptures(captures, committedAtMs): Promise<void> {
      persisted = captures;
      committedAt = committedAtMs;
    },
  };

  const skipped = await runScheduledKrakenLifecycleCapture(sink, {
    scheduledAtMs: 900_000,
    nowMs: () => FETCHED_AT,
    fetchImpl,
    requestSpacingMs: 0,
  });
  assert.equal(skipped.due, false);
  assert.equal(skipped.requestCount, 0);
  assert.equal(requests.length, 0);

  const captured = await runScheduledKrakenLifecycleCapture(sink, {
    scheduledAtMs: 0,
    nowMs: () => FETCHED_AT,
    fetchImpl,
    sleep: async () => undefined,
    requestSpacingMs: 0,
  });
  assert.equal(captured.due, true);
  assert.equal(captured.requestCount, 4);
  assert.equal(requests.length, 4);
  assert.equal(persisted?.length, 4);
  assert.equal(committedAt, FETCHED_AT);
  assert.deepEqual(
    captured.captures.map((capture) => capture.sourceKind),
    KRAKEN_LIFECYCLE_CAPTURE_TARGETS.map((target) => target.sourceKind),
  );
});

test("retries bounded transient HTTP failures and rejects incompatible payloads", async () => {
  const target = KRAKEN_LIFECYCLE_CAPTURE_TARGETS[2];
  if (target === undefined) throw new Error("Missing status capture target");
  let attempts = 0;
  const delays: number[] = [];
  const sink: KrakenLifecycleCaptureSink = {
    async persistCaptures(): Promise<void> {
      return undefined;
    },
  };
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    attempts += 1;
    const url = new URL(String(input));
    if (attempts === 1) return sourceResponse(url, 429);
    return sourceResponse(url);
  }) as typeof fetch;

  const result = await runScheduledKrakenLifecycleCapture(sink, {
    scheduledAtMs: 0,
    nowMs: () => FETCHED_AT,
    fetchImpl,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    retryDelayMs: 25,
    requestSpacingMs: 0,
  });
  assert.equal(result.requestCount, 5);
  assert.deepEqual(delays, [25]);

  await assert.rejects(
    captureKrakenLifecycleTarget(target, FETCHED_AT, {
      fetchImpl: (async () => response("<html></html>", "text/html")) as typeof fetch,
    }),
    /unsupported text\/html/,
  );
});

test("validates the deterministic daily schedule boundary", () => {
  assert.equal(isKrakenLifecycleCaptureDue(0), true);
  assert.equal(isKrakenLifecycleCaptureDue(86_400_000), true);
  assert.equal(isKrakenLifecycleCaptureDue(86_400_000 - 900_000), false);
  assert.throws(() => isKrakenLifecycleCaptureDue(-1), /non-negative/);
});