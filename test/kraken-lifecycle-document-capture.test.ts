import assert from "node:assert/strict";
import test from "node:test";
import {
  captureKrakenLifecycleDiscoveredTarget,
  captureKrakenLifecycleDiscoveryBatch,
  type KrakenLifecycleDocumentCaptureSink,
} from "../src/universe/krakenLifecycleDocumentCapture.ts";
import type {
  KrakenLifecycleDiscoveredTarget,
  KrakenLifecycleDiscoveryResult,
} from "../src/universe/krakenLifecycleDiscovery.ts";

const SOURCE_CAPTURE = "1".repeat(64);
const SOURCE_PAYLOAD = "2".repeat(64);
const DISCOVERY = "3".repeat(64);
const NOW = Date.UTC(2026, 6, 28);

function target(
  sourceRef = "https://blog.kraken.com/product/asset-listings/example",
): KrakenLifecycleDiscoveredTarget {
  return {
    sourceKind: "asset-listing-document",
    sourceRef,
    discoveredFromCaptureId: SOURCE_CAPTURE,
    discoveredFromPayloadSha256: SOURCE_PAYLOAD,
  };
}

function response(body = "<html>example</html>", status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      ETag: '"document-v1"',
      "Last-Modified": "Tue, 28 Jul 2026 00:00:00 GMT",
    },
  });
}

function discovery(
  targets: readonly KrakenLifecycleDiscoveredTarget[],
): KrakenLifecycleDiscoveryResult {
  return {
    targets,
    assetListingDocuments: targets,
    assetListingIndexPages: [],
    supportLifecycleDocuments: [],
    discoverySha256: DISCOVERY,
  };
}

test("captures exact canonical HTML with discovery provenance", async () => {
  const first = await captureKrakenLifecycleDiscoveredTarget(
    target(),
    DISCOVERY,
    NOW,
    { fetchImpl: (async () => response()) as typeof fetch },
  );
  const second = await captureKrakenLifecycleDiscoveredTarget(
    target(),
    DISCOVERY,
    NOW,
    { fetchImpl: (async () => response()) as typeof fetch },
  );
  assert.equal(first.captureId, second.captureId);
  assert.equal(first.sourceRef, target().sourceRef);
  assert.equal(first.discoveredFromCaptureId, SOURCE_CAPTURE);
  assert.equal(first.discoveredFromPayloadSha256, SOURCE_PAYLOAD);
  assert.equal(first.discoverySha256, DISCOVERY);
  assert.equal(first.payloadText, "<html>example</html>");
  assert.match(first.payloadSha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.etag, '"document-v1"');
});

test("rejects noncanonical targets, redirects and non-HTML content", async () => {
  await assert.rejects(
    captureKrakenLifecycleDiscoveredTarget(
      target("https://evil.example/product/asset-listings/example"),
      DISCOVERY,
      NOW,
      { fetchImpl: (async () => response()) as typeof fetch },
    ),
    /not canonical/u,
  );
  await assert.rejects(
    captureKrakenLifecycleDiscoveredTarget(target(), DISCOVERY, NOW, {
      fetchImpl: (async () => {
        const result = response();
        Object.defineProperty(result, "url", {
          value: "https://blog.kraken.com/product/asset-listings/other",
        });
        return result;
      }) as typeof fetch,
    }),
    /redirected/u,
  );
  await assert.rejects(
    captureKrakenLifecycleDiscoveredTarget(target(), DISCOVERY, NOW, {
      fetchImpl: (async () =>
        new Response("{}", {
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
    }),
    /unsupported application\/json/u,
  );
});

test("captures a bounded deterministic batch and skips committed refs", async () => {
  const targets = [
    target("https://blog.kraken.com/product/asset-listings/c"),
    target("https://blog.kraken.com/product/asset-listings/a"),
    target("https://blog.kraken.com/product/asset-listings/b"),
  ];
  const persisted: string[][] = [];
  const sink: KrakenLifecycleDocumentCaptureSink = {
    async persistDocumentCaptures(captures): Promise<void> {
      persisted.push(captures.map((capture) => capture.sourceRef));
    },
  };
  const result = await captureKrakenLifecycleDiscoveryBatch(
    discovery(targets),
    sink,
    {
      alreadyCapturedSourceRefs: new Set([targets[1]?.sourceRef ?? ""]),
      maximumTargets: 1,
      nowMs: () => NOW,
      fetchImpl: (async () => response()) as typeof fetch,
      sleep: async () => undefined,
      requestSpacingMs: 0,
    },
  );
  assert.equal(result.selectedTargetCount, 1);
  assert.equal(result.remainingTargetCount, 1);
  assert.equal(result.requestCount, 1);
  assert.deepEqual(persisted, [
    ["https://blog.kraken.com/product/asset-listings/b"],
  ]);
});

test("retries transient failures but never commits an incomplete batch", async () => {
  let attempts = 0;
  let persisted = 0;
  const sink: KrakenLifecycleDocumentCaptureSink = {
    async persistDocumentCaptures(): Promise<void> {
      persisted += 1;
    },
  };
  const result = await captureKrakenLifecycleDiscoveryBatch(
    discovery([target()]),
    sink,
    {
      nowMs: () => NOW,
      fetchImpl: (async () => {
        attempts += 1;
        return attempts === 1 ? response("retry", 503) : response();
      }) as typeof fetch,
      sleep: async () => undefined,
      retryDelayMs: 1,
      requestSpacingMs: 0,
    },
  );
  assert.equal(result.requestCount, 2);
  assert.equal(persisted, 1);

  await assert.rejects(
    captureKrakenLifecycleDiscoveryBatch(
      discovery([
        target(),
        target("https://blog.kraken.com/product/asset-listings/second"),
      ]),
      sink,
      {
        nowMs: () => NOW,
        fetchImpl: (async (input: RequestInfo | URL) =>
          String(input).endsWith("/second") ? response("bad", 400) : response()) as
          typeof fetch,
        sleep: async () => undefined,
        requestSpacingMs: 0,
      },
    ),
    /returned HTTP 400/u,
  );
  assert.equal(persisted, 1);
});
