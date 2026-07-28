import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalIntelligenceItem,
  IntelligenceStance,
} from "../src/intelligence/externalIntelligence.ts";
import {
  prepareExternalIntelligenceLinkage,
} from "../src/intelligence/externalIntelligenceLinking.ts";
import {
  createPermittedContentFingerprint,
  prepareExternalIntelligenceManipulationEvidence,
  type ExternalIntelligenceManipulationPolicy,
  type PermittedContentFingerprint,
} from "../src/intelligence/externalIntelligenceManipulation.ts";
import { sha256Hex } from "../src/utils/crypto.ts";

const LINKED_AT_MS = Date.parse("2026-07-29T00:00:00.000Z");
const ANALYSED_AT_MS = LINKED_AT_MS + 1_000;
const POLICY: ExternalIntelligenceManipulationPolicy = {
  minimumNearDuplicateSimilarityBps: 7_500,
  maximumNearDuplicatePublicationSkewMs: 60 * 60 * 1_000,
  rapidRepostWindowMs: 5 * 60 * 1_000,
  minimumRapidRepostPublishers: 2,
};
const BASE_CONTENT =
  "Kraken reports a security incident affecting bitcoin deposits while engineers investigate the issue and publish verified updates";
const NEAR_CONTENT =
  `${BASE_CONTENT} promptly today`;
const SLOW_CONTENT =
  `${BASE_CONTENT} promptly tomorrow`;
const DISTINCT_CONTENT =
  "A scheduled software release adds wallet diagnostics and documentation for node operators without changing consensus rules";

async function item(
  itemId: string,
  publisherId: string,
  content: string,
  options: {
    readonly publishedAtMs?: number;
    readonly topicKey?: string;
    readonly stance?: IntelligenceStance;
    readonly contentPolicy?: ExternalIntelligenceItem["contentPolicy"];
    readonly sourceKind?: ExternalIntelligenceItem["sourceKind"];
  } = {},
): Promise<ExternalIntelligenceItem> {
  const sourceKind = options.sourceKind ?? "mainstream-news";
  return {
    itemId,
    sourceId: `source-${publisherId}`,
    sourceKind,
    authority:
      sourceKind === "reddit"
        ? "social"
        : sourceKind === "mainstream-news"
          ? "reputable"
          : "authoritative",
    publisherId,
    sourceRef: `https://${publisherId}.example/events/${itemId}`,
    externalId: `external-${itemId}`,
    acquisitionMode: "scheduled-poll",
    topicKey: options.topicKey ?? "BTC.SECURITY",
    assetSymbols: ["BTC"],
    eventType: "security-incident",
    stance: options.stance ?? "negative",
    publishedAtMs: options.publishedAtMs ?? LINKED_AT_MS - 60_000,
    receivedAtMs: LINKED_AT_MS - 50_000,
    availableAtMs: LINKED_AT_MS - 40_000,
    payloadSha256: "a".repeat(64),
    contentSha256: await sha256Hex(content),
    credibilityBps: 8_000,
    confidenceBps: 9_000,
    contentPolicy: options.contentPolicy ?? "permitted-excerpt",
    modelTrainingAllowed: false,
  };
}

async function linkage(items: readonly ExternalIntelligenceItem[]) {
  return prepareExternalIntelligenceLinkage({
    linkedAtMs: LINKED_AT_MS,
    topicRules: [
      {
        topicKey: "BTC.SECURITY",
        entityKeys: ["BTC"],
        tradable: true,
        allowedEventTypes: ["security-incident"],
      },
      {
        topicKey: "BTC.OTHER",
        entityKeys: ["BTC"],
        tradable: true,
        allowedEventTypes: ["security-incident"],
      },
    ],
    items,
    corrections: [],
  });
}

async function fingerprints(
  items: readonly ExternalIntelligenceItem[],
  contents: Readonly<Record<string, string>>,
): Promise<readonly PermittedContentFingerprint[]> {
  return Promise.all(
    items
      .filter(
        (value) =>
          value.sourceKind !== "reddit" &&
          (value.contentPolicy === "permitted-excerpt" ||
            value.contentPolicy === "permitted-full"),
      )
      .map((value) =>
        createPermittedContentFingerprint({
          item: value,
          permittedContent: contents[value.itemId] ?? "",
          fingerprintedAtMs: LINKED_AT_MS + 500,
        }),
      ),
  );
}

test("fingerprints permitted content deterministically without retaining text", async () => {
  const original = await item("one", "publisher-one", BASE_CONTENT);
  const first = await createPermittedContentFingerprint({
    item: original,
    permittedContent: BASE_CONTENT,
    fingerprintedAtMs: LINKED_AT_MS + 500,
  });
  const normalizedVariant = BASE_CONTENT
    .toLocaleUpperCase("en-US")
    .replace("BITCOIN", "BITCOIN https://tracking.example/story");
  const variant = await item("two", "publisher-two", normalizedVariant);
  const second = await createPermittedContentFingerprint({
    item: variant,
    permittedContent: normalizedVariant,
    fingerprintedAtMs: LINKED_AT_MS + 500,
  });
  assert.deepEqual(first.shingleSha256s, second.shingleSha256s);
  assert.equal(first.tokenCount, second.tokenCount);
  assert.match(first.fingerprintSha256, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(first).includes(BASE_CONTENT), false);
});

test("rejects non-permitted, Reddit and digest-mismatched content", async () => {
  const digestOnly = await item("digest", "publisher-one", BASE_CONTENT, {
    contentPolicy: "digest-only",
  });
  await assert.rejects(
    createPermittedContentFingerprint({
      item: digestOnly,
      permittedContent: BASE_CONTENT,
      fingerprintedAtMs: LINKED_AT_MS + 500,
    }),
    /does not permit/u,
  );
  const reddit = await item("reddit", "publisher-social", BASE_CONTENT, {
    sourceKind: "reddit",
  });
  await assert.rejects(
    createPermittedContentFingerprint({
      item: reddit,
      permittedContent: BASE_CONTENT,
      fingerprintedAtMs: LINKED_AT_MS + 500,
    }),
    /does not permit/u,
  );
  const permitted = await item("permitted", "publisher-two", BASE_CONTENT);
  await assert.rejects(
    createPermittedContentFingerprint({
      item: permitted,
      permittedContent: DISTINCT_CONTENT,
      fingerprintedAtMs: LINKED_AT_MS + 500,
    }),
    /digest does not match/u,
  );
});

test("clusters near-duplicate publisher evidence deterministically", async () => {
  const values = [
    await item("one", "publisher-one", BASE_CONTENT),
    await item("two", "publisher-two", NEAR_CONTENT),
    await item("three", "publisher-three", DISTINCT_CONTENT),
  ];
  const linked = await linkage(values);
  const content = {
    one: BASE_CONTENT,
    two: NEAR_CONTENT,
    three: DISTINCT_CONTENT,
  };
  const signatures = await fingerprints(values, content);
  const first = await prepareExternalIntelligenceManipulationEvidence({
    analysedAtMs: ANALYSED_AT_MS,
    linkage: linked,
    policy: POLICY,
    fingerprints: signatures,
  });
  const reordered = await prepareExternalIntelligenceManipulationEvidence({
    analysedAtMs: ANALYSED_AT_MS,
    linkage: linked,
    policy: POLICY,
    fingerprints: [...signatures].reverse(),
  });
  assert.deepEqual(first, reordered);
  assert.equal(first.repostClusters.length, 2);
  const repost = first.repostClusters.find(
    (value) => value.memberItemIds.length === 2,
  );
  assert.deepEqual(repost?.memberItemIds, ["one", "two"]);
  assert.equal(repost?.corroborationUnitCount, 1);
  assert.equal(repost?.coordinationSignal, "rapid-multi-publisher-repost");
  assert.equal(repost?.handling, "watch-only");
  assert.equal(first.representativeItems.length, 2);
});

test("does not cluster distinct, cross-topic or cross-stance evidence", async () => {
  const values = [
    await item("one", "publisher-one", BASE_CONTENT),
    await item("distinct", "publisher-two", DISTINCT_CONTENT),
    await item("topic", "publisher-three", BASE_CONTENT, {
      topicKey: "BTC.OTHER",
    }),
    await item("stance", "publisher-four", BASE_CONTENT, {
      stance: "uncertain",
    }),
  ];
  const linked = await linkage(values);
  const signatures = await fingerprints(values, {
    one: BASE_CONTENT,
    distinct: DISTINCT_CONTENT,
    topic: BASE_CONTENT,
    stance: BASE_CONTENT,
  });
  const result = await prepareExternalIntelligenceManipulationEvidence({
    analysedAtMs: ANALYSED_AT_MS,
    linkage: linked,
    policy: POLICY,
    fingerprints: signatures,
  });
  assert.equal(result.repostClusters.length, 4);
  assert.ok(
    result.repostClusters.every(
      (value) =>
        value.minimumPairSimilarityBps === null &&
        value.coordinationSignal === "none",
    ),
  );
});

test("same-publisher or slow reposts remain one evidence unit without coordination claim", async () => {
  const values = [
    await item("one", "publisher-one", BASE_CONTENT),
    await item("two", "publisher-one", NEAR_CONTENT),
    await item("slow", "publisher-two", SLOW_CONTENT, {
      publishedAtMs: LINKED_AT_MS - 20 * 60 * 1_000,
    }),
  ];
  const linked = await linkage(values);
  const signatures = await fingerprints(values, {
    one: BASE_CONTENT,
    two: NEAR_CONTENT,
    slow: SLOW_CONTENT,
  });
  const result = await prepareExternalIntelligenceManipulationEvidence({
    analysedAtMs: ANALYSED_AT_MS,
    linkage: linked,
    policy: POLICY,
    fingerprints: signatures,
  });
  const near = result.repostClusters.find(
    (value) => value.memberItemIds.length === 3,
  );
  assert.equal(near?.coordinationSignal, "none");
  assert.equal(near?.handling, "single-evidence-unit");
  assert.equal(near?.corroborationUnitCount, 1);
});

test("complete-link clustering does not merge a transitive similarity bridge", async () => {
  const a = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
  const b = "alpha beta gamma delta epsilon zeta eta theta iota changed lambda";
  const c = "alpha beta gamma delta epsilon zeta changed theta changed changed lambda";
  const values = [
    await item("a", "publisher-a", a),
    await item("b", "publisher-b", b),
    await item("c", "publisher-c", c),
  ];
  const linked = await linkage(values);
  const signatures = await fingerprints(values, { a, b, c });
  const result = await prepareExternalIntelligenceManipulationEvidence({
    analysedAtMs: ANALYSED_AT_MS,
    linkage: linked,
    policy: {
      ...POLICY,
      minimumNearDuplicateSimilarityBps: 5_000,
    },
    fingerprints: signatures,
  });
  assert.equal(result.repostClusters.length, 2);
  assert.ok(
    result.repostClusters.some((value) => value.memberItemIds.length === 2),
  );
  assert.ok(
    result.repostClusters.some((value) => value.memberItemIds.length === 1),
  );
});

test("requires complete exact fingerprint coverage and valid identities", async () => {
  const original = await item("one", "publisher-one", BASE_CONTENT);
  const linked = await linkage([original]);
  const [signature] = await fingerprints([original], { one: BASE_CONTENT });
  assert.ok(signature);
  await assert.rejects(
    prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs: ANALYSED_AT_MS,
      linkage: linked,
      policy: POLICY,
      fingerprints: [],
    }),
    /coverage is incomplete/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs: ANALYSED_AT_MS,
      linkage: linked,
      policy: POLICY,
      fingerprints: [{ ...signature, fingerprintSha256: "b".repeat(64) }],
    }),
    /fingerprint digest does not match/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs: ANALYSED_AT_MS,
      linkage: { ...linked, linkageSha256: "c".repeat(64) },
      policy: POLICY,
      fingerprints: [signature],
    }),
    /linkage digest does not match/u,
  );
});

test("rejects unsafe manipulation thresholds and future fingerprints", async () => {
  const original = await item("one", "publisher-one", BASE_CONTENT);
  const linked = await linkage([original]);
  const [signature] = await fingerprints([original], { one: BASE_CONTENT });
  assert.ok(signature);
  await assert.rejects(
    prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs: ANALYSED_AT_MS,
      linkage: linked,
      policy: { ...POLICY, minimumNearDuplicateSimilarityBps: 4_999 },
      fingerprints: [signature],
    }),
    /cannot be below 5000/u,
  );
  await assert.rejects(
    prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs: ANALYSED_AT_MS,
      linkage: linked,
      policy: POLICY,
      fingerprints: [
        { ...signature, fingerprintedAtMs: ANALYSED_AT_MS + 1 },
      ],
    }),
    /fingerprint chronology|fingerprint digest/u,
  );
});
