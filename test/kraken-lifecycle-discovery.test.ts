import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverKrakenLifecycleDocumentTargets,
  type KrakenLifecycleDiscoveredTargetKind,
} from "../src/universe/krakenLifecycleDiscovery.ts";
import type {
  KrakenLifecycleCaptureSourceKind,
  KrakenLifecycleSourceCapture,
} from "../src/universe/krakenLifecycleCapture.ts";

const CAPTURE_ID = "1".repeat(64);
async function payloadSha256(payloadText: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payloadText),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function capture(
  sourceKind: KrakenLifecycleCaptureSourceKind,
  sourceRef: string,
  payloadText: string,
  suffix: string,
): Promise<KrakenLifecycleSourceCapture> {
  return {
    captureId: `${CAPTURE_ID.slice(0, -1)}${suffix}`,
    sourceKind,
    sourceRef,
    fetchedAtMs: Date.UTC(2026, 6, 27),
    payloadSha256: await payloadSha256(payloadText),
    payloadByteLength: new TextEncoder().encode(payloadText).byteLength,
    payloadText,
    contentType: "text/html",
    etag: null,
    lastModified: null,
  };
}

function kinds(
  targets: readonly { readonly sourceKind: KrakenLifecycleDiscoveredTargetKind }[],
): readonly KrakenLifecycleDiscoveredTargetKind[] {
  return targets.map((target) => target.sourceKind);
}

test("discovers canonical listing pages and lifecycle documents from preserved indexes", async () => {
  const listingHtml = `
    <a href="/product/asset-listings/sn62-is-available-for-trading">SN62</a>
    <a href='https://blog.kraken.com/product/asset-listings/cspr-is-available-for-trading/'>CSPR</a>
    <a href="/category/product/asset-listings/page/2/">2</a>
    <a href="https://blog.kraken.com/category/product/asset-listings/page/45">45</a>
    <a href="/product/asset-listings/sn62-is-available-for-trading">duplicate</a>
  `;
  const delistingHtml = `
    <a href="/articles/snapx-delisting">SNAPX</a>
    <a href='https://support.kraken.com/articles/notice-of-asset-delistings-in-india'>India</a>
  `;
  const result = await discoverKrakenLifecycleDocumentTargets([
    await capture(
      "asset-listings-index",
      "https://blog.kraken.com/category/product/asset-listings",
      listingHtml,
      "1",
    ),
    await capture(
      "delistings-index",
      "https://support.kraken.com/sections/delistings",
      delistingHtml,
      "2",
    ),
  ]);

  assert.equal(result.targets.length, 6);
  assert.equal(result.assetListingDocuments.length, 2);
  assert.equal(result.assetListingIndexPages.length, 2);
  assert.equal(result.supportLifecycleDocuments.length, 2);
  assert.deepEqual(kinds(result.targets), [
    "asset-listing-document",
    "asset-listing-document",
    "asset-listings-index-page",
    "asset-listings-index-page",
    "support-lifecycle-document",
    "support-lifecycle-document",
  ]);
  assert.deepEqual(
    result.assetListingDocuments.map((target) => target.sourceRef),
    [
      "https://blog.kraken.com/product/asset-listings/cspr-is-available-for-trading",
      "https://blog.kraken.com/product/asset-listings/sn62-is-available-for-trading",
    ],
  );
  assert.match(result.discoverySha256, /^[0-9a-f]{64}$/);
});

test("ignores unrelated, ambiguous and noncanonical links", async () => {
  const listingHtml = `
    <a href="https://evil.example/product/asset-listings/fake">external</a>
    <a href="http://blog.kraken.com/product/asset-listings/http">http</a>
    <a href="/product/asset-listings/has_query?x=1">query</a>
    <a href="/product/asset-listings/has#fragment">fragment</a>
    <a href="/category/product/asset-listings/page/1">page one</a>
    <a href="/category/product/asset-listings/page/501">too deep</a>
    <a href="/not-a-listing/article">other</a>
    <a href="https://support.kraken.com/articles/cross-index">cross index</a>
  `;
  const delistingHtml = `
    <a href="/sections/delistings">section</a>
    <a href="/articles/valid-support-lifecycle-document">valid</a>
    <a href="/articles/bad%2Fsegment">encoded</a>
    <a href="https://support.kraken.com/articles/query?x=1">query</a>
    <a href="https://blog.kraken.com/product/asset-listings/cross-index">cross index</a>
  `;
  const result = await discoverKrakenLifecycleDocumentTargets([
    await capture(
      "asset-listings-index",
      "https://blog.kraken.com/category/product/asset-listings",
      listingHtml,
      "1",
    ),
    await capture(
      "delistings-index",
      "https://support.kraken.com/sections/delistings",
      delistingHtml,
      "2",
    ),
  ]);

  assert.deepEqual(
    result.targets.map((target) => target.sourceRef),
    ["https://support.kraken.com/articles/valid-support-lifecycle-document"],
  );
  assert.equal(result.targets[0]?.sourceKind, "support-lifecycle-document");
});

test("is deterministic across capture ordering and does not semantically classify support titles", async () => {
  const listing = await capture(
    "asset-listings-index",
    "https://blog.kraken.com/category/product/asset-listings",
    `<a href="/product/asset-listings/example-is-available-for-trading">regional notice words are irrelevant</a>`,
    "1",
  );
  const delisting = await capture(
    "delistings-index",
    "https://support.kraken.com/sections/delistings",
    `<a href="/articles/australia-availability-example">Global delisting words are irrelevant</a>`,
    "2",
  );
  const first = await discoverKrakenLifecycleDocumentTargets([
    listing,
    delisting,
  ]);
  const second = await discoverKrakenLifecycleDocumentTargets([
    delisting,
    listing,
  ]);

  assert.equal(first.discoverySha256, second.discoverySha256);
  assert.deepEqual(first.targets, second.targets);
  assert.equal(
    first.supportLifecycleDocuments[0]?.sourceKind,
    "support-lifecycle-document",
  );
});

test("fails closed on missing, duplicate or malformed index captures", async () => {
  const listing = await capture(
    "asset-listings-index",
    "https://blog.kraken.com/category/product/asset-listings",
    `<a href="/product/asset-listings/example">example</a>`,
    "1",
  );
  const delisting = await capture(
    "delistings-index",
    "https://support.kraken.com/sections/delistings",
    `<a href="/articles/example">example</a>`,
    "2",
  );
  await assert.rejects(
    discoverKrakenLifecycleDocumentTargets([listing]),
    /bounded capture set/,
  );
  await assert.rejects(
    discoverKrakenLifecycleDocumentTargets([listing, listing, delisting]),
    /exactly one asset-listings-index/,
  );
  await assert.rejects(
    discoverKrakenLifecycleDocumentTargets([
      { ...listing, payloadByteLength: 1 },
      delisting,
    ]),
    /not canonical/,
  );
  await assert.rejects(
    discoverKrakenLifecycleDocumentTargets([
      { ...listing, payloadSha256: "f".repeat(64) },
      delisting,
    ]),
    /payload digest does not match/,
  );
});

test("bounds hostile index link volume", async () => {
  const repeated = `<a href="/product/asset-listings/example">x</a>`.repeat(
    5_001,
  );
  await assert.rejects(
    discoverKrakenLifecycleDocumentTargets([
      await capture(
        "asset-listings-index",
        "https://blog.kraken.com/category/product/asset-listings",
        repeated,
        "1",
      ),
      await capture(
        "delistings-index",
        "https://support.kraken.com/sections/delistings",
        `<a href="/articles/example">example</a>`,
        "2",
      ),
    ]),
    /too many link attributes/,
  );
});
