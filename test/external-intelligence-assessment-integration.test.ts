import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  prepareIntegratedExternalIntelligenceAssessments,
} from "../src/intelligence/externalIntelligenceAssessmentIntegration.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import type {
  ExternalIntelligenceItem,
  ExternalIntelligencePolicy,
} from "../src/intelligence/externalIntelligence.ts";
import { prepareExternalIntelligenceLinkage } from "../src/intelligence/externalIntelligenceLinking.ts";
import {
  createPermittedContentFingerprint,
  prepareExternalIntelligenceManipulationEvidence,
  type ExternalIntelligenceManipulationEvidence,
} from "../src/intelligence/externalIntelligenceManipulation.ts";
import {
  prepareExternalIntelligenceAssessmentIntegrationPersistence,
} from "../src/storage/externalIntelligenceAssessmentIntegration.ts";
import { sha256Hex } from "../src/utils/crypto.ts";

const LINKED_AT_MS = Date.parse("2026-07-29T01:00:00.000Z");
const ANALYSED_AT_MS = LINKED_AT_MS + 1_000;
const ASSESSED_AT_MS = ANALYSED_AT_MS + 1_000;
const POLICY: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": 86_400_000,
    regulator: 86_400_000,
    issuer: 86_400_000,
    "mainstream-news": 86_400_000,
    "specialist-news": 86_400_000,
    reddit: 3_600_000,
  },
  maximumReceiptDelayMs: 60_000,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 7_000,
  maximumItems: 20,
};
const MANIPULATION_POLICY = {
  minimumNearDuplicateSimilarityBps: 7_500,
  maximumNearDuplicatePublicationSkewMs: 3_600_000,
  rapidRepostWindowMs: 300_000,
  minimumRapidRepostPublishers: 2,
} as const;
const BASE =
  "Kraken confirms a major security incident affecting bitcoin deposits while engineers investigate and publish verified updates";
const NEAR = `${BASE} promptly today`;
const DISTINCT =
  "An independent market operator confirms a new bitcoin partnership after completing technical and legal diligence";

async function item(
  itemId: string,
  publisherId: string,
  content: string,
  options: {
    readonly sourceKind?: ExternalIntelligenceItem["sourceKind"];
    readonly eventType?: ExternalIntelligenceItem["eventType"];
    readonly stance?: ExternalIntelligenceItem["stance"];
  } = {},
): Promise<ExternalIntelligenceItem> {
  const sourceKind = options.sourceKind ?? "mainstream-news";
  return {
    itemId,
    sourceId: `source-${publisherId}`,
    sourceKind,
    authority:
      sourceKind === "mainstream-news"
        ? "reputable"
        : sourceKind === "reddit"
          ? "social"
          : "authoritative",
    publisherId,
    sourceRef: `https://${publisherId}.example/${itemId}`,
    externalId: `external-${itemId}`,
    acquisitionMode: "minute-poll",
    topicKey: "BTC.EVENT",
    assetSymbols: ["BTC"],
    eventType: options.eventType ?? "partnership",
    stance: options.stance ?? "positive",
    publishedAtMs: LINKED_AT_MS - 60_000,
    receivedAtMs: LINKED_AT_MS - 50_000,
    availableAtMs: LINKED_AT_MS - 40_000,
    payloadSha256: "a".repeat(64),
    contentSha256: await sha256Hex(content),
    credibilityBps: 8_000,
    confidenceBps: 9_000,
    contentPolicy: "permitted-excerpt",
    modelTrainingAllowed: false,
  };
}

async function bundle(items: readonly ExternalIntelligenceItem[], contents: string[]) {
  const linkage = await prepareExternalIntelligenceLinkage({
    linkedAtMs: LINKED_AT_MS,
    topicRules: [
      {
        topicKey: "BTC.EVENT",
        entityKeys: ["BTC"],
        tradable: true,
        allowedEventTypes: ["partnership", "security-incident"],
      },
    ],
    items,
    corrections: [],
  });
  const fingerprints = await Promise.all(
    items.map((value, index) =>
      createPermittedContentFingerprint({
        item: value,
        permittedContent: contents[index] ?? "",
        fingerprintedAtMs: LINKED_AT_MS + 500,
      }),
    ),
  );
  const manipulationEvidence =
    await prepareExternalIntelligenceManipulationEvidence({
      analysedAtMs: ANALYSED_AT_MS,
      linkage,
      policy: MANIPULATION_POLICY,
      fingerprints,
    });
  return { linkage, manipulationEvidence };
}

test("rapid multi-publisher positive reposts persist as watch-only", async () => {
  const items = [
    await item("one", "publisher-one", BASE),
    await item("two", "publisher-two", NEAR),
  ];
  const evidence = await bundle(items, [BASE, NEAR]);
  const integrations = await prepareIntegratedExternalIntelligenceAssessments({
    assessedAtMs: ASSESSED_AT_MS,
    ...evidence,
    policy: POLICY,
  });
  assert.equal(integrations.length, 1);
  const integration = integrations[0];
  assert.equal(integration?.assessment.reaction, "watch");
  assert.equal(integration?.effectiveReaction, "watch");
  assert.equal(integration?.actionableRepostClusterSha256s.length, 0);
  assert.equal(integration?.watchOnlyRepostClusterSha256s.length, 1);
  assert.match(integration?.integrationSha256 ?? "", /^[0-9a-f]{64}$/u);
});

test("distinct positive publishers remain a research candidate", async () => {
  const items = [
    await item("one", "publisher-one", BASE),
    await item("two", "publisher-two", DISTINCT),
  ];
  const evidence = await bundle(items, [BASE, DISTINCT]);
  const [integration] =
    await prepareIntegratedExternalIntelligenceAssessments({
      assessedAtMs: ASSESSED_AT_MS,
      ...evidence,
      policy: POLICY,
    });
  assert.equal(integration?.effectiveReaction, "research-candidate");
  assert.equal(integration?.assessment.independentPublisherCount, 2);
  assert.equal(integration?.actionableRepostClusterSha256s.length, 2);
});

test("authoritative severe negatives remain fail-safe through repost handling", async () => {
  const items = [
    await item("one", "kraken", BASE, {
      sourceKind: "official-exchange",
      eventType: "security-incident",
      stance: "negative",
    }),
    await item("two", "publisher-two", NEAR, {
      eventType: "security-incident",
      stance: "negative",
    }),
  ];
  const evidence = await bundle(items, [BASE, NEAR]);
  const [integration] =
    await prepareIntegratedExternalIntelligenceAssessments({
      assessedAtMs: ASSESSED_AT_MS,
      ...evidence,
      policy: POLICY,
    });
  assert.equal(integration?.effectiveReaction, "pause-new-risk");
  assert.equal(integration?.actionableRepostClusterSha256s.length, 1);
  assert.equal(integration?.watchOnlyRepostClusterSha256s.length, 0);
});

test("rejects self-consistent manipulation evidence that omits linkage clusters", async () => {
  const items = [
    await item("one", "publisher-one", BASE),
    await item("two", "publisher-two", DISTINCT),
  ];
  const evidence = await bundle(items, [BASE, DISTINCT]);
  const repostClusters = evidence.manipulationEvidence.repostClusters.slice(0, 1);
  const representativeId = repostClusters[0]?.representativeItemId;
  assert.ok(representativeId);
  const representativeItems =
    evidence.manipulationEvidence.representativeItems.filter(
      (value) => value.itemId === representativeId,
    );
  const canonical = {
    schemaVersion: evidence.manipulationEvidence.schemaVersion,
    analysedAtMs: evidence.manipulationEvidence.analysedAtMs,
    linkageSha256: evidence.manipulationEvidence.linkageSha256,
    policySha256: evidence.manipulationEvidence.policySha256,
    repostClusters,
    representativeItems,
  } as const;
  const manipulationEvidence: ExternalIntelligenceManipulationEvidence = {
    ...canonical,
    evidenceSha256: await sha256CanonicalIntelligence(canonical),
  };
  await assert.rejects(
    prepareIntegratedExternalIntelligenceAssessments({
      assessedAtMs: ASSESSED_AT_MS,
      linkage: evidence.linkage,
      manipulationEvidence,
      policy: POLICY,
    }),
    /exact partitions/u,
  );
});

test("reproduces integrations before preparing exactly three persistence statements", async () => {
  const items = [
    await item("one", "publisher-one", BASE),
    await item("two", "publisher-two", DISTINCT),
  ];
  const evidence = await bundle(items, [BASE, DISTINCT]);
  const integrations = await prepareIntegratedExternalIntelligenceAssessments({
    assessedAtMs: ASSESSED_AT_MS,
    ...evidence,
    policy: POLICY,
  });
  const statements =
    await prepareExternalIntelligenceAssessmentIntegrationPersistence({
      ...evidence,
      assessmentPolicy: POLICY,
      integrations,
    });
  assert.equal(statements.length, 3);
  const tampered = integrations.map((integration) => ({
    ...integration,
    effectiveReaction: "watch" as const,
  }));
  await assert.rejects(
    prepareExternalIntelligenceAssessmentIntegrationPersistence({
      ...evidence,
      assessmentPolicy: POLICY,
      integrations: tampered,
    }),
    /digest does not match/u,
  );
});

test("migration preserves exact retries and rejects mutation", async () => {
  const items = [
    await item("one", "publisher-one", BASE),
    await item("two", "publisher-two", DISTINCT, {
      eventType: "security-incident",
      stance: "negative",
    }),
  ];
  const evidence = await bundle(items, [BASE, DISTINCT]);
  const integrations = await prepareIntegratedExternalIntelligenceAssessments({
    assessedAtMs: ASSESSED_AT_MS,
    ...evidence,
    policy: POLICY,
  });
  assert.equal(integrations.length, 2);
  const statements =
    await prepareExternalIntelligenceAssessmentIntegrationPersistence({
      ...evidence,
      assessmentPolicy: POLICY,
      integrations,
    });
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0013_external_intelligence_assessment_integration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.params);
  }
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.params);
  }
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM external_intelligence_linkages")
      .get()?.count,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM integrated_external_intelligence_assessments",
      )
      .get()?.count,
    2,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE integrated_external_intelligence_assessments SET effective_reaction = 'watch'",
        )
        .run(),
    /immutable/u,
  );
  db.close();
});
