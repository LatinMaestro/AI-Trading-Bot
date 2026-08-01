import assert from "node:assert/strict";
import test from "node:test";
import {
  assessExternalIntelligence,
  type ExternalIntelligenceItem,
  type ExternalIntelligencePolicy,
  type IntelligenceAuthority,
  type IntelligenceSourceKind,
} from "../src/intelligence/externalIntelligence.ts";

const NOW = 2_000_000;
const digest = (value: string) =>
  (value.charCodeAt(0) % 16).toString(16).repeat(64);

const policy: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": 3_600_000,
    regulator: 3_600_000,
    issuer: 3_600_000,
    "mainstream-news": 1_800_000,
    "specialist-news": 900_000,
    reddit: 300_000,
  },
  maximumReceiptDelayMs: 120_000,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 5_000,
  maximumItems: 50,
};

function authority(sourceKind: IntelligenceSourceKind): IntelligenceAuthority {
  if (["official-exchange", "regulator", "issuer"].includes(sourceKind)) {
    return "authoritative";
  }
  return sourceKind === "reddit" ? "social" : "reputable";
}

function item(
  id: string,
  sourceKind: IntelligenceSourceKind,
  publisherId: string,
  options: Partial<ExternalIntelligenceItem> = {},
): ExternalIntelligenceItem {
  return {
    itemId: id,
    sourceId: `${sourceKind}:${publisherId}`,
    sourceKind,
    authority: authority(sourceKind),
    publisherId,
    sourceRef: `https://${publisherId}.example/items/${id}`,
    externalId: id,
    acquisitionMode: "minute-poll",
    topicKey: "BTC:security-event:2000000",
    assetSymbols: ["BTC"],
    eventType: "security-incident",
    stance: "negative",
    publishedAtMs: NOW - 60_000,
    receivedAtMs: NOW - 30_000,
    availableAtMs: NOW - 20_000,
    payloadSha256: digest(id[0] ?? "a"),
    contentSha256: digest(id.at(-1) ?? "b"),
    credibilityBps: 8_000,
    confidenceBps: 8_000,
    contentPolicy: sourceKind === "reddit" ? "metadata-only" : "permitted-excerpt",
    modelTrainingAllowed: false,
    ...options,
  };
}

test("authoritative severe negative evidence pauses new risk", async () => {
  const assessment = await assessExternalIntelligence(
    "BTC:security-event:2000000",
    "security-incident",
    "negative",
    [item("official-1", "official-exchange", "kraken.com")],
    NOW,
    policy,
  );

  assert.equal(assessment.reaction, "pause-new-risk");
  assert.equal(assessment.authoritativeSourceCount, 1);
  assert.equal(assessment.maximumPublicationToReceiptMs, 30_000);
  assert.equal(assessment.acceptedEvidenceSha256.length, 1);
  assert.match(assessment.acceptedEvidenceSha256[0], /^[0-9a-f]{64}$/);
  assert.match(assessment.assessmentSha256, /^[0-9a-f]{64}$/);
});

test("Reddit-only positive chatter remains a watch signal", async () => {
  const assessment = await assessExternalIntelligence(
    "BTC:listing-rumour:2000000",
    "rumour",
    "positive",
    [
      item("reddit-1", "reddit", "reddit-r-crypto", {
        topicKey: "BTC:listing-rumour:2000000",
        eventType: "rumour",
        stance: "positive",
      }),
      item("reddit-2", "reddit", "reddit-btc", {
        topicKey: "BTC:listing-rumour:2000000",
        eventType: "rumour",
        stance: "positive",
      }),
    ],
    NOW,
    policy,
  );

  assert.equal(assessment.reaction, "watch");
  assert.equal(assessment.socialSourceCount, 2);
  assert.ok(
    assessment.warnings.includes("social-only evidence cannot create a risk-on candidate"),
  );
});

test("independent reputable positive coverage creates research candidate only", async () => {
  const topicKey = "ETH:partnership:2000000";
  const assessment = await assessExternalIntelligence(
    topicKey,
    "partnership",
    "positive",
    [
      item("news-1", "mainstream-news", "publisher-one.com", {
        topicKey,
        assetSymbols: ["ETH"],
        eventType: "partnership",
        stance: "positive",
      }),
      item("news-2", "specialist-news", "publisher-two.com", {
        topicKey,
        assetSymbols: ["ETH"],
        eventType: "partnership",
        stance: "positive",
      }),
    ],
    NOW,
    policy,
  );

  assert.equal(assessment.reaction, "research-candidate");
  assert.equal(assessment.independentPublisherCount, 2);
  assert.ok(
    assessment.warnings.includes("external intelligence never submits or approves an order"),
  );
});

test("social publishers cannot satisfy reputable corroboration", async () => {
  const topicKey = "SOL:partnership:2000000";
  const assessment = await assessExternalIntelligence(
    topicKey,
    "partnership",
    "positive",
    [
      item("news-1", "specialist-news", "publisher.com", {
        topicKey,
        assetSymbols: ["SOL"],
        eventType: "partnership",
        stance: "positive",
      }),
      item("reddit-1", "reddit", "reddit-sol", {
        topicKey,
        assetSymbols: ["SOL"],
        eventType: "partnership",
        stance: "positive",
      }),
    ],
    NOW,
    policy,
  );

  assert.equal(assessment.reaction, "watch");
});

test("multiple articles from one publisher do not satisfy independence", async () => {
  const topicKey = "SOL:partnership:2000000";
  const assessment = await assessExternalIntelligence(
    topicKey,
    "partnership",
    "positive",
    [
      item("article-1", "specialist-news", "same-publisher.com", {
        topicKey,
        assetSymbols: ["SOL"],
        eventType: "partnership",
        stance: "positive",
      }),
      item("article-2", "specialist-news", "same-publisher.com", {
        topicKey,
        assetSymbols: ["SOL"],
        eventType: "partnership",
        stance: "positive",
      }),
    ],
    NOW,
    policy,
  );

  assert.equal(assessment.reaction, "watch");
  assert.equal(assessment.independentPublisherCount, 1);
});

test("stale, delayed and low-credibility items remain auditable rejections", async () => {
  const topicKey = "BTC:macro:2000000";
  const assessment = await assessExternalIntelligence(
    topicKey,
    "macro",
    "negative",
    [
      item("stale", "reddit", "reddit-stale", {
        topicKey,
        eventType: "macro",
        publishedAtMs: NOW - 600_000,
        receivedAtMs: NOW - 590_000,
        availableAtMs: NOW - 580_000,
      }),
      item("delayed", "mainstream-news", "slow-news.com", {
        topicKey,
        eventType: "macro",
        publishedAtMs: NOW - 300_000,
        receivedAtMs: NOW - 100_000,
        availableAtMs: NOW - 90_000,
      }),
      item("weak", "specialist-news", "weak-news.com", {
        topicKey,
        eventType: "macro",
        credibilityBps: 4_000,
      }),
    ],
    NOW,
    policy,
  );

  assert.equal(assessment.reaction, "ignore");
  assert.deepEqual(
    assessment.rejectedItems.map((entry) => entry.reason).sort(),
    ["low-credibility", "receipt-delay", "stale"],
  );
});

test("natural identity conflicts fail closed", async () => {
  const original = item("same", "mainstream-news", "publisher.com");
  const changed = {
    ...original,
    itemId: "changed",
    payloadSha256: digest("z"),
  };
  await assert.rejects(
    assessExternalIntelligence(
      original.topicKey,
      original.eventType,
      original.stance,
      [original, changed],
      NOW,
      policy,
    ),
    /natural identity conflict/,
  );
});

test("policy requires a freshness bound for every source kind", async () => {
  const incompletePolicy = {
    ...policy,
    maximumItemAgeMs: {
      ...policy.maximumItemAgeMs,
      reddit: undefined,
    },
  } as unknown as ExternalIntelligencePolicy;

  await assert.rejects(
    assessExternalIntelligence(
      "BTC:security-event:2000000",
      "security-incident",
      "negative",
      [item("missing-age", "official-exchange", "kraken.com")],
      NOW,
      incompletePolicy,
    ),
    /must define every supported source kind exactly/,
  );
});

test("assessment identity binds exact accepted evidence", async () => {
  const original = item("bound", "official-exchange", "kraken.com");
  const changed = { ...original, confidenceBps: original.confidenceBps - 1 };

  const first = await assessExternalIntelligence(
    original.topicKey,
    original.eventType,
    original.stance,
    [original],
    NOW,
    policy,
  );
  const second = await assessExternalIntelligence(
    changed.topicKey,
    changed.eventType,
    changed.stance,
    [changed],
    NOW,
    policy,
  );

  assert.notEqual(first.acceptedEvidenceSha256[0], second.acceptedEvidenceSha256[0]);
  assert.notEqual(first.assessmentSha256, second.assessmentSha256);
});

test("source authority, chronology and Reddit storage policy fail closed", async () => {
  await assert.rejects(
    assessExternalIntelligence(
      "BTC:security-event:2000000",
      "security-incident",
      "negative",
      [
        item("bad-authority", "reddit", "reddit-bad", {
          authority: "authoritative",
        }),
      ],
      NOW,
      policy,
    ),
    /incompatible authority/,
  );

  await assert.rejects(
    assessExternalIntelligence(
      "BTC:security-event:2000000",
      "security-incident",
      "negative",
      [
        item("bad-time", "mainstream-news", "publisher-time.com", {
          publishedAtMs: NOW - 10_000,
          receivedAtMs: NOW - 20_000,
        }),
      ],
      NOW,
      policy,
    ),
    /invalid intelligence chronology/,
  );

  await assert.rejects(
    assessExternalIntelligence(
      "BTC:security-event:2000000",
      "security-incident",
      "negative",
      [
        item("bad-storage", "reddit", "reddit-storage", {
          contentPolicy: "permitted-full",
        }),
      ],
      NOW,
      policy,
    ),
    /cannot use permitted-full storage/,
  );
});
