import assert from "node:assert/strict";
import test from "node:test";
import {
  runScheduledKrakenLifecycleCapture,
  type KrakenLifecycleCaptureSink,
} from "../src/universe/krakenLifecycleCapture.ts";

const NOW = Date.UTC(2026, 6, 27);

function responseFor(url: URL): Response {
  return url.hostname === "status.kraken.com"
    ? new Response('{"items":[]}', {
        headers: { "Content-Type": "application/json" },
      })
    : new Response("<html></html>", {
        headers: { "Content-Type": "text/html" },
      });
}

test("retries a TimeoutError once before completing the daily capture set", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const sink: KrakenLifecycleCaptureSink = {
    async persistCaptures(captures): Promise<void> {
      assert.equal(captures.length, 4);
    },
  };
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    attempts += 1;
    if (attempts === 1) {
      throw new DOMException("timed out", "TimeoutError");
    }
    return responseFor(new URL(String(input)));
  }) as typeof fetch;

  const result = await runScheduledKrakenLifecycleCapture(sink, {
    scheduledAtMs: 0,
    nowMs: () => NOW,
    fetchImpl,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    retryDelayMs: 25,
    requestSpacingMs: 0,
  });

  assert.equal(result.requestCount, 5);
  assert.equal(result.captures.length, 4);
  assert.deepEqual(delays, [25]);
});
