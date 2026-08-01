import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalIntelligenceItem,
  IntelligenceAuthority,
  IntelligenceSourceKind,
} from "../src/intelligence/externalIntelligence.ts";
import {
  createExternalIntelligenceCorrection,
} from "../src/intelligence/externalIntelligenceRecords.ts";
import {
  prepareExternalIntelligenceLinkage,
  type ExternalIntelligenceLinkingInput,
} from "../src/intelligence/externalIntelligenceLinking.ts";

const LINKED_AT_MS = Date.parse("2026-07-29T00:00:00.000Z");
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);

function item(
  itemId: string,
  publisherId: string,
  contentSha256 = DIGEST_A,
  authority: IntelligenceAuthority = "reputable",
): ExternalIntelligenceItem {
  const sourceKind: IntelligenceSourceKind =
    authority === "authoritative"
      ? "official-exchange"
      : authority === "social"
        ? "reddit"
        : "mainstream-news";
  return {
    itemId,
    sourceId: `source-${publisherId}`,
    sourceKind,
    authority,
    publisherId,
    sourceRef: `https://${publisherId}.example/events/${itemId}`,
    externalId: `external-${itemId}`,
    acquisitionMode: "scheduled-poll",
    topicKey: "BTC.SECURITY",
    assetSymbols: ["BTC"],
    eventType: "security-incident",
    stance: "negative",
    publishedAtMs: LINKED_AT_MS - 60_000,
    receivedAtMs: LINKED_AT_MS - 50_000,
    availableAtMs: LINKED_AT_MS - 40_000,
    payloadSha256: DIGEST_B,
    contentSha256,
    credibilityBps: 8_000,
    confidenceBps: 9_000,
    contentPolicy: "digest-only",
    modelTrainingAllowed: false,
  };
}

function input(
  items: readonly ExternalIntelligenceItem[],
): ExternalIntelligenceLinkingInput {
  return {
    linkedAtMs: LINKED_AT_MS,
    topicRules: [
      {
        topicKey: "BTC.SECURITY",
        entityKeys: ["BTC"],
        tradable: true,
        allowedEventTypes: ["security-incident"],
      },
    ],
    items,
    corrections: [],
  };
}

test("creates deterministic reviewed entity linkage", async () => {
  const first = await prepareExternalIntelligenceLinkage(
    input([item("one", "publisher-one"), item("two", "publisher-two", DIGEST_C)]),
  );
  const reordered = await prepareExternalIntelligenceLinkage(
    input([item("two", "publisher-two", DIGEST_C), item("one", "publisher-one")]),
  );
  assert.deepEqual(first, reordered);
  assert.equal(first.clusters.length, 2);
  assert.equal(first.representativeItems.length, 2);
  assert.match(first.topicRegistrySha256, /^[0-9a-f]{64}$/u);
  assert.match(first.linkageSha256, /^[0-9a-f]{64}$/u);
});

test("collapses exact syndication before publisher corroboration", async () => {
  const linked = await prepareExternalIntelligenceLinkage(
    input([
      item("social-copy", "publisher-social", DIGEST_A, "social"),
      item("news-copy", "publisher-news"),
      item("official", "publisher-official", DIGEST_A, "authoritative"),
    ]),
  );
  assert.equal(linked.clusters.length, 1);
  assert.deepEqual(linked.clusters[0]?.memberItemIds, [
    "news-copy",
    "official",
    "social-copy",
  ]);
  assert.deepEqual(linked.clusters[0]?.publisherIds, [
    "publisher-news",
    "publisher-official",
    "publisher-social",
  ]);
  assert.equal(linked.clusters[0]?.representativeItemId, "official");
  assert.deepEqual(
    linked.representativeItems.map((value) => value.itemId),
    ["official"],
  );
});

test("keeps different content as independent evidence", async () => {
  const linked = await prepareExternalIntelligenceLinkage(
    input([
      item("one", "publisher-one", DIGEST_A),
      item("two", "publisher-two", DIGEST_C),
    ]),
  );
  assert.equal(linked.clusters.length, 2);
  assert.deepEqual(
    linked.representativeItems.map((value) => value.itemId),
    ["one", "two"],
  );
});

test("uses append-only content updates in effective clustering", async () => {
  const original = item("one", "publisher-one", DIGEST_A);
  const correction = await createExternalIntelligenceCorrection({
    itemId: original.itemId,
    sourceId: original.sourceId,
    externalId: original.externalId,
    providerEventId: "correction-one",
    correctionKind: "content-update",
    observedAtMs: LINKED_AT_MS - 20_000,
    reasonCode: "publisher-update",
    replacementPayloadSha256: DIGEST_C,
    replacementContentSha256: DIGEST_D,
  });
  const linked = await prepareExternalIntelligenceLinkage({
    ...input([original, item("two", "publisher-two", DIGEST_A)]),
    corrections: [correction],
  });
  assert.equal(linked.clusters.length, 2);
  assert.equal(
    linked.representativeItems.find((value) => value.itemId === "one")
      ?.contentSha256,
    DIGEST_D,
  );
  assert.deepEqual(
    linked.clusters.find((value) => value.representativeItemId === "one")
      ?.correctionSha256s,
    [correction.correctionSha256],
  );
});

test("removes retracted evidence from active clusters", async () => {
  const original = item("one", "publisher-one");
  const correction = await createExternalIntelligenceCorrection({
    itemId: original.itemId,
    sourceId: original.sourceId,
    externalId: original.externalId,
    providerEventId: "retraction-one",
    correctionKind: "retraction",
    observedAtMs: LINKED_AT_MS - 20_000,
    reasonCode: "publisher-retraction",
    replacementPayloadSha256: null,
    replacementContentSha256: null,
  });
  const linked = await prepareExternalIntelligenceLinkage({
    ...input([original, item("two", "publisher-two", DIGEST_C)]),
    corrections: [correction],
  });
  assert.deepEqual(linked.inactiveItems, [
    {
      itemId: "one",
      correctionSha256s: [correction.correctionSha256],
    },
  ]);
  assert.deepEqual(
    linked.representativeItems.map((value) => value.itemId),
    ["two"],
  );
});

test("fails closed on unknown topics, entity drift and event drift", async () => {
  await assert.rejects(
    prepareExternalIntelligenceLinkage(
      input([{ ...item("one", "publisher-one"), topicKey: "UNKNOWN" }]),
    ),
    /unreviewed topicKey/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceLinkage(
      input([{ ...item("one", "publisher-one"), assetSymbols: ["ETH"] }]),
    ),
    /reviewed entity rule/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceLinkage(
      input([{ ...item("one", "publisher-one"), eventType: "partnership" }]),
    ),
    /unapproved event type/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceLinkage(
      input([
        {
          ...item("one", "publisher-one"),
          sourceKind: "reddit",
          authority: "reputable",
        },
      ]),
    ),
    /source authority/u,
  );
  const trainingItem = item("one", "publisher-one");
  Object.defineProperty(trainingItem, "modelTrainingAllowed", { value: true });
  await assert.rejects(
    prepareExternalIntelligenceLinkage(input([trainingItem])),
    /model training/u,
  );
});

test("fails closed on changed natural identities and future evidence", async () => {
  const first = item("one", "publisher-one");
  await assert.rejects(
    prepareExternalIntelligenceLinkage(
      input([
        first,
        {
          ...item("two", "publisher-one", DIGEST_C),
          externalId: first.externalId,
        },
      ]),
    ),
    /natural identity conflict/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceLinkage(
      input([{ ...first, availableAtMs: LINKED_AT_MS + 1 }]),
    ),
    /linkage chronology/u,
  );
});

test("fails closed on invalid or post-terminal correction chains", async () => {
  const original = item("one", "publisher-one");
  const retraction = await createExternalIntelligenceCorrection({
    itemId: original.itemId,
    sourceId: original.sourceId,
    externalId: original.externalId,
    providerEventId: "retraction-one",
    correctionKind: "retraction",
    observedAtMs: LINKED_AT_MS - 20_000,
    reasonCode: "publisher-retraction",
    replacementPayloadSha256: null,
    replacementContentSha256: null,
  });
  const later = await createExternalIntelligenceCorrection({
    itemId: original.itemId,
    sourceId: original.sourceId,
    externalId: original.externalId,
    providerEventId: "correction-two",
    correctionKind: "content-update",
    observedAtMs: LINKED_AT_MS - 10_000,
    reasonCode: "publisher-update",
    replacementPayloadSha256: DIGEST_C,
    replacementContentSha256: DIGEST_D,
  });
  await assert.rejects(
    prepareExternalIntelligenceLinkage({
      ...input([original]),
      corrections: [later, retraction],
    }),
    /after terminal removal/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceLinkage({
      ...input([original]),
      corrections: [
        {
          ...later,
          observedAtMs: original.availableAtMs - 1,
          correctionSha256: DIGEST_A,
        },
      ],
    }),
    /digest does not match|correction chronology/u,
  );
});


test("fails closed on changed correction digest identity reuse", async () => {
  const original = item("one", "publisher-one");
  const correction = await createExternalIntelligenceCorrection({
    itemId: original.itemId,
    sourceId: original.sourceId,
    externalId: original.externalId,
    providerEventId: "correction-one",
    correctionKind: "content-update",
    observedAtMs: LINKED_AT_MS - 20_000,
    reasonCode: "publisher-update",
    replacementPayloadSha256: DIGEST_C,
    replacementContentSha256: DIGEST_D,
  });
  await assert.rejects(
    prepareExternalIntelligenceLinkage({
      ...input([original]),
      corrections: [
        correction,
        { ...correction, providerEventId: "changed-same-digest" },
      ],
    }),
    /Changed correction identity/u,
  );
  const linked = await prepareExternalIntelligenceLinkage({
    ...input([original]),
    corrections: [correction, correction],
  });
  assert.deepEqual(linked.clusters[0]?.correctionSha256s, [
    correction.correctionSha256,
  ]);
});
