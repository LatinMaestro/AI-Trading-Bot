import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareKrakenLifecycleEvidence,
  type KrakenOfficialLifecycleDocument,
} from "../src/universe/krakenLifecycle.ts";

const DAY = 86_400_000;
const RECORDED = Date.UTC(2026, 6, 27);
const digest = (value: string) => value.repeat(64).slice(0, 64);

function documents(): KrakenOfficialLifecycleDocument[] {
  return [
    {
      documentId: "listing-btc",
      sourceClass: "asset-listing",
      sourceRef:
        "https://blog.kraken.com/product/asset-listings/btc-is-available-for-trading",
      publishedAtMs: RECORDED - 30 * DAY,
      fetchedAtMs: RECORDED - 29 * DAY,
      payloadSha256: digest("a"),
      declarations: [
        {
          canonicalPair: "BTC/AUD",
          eventType: "listed",
          effectiveAtMs: RECORDED - 30 * DAY,
          scope: "global",
        },
        {
          canonicalPair: "BTC/AUD",
          eventType: "trading-online",
          effectiveAtMs: RECORDED - 30 * DAY,
          scope: "global",
        },
      ],
    },
    {
      documentId: "au-btc",
      sourceClass: "regional-availability",
      sourceRef: "https://support.kraken.com/articles/btc-australia-availability",
      publishedAtMs: RECORDED - 20 * DAY,
      fetchedAtMs: RECORDED - 19 * DAY,
      payloadSha256: digest("b"),
      declarations: [
        {
          canonicalPair: "BTC/AUD",
          eventType: "au-enabled",
          effectiveAtMs: RECORDED - 20 * DAY,
          scope: "AU",
        },
      ],
    },
  ];
}

test("prepares deterministic official evidence with complete AU coverage", async () => {
  const first = await prepareKrakenLifecycleEvidence(
    ["BTC/AUD"],
    documents(),
    RECORDED,
  );
  const second = await prepareKrakenLifecycleEvidence(
    ["BTC/AUD"],
    [...documents()].reverse(),
    RECORDED,
  );
  assert.equal(first.evidenceSha256, second.evidenceSha256);
  assert.equal(first.announcements.length, 3);
  assert.deepEqual(first.coverage, [
    {
      canonicalPair: "BTC/AUD",
      complete: true,
      currentlyListed: true,
      currentlyOnline: true,
      currentlyAvailableInAustralia: true,
      missingEvidence: [],
    },
  ]);
  assert.ok(
    first.announcements.every(
      (item) =>
        item.source.sourceKind === "official-lifecycle-announcement",
    ),
  );
});

test("accepts a published future delisting without applying it early", async () => {
  const futureDelisting: KrakenOfficialLifecycleDocument = {
    documentId: "future-btc-delisting",
    sourceClass: "delisting-notice",
    sourceRef: "https://support.kraken.com/articles/btc-delisting-notice",
    publishedAtMs: RECORDED - DAY,
    fetchedAtMs: RECORDED,
    payloadSha256: digest("c"),
    declarations: [
      {
        canonicalPair: "BTC/AUD",
        eventType: "delisted",
        effectiveAtMs: RECORDED + 7 * DAY,
        scope: "global",
      },
    ],
  };
  const prepared = await prepareKrakenLifecycleEvidence(
    ["BTC/AUD"],
    [...documents(), futureDelisting],
    RECORDED,
  );
  assert.equal(prepared.coverage[0]?.currentlyListed, true);
  assert.equal(prepared.coverage[0]?.currentlyOnline, true);
});

test("rejects unofficial origins, wrong paths and incompatible scopes", async () => {
  const baseline = documents()[0];
  if (baseline === undefined) throw new Error("Missing document fixture");
  await assert.rejects(
    prepareKrakenLifecycleEvidence(
      ["BTC/AUD"],
      [{ ...baseline, sourceRef: "https://example.com/product/asset-listings/btc" }],
      RECORDED,
    ),
    /not official/,
  );
  await assert.rejects(
    prepareKrakenLifecycleEvidence(
      ["BTC/AUD"],
      [{
        ...baseline,
        declarations: [{
          canonicalPair: "BTC/AUD",
          eventType: "au-enabled",
          effectiveAtMs: RECORDED,
          scope: "global",
        }],
      }],
      RECORDED,
    ),
    /cannot declare|incompatible geographic scope/,
  );
});

test("reports missing evidence classes without inventing lifecycle state", async () => {
  const listing = documents()[0];
  if (listing === undefined) throw new Error("Missing document fixture");
  const prepared = await prepareKrakenLifecycleEvidence(
    ["BTC/AUD", "ETH/AUD"],
    [listing],
    RECORDED,
  );
  assert.deepEqual(
    prepared.coverage.find((item) => item.canonicalPair === "ETH/AUD")
      ?.missingEvidence,
    [
      "listing-history",
      "trading-history",
      "australian-availability-history",
    ],
  );
  assert.equal(
    prepared.coverage.find((item) => item.canonicalPair === "ETH/AUD")
      ?.complete,
    false,
  );
});

test("rejects conflicting simultaneous lifecycle declarations", async () => {
  const conflict: KrakenOfficialLifecycleDocument = {
    documentId: "btc-status",
    sourceClass: "status-incident",
    sourceRef: "https://status.kraken.com/api/v2/incidents/btc.json",
    publishedAtMs: RECORDED - DAY,
    fetchedAtMs: RECORDED,
    payloadSha256: digest("d"),
    declarations: [
      {
        canonicalPair: "BTC/AUD",
        eventType: "trading-suspended",
        effectiveAtMs: RECORDED,
        scope: "global",
      },
      {
        canonicalPair: "BTC/AUD",
        eventType: "trading-resumed",
        effectiveAtMs: RECORDED,
        scope: "global",
      },
    ],
  };
  await assert.rejects(
    prepareKrakenLifecycleEvidence(["BTC/AUD"], [conflict], RECORDED),
    /Conflicting lifecycle declarations/,
  );
});


test("rejects declarations outside the audited expected-pair set", async () => {
  const unexpected = documents()[0];
  if (unexpected === undefined) throw new Error("Missing document fixture");
  await assert.rejects(
    prepareKrakenLifecycleEvidence(
      ["ETH/AUD"],
      [unexpected],
      RECORDED,
    ),
    /Unexpected lifecycle pair BTC\/AUD/,
  );
});
