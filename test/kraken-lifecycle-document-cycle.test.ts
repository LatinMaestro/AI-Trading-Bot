import assert from "node:assert/strict";
import test from "node:test";
import type {
  KrakenLifecycleSourceCapture,
  ScheduledKrakenLifecycleCaptureResult,
} from "../src/universe/krakenLifecycleCapture.ts";
import type { KrakenLifecycleDocumentCapture } from "../src/universe/krakenLifecycleDocumentCapture.ts";
import {
  runScheduledKrakenLifecycleDocumentCycle,
  type KrakenLifecycleDocumentCycleRepository,
} from "../src/universe/krakenLifecycleDocumentCycle.ts";
import type { KrakenLifecycleListingIndexPageCapture } from "../src/universe/krakenLifecycleDiscovery.ts";
import { sha256Hex } from "../src/utils/crypto.ts";

async function sourceCapture(
  sourceKind: "asset-listings-index" | "delistings-index",
  sourceRef: string,
  payloadText: string,
  seed: string,
): Promise<KrakenLifecycleSourceCapture> {
  return {
    captureId: seed.repeat(64),
    sourceKind,
    sourceRef,
    fetchedAtMs: 1,
    payloadSha256: await sha256Hex(payloadText),
    payloadByteLength: new TextEncoder().encode(payloadText).byteLength,
    payloadText,
    contentType: "text/html",
    etag: null,
    lastModified: null,
  };
}

class FakeRepository
  implements KrakenLifecycleDocumentCycleRepository {
  readonly persisted: KrakenLifecycleDocumentCapture[][] = [];
  readonly rotationStarts: number[] = [];
  private readonly pages: readonly KrakenLifecycleListingIndexPageCapture[];
  private readonly refs: ReadonlySet<string>;

  constructor(
    pages: readonly KrakenLifecycleListingIndexPageCapture[],
    refs: ReadonlySet<string>,
  ) {
    this.pages = pages;
    this.refs = refs;
  }

  async loadCommittedSourceRefs(): Promise<ReadonlySet<string>> {
    return this.refs;
  }

  async loadLatestCommittedListingIndexPages(
    rotationStartPage: number,
  ): Promise<
    readonly KrakenLifecycleListingIndexPageCapture[]
  > {
    this.rotationStarts.push(rotationStartPage);
    return this.pages;
  }

  async persistDocumentCaptures(
    captures: readonly KrakenLifecycleDocumentCapture[],
  ): Promise<void> {
    this.persisted.push([...captures]);
  }
}

test("does no recursive work outside the daily source-capture window", async () => {
  const repository = new FakeRepository([], new Set());
  const result = await runScheduledKrakenLifecycleDocumentCycle(
    { due: false, captures: [], requestCount: 0 },
    repository,
    { scheduledAtMs: 0 },
  );
  assert.equal(result.due, false);
  assert.equal(result.requestCount, 0);
  assert.deepEqual(repository.persisted, []);
});

test("advances a bounded frontier from committed listing index pages", async () => {
  const rootListings =
    '<a href="/category/product/asset-listings/page/2">page 2</a>';
  const rootDelistings =
    '<a href="/articles/delisting-notice">notice</a>';
  const sourceResult: ScheduledKrakenLifecycleCaptureResult = {
    due: true,
    captures: [
      await sourceCapture(
        "asset-listings-index",
        "https://blog.kraken.com/category/product/asset-listings",
        rootListings,
        "1",
      ),
      await sourceCapture(
        "delistings-index",
        "https://support.kraken.com/sections/delistings",
        rootDelistings,
        "2",
      ),
    ],
    requestCount: 2,
  };
  const pageText =
    '<a href="/product/asset-listings/older-asset">older</a>' +
    '<a href="/category/product/asset-listings/page/3">page 3</a>';
  const page: KrakenLifecycleListingIndexPageCapture = {
    captureId: "3".repeat(64),
    sourceKind: "asset-listings-index-page",
    sourceRef:
      "https://blog.kraken.com/category/product/asset-listings/page/2",
    payloadSha256: await sha256Hex(pageText),
    payloadByteLength: new TextEncoder().encode(pageText).byteLength,
    payloadText: pageText,
    contentType: "text/html",
  };
  const requests: string[] = [];
  const repository = new FakeRepository(
    [page],
    new Set([page.sourceRef]),
  );
  let now = 10;
  const result = await runScheduledKrakenLifecycleDocumentCycle(
    sourceResult,
    repository,
    {
      scheduledAtMs: 0,
      maximumTargets: 2,
      nowMs: () => {
        now += 1;
        return now;
      },
      fetchImpl: (async (input: RequestInfo | URL): Promise<Response> => {
        requests.push(String(input));
        return new Response("<html>captured</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }) as typeof fetch,
      sleep: async () => undefined,
      requestSpacingMs: 0,
    },
  );
  assert.equal(result.due, true);
  assert.equal(result.committedListingIndexPageCount, 1);
  assert.equal(result.discoveredTargetCount, 4);
  assert.equal(result.selectedTargetCount, 2);
  assert.equal(result.remainingTargetCount, 1);
  assert.equal(result.requestCount, 2);
  assert.deepEqual(requests, [
    "https://blog.kraken.com/product/asset-listings/older-asset",
    "https://blog.kraken.com/category/product/asset-listings/page/3",
  ]);
  assert.equal(result.captures[0]?.discoveredFromCaptureId, page.captureId);
  assert.equal(result.captures[1]?.discoveredFromCaptureId, page.captureId);
  assert.equal(repository.persisted.length, 1);
  assert.deepEqual(repository.rotationStarts, [2]);
});


test("recursive listing pages ignore links in comments and raw-text elements", async () => {
  const rootListings = '<a href="/category/product/asset-listings/page/2">page 2</a>';
  const rootDelistings = "<html>none</html>";
  const sourceResult: ScheduledKrakenLifecycleCaptureResult = {
    due: true,
    captures: [
      await sourceCapture(
        "asset-listings-index",
        "https://blog.kraken.com/category/product/asset-listings",
        rootListings,
        "4",
      ),
      await sourceCapture(
        "delistings-index",
        "https://support.kraken.com/sections/delistings",
        rootDelistings,
        "5",
      ),
    ],
    requestCount: 2,
  };
  const pageText =
    '<!-- <a href="/product/asset-listings/comment-fake">fake</a> -->' +
    '<script>"<a href="/product/asset-listings/script-fake">"</script>' +
    '<a href="/product/asset-listings/real">real</a>';
  const page: KrakenLifecycleListingIndexPageCapture = {
    captureId: "6".repeat(64),
    sourceKind: "asset-listings-index-page",
    sourceRef:
      "https://blog.kraken.com/category/product/asset-listings/page/2",
    payloadSha256: await sha256Hex(pageText),
    payloadByteLength: new TextEncoder().encode(pageText).byteLength,
    payloadText: pageText,
    contentType: "text/html",
  };
  const requests: string[] = [];
  const repository = new FakeRepository([page], new Set([page.sourceRef]));
  const result = await runScheduledKrakenLifecycleDocumentCycle(
    sourceResult,
    repository,
    {
      scheduledAtMs: 0,
      maximumTargets: 1,
      nowMs: () => 10,
      fetchImpl: (async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response("<html>captured</html>", {
          headers: { "Content-Type": "text/html" },
        });
      }) as typeof fetch,
      sleep: async () => undefined,
      requestSpacingMs: 0,
    },
  );
  assert.equal(result.selectedTargetCount, 1);
  assert.deepEqual(requests, [
    "https://blog.kraken.com/product/asset-listings/real",
  ]);
});


test("rejects repository page windows above the orchestration resource bound", async () => {
  const listings = await sourceCapture(
    "asset-listings-index",
    "https://blog.kraken.com/category/product/asset-listings",
    "<html>root</html>",
    "7",
  );
  const delistings = await sourceCapture(
    "delistings-index",
    "https://support.kraken.com/sections/delistings",
    "<html>root</html>",
    "8",
  );
  const payloadText = "x";
  const payloadSha256 = await sha256Hex(payloadText);
  const pages = Array.from(
    { length: 9 },
    (_, index): KrakenLifecycleListingIndexPageCapture => ({
      captureId: (index + 1).toString(16).repeat(64),
      sourceKind: "asset-listings-index-page",
      sourceRef:
        `https://blog.kraken.com/category/product/asset-listings/page/${index + 2}`,
      payloadSha256,
      payloadByteLength: 1_048_576,
      payloadText,
      contentType: "text/html",
    }),
  );
  const repository = new FakeRepository(pages, new Set());
  await assert.rejects(
    runScheduledKrakenLifecycleDocumentCycle(
      { due: true, captures: [listings, delistings], requestCount: 2 },
      repository,
      { scheduledAtMs: 0 },
    ),
    /page window exceeds resource bounds/u,
  );
  assert.deepEqual(repository.persisted, []);
});
