import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";
import {
  assessExternalIntelligence,
  type ExternalIntelligenceAssessment,
  type ExternalIntelligenceItem,
  type ExternalIntelligencePolicy,
  type IntelligenceReaction,
} from "./externalIntelligence.ts";
import type { ExternalIntelligenceLinkage } from "./externalIntelligenceLinking.ts";
import type {
  ExternalIntelligenceManipulationEvidence,
  ExternalIntelligenceRepostCluster,
} from "./externalIntelligenceManipulation.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_ASSESSMENTS = 100;
const SEVERE_RISK_EVENTS = new Set([
  "delisting",
  "trading-halt",
  "security-incident",
  "regulatory-action",
  "network-incident",
]);
const EVENT_TYPES = new Set([
  "listing",
  "delisting",
  "trading-halt",
  "security-incident",
  "regulatory-action",
  "network-incident",
  "market-structure",
  "macro",
  "partnership",
  "social-attention",
  "rumour",
  "other",
]);
const STANCES = new Set(["positive", "negative", "neutral", "uncertain"]);
const REACTIONS = new Set([
  "ignore",
  "watch",
  "research-candidate",
  "pause-new-risk",
]);

export interface IntegratedExternalIntelligenceAssessment {
  readonly schemaVersion: "integrated-external-intelligence-assessment-v1";
  readonly assessedAtMs: number;
  readonly linkageSha256: string;
  readonly manipulationEvidenceSha256: string;
  readonly manipulationPolicySha256: string;
  readonly assessmentPolicySha256: string;
  readonly assessment: ExternalIntelligenceAssessment;
  readonly effectiveReaction: IntelligenceReaction;
  readonly actionableRepostClusterSha256s: readonly string[];
  readonly watchOnlyRepostClusterSha256s: readonly string[];
  readonly warnings: readonly string[];
  readonly integrationSha256: string;
}

export interface ExternalIntelligenceAssessmentIntegrationInput {
  readonly assessedAtMs: number;
  readonly linkage: ExternalIntelligenceLinkage;
  readonly manipulationEvidence: ExternalIntelligenceManipulationEvidence;
  readonly policy: ExternalIntelligencePolicy;
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertCanonicalText(name: string, value: string): void {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be canonical text`);
  }
}

function assertSortedUniqueText(
  name: string,
  values: readonly string[],
  maximum = 500,
): void {
  if (values.length < 1 || values.length > maximum) {
    throw new Error(`${name} must contain 1 to ${maximum} values`);
  }
  const sorted = [...values].sort();
  if (
    new Set(sorted).size !== sorted.length ||
    canonicalIntelligenceJson(sorted) !== canonicalIntelligenceJson(values)
  ) {
    throw new Error(`${name} must be sorted, unique and bounded`);
  }
  for (const value of values) assertCanonicalText(name, value);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalIntelligenceJson(left) === canonicalIntelligenceJson(right);
}

function assertSortedUnique(name: string, values: readonly string[]): void {
  const sorted = [...values].sort();
  if (
    values.length > 500 ||
    new Set(sorted).size !== sorted.length ||
    canonicalIntelligenceJson(sorted) !== canonicalIntelligenceJson(values)
  ) {
    throw new Error(`${name} must be sorted, unique and bounded`);
  }
  for (const value of values) assertDigest(name, value);
}

export async function verifyExternalIntelligenceLinkageArtifact(
  linkage: ExternalIntelligenceLinkage,
): Promise<void> {
  if (linkage.schemaVersion !== "external-intelligence-linkage-v1") {
    throw new Error("Unsupported external intelligence linkage schema");
  }
  assertTime("linkedAtMs", linkage.linkedAtMs);
  assertDigest("topicRegistrySha256", linkage.topicRegistrySha256);
  assertDigest("linkageSha256", linkage.linkageSha256);
  if (
    linkage.clusters.length < 1 ||
    linkage.clusters.length > 500 ||
    linkage.representativeItems.length !== linkage.clusters.length
  ) {
    throw new Error("Linkage clusters and representatives must form a bounded bijection");
  }
  const representatives = new Map(
    linkage.representativeItems.map((item) => [item.itemId, item]),
  );
  if (representatives.size !== linkage.representativeItems.length) {
    throw new Error("Linkage contains duplicate representatives");
  }
  const clusterDigests = new Set<string>();
  const clusterRepresentativeIds = new Set<string>();
  for (const cluster of linkage.clusters) {
    assertDigest("clusterSha256", cluster.clusterSha256);
    assertDigest("effectiveContentSha256", cluster.effectiveContentSha256);
    assertCanonicalText("topicKey", cluster.topicKey);
    if (
      typeof cluster.tradable !== "boolean" ||
      !EVENT_TYPES.has(cluster.eventType) ||
      !STANCES.has(cluster.stance)
    ) {
      throw new Error("Linkage cluster classification is invalid");
    }
    assertSortedUniqueText("entityKeys", cluster.entityKeys, 50);
    assertSortedUniqueText("memberItemIds", cluster.memberItemIds);
    assertSortedUniqueText("publisherIds", cluster.publisherIds);
    assertSortedUniqueText("sourceIds", cluster.sourceIds);
    assertSortedUnique("correctionSha256s", cluster.correctionSha256s);
    if (
      clusterDigests.has(cluster.clusterSha256) ||
      clusterRepresentativeIds.has(cluster.representativeItemId)
    ) {
      throw new Error("Linkage contains duplicate cluster identities");
    }
    clusterDigests.add(cluster.clusterSha256);
    clusterRepresentativeIds.add(cluster.representativeItemId);
    const representative = representatives.get(cluster.representativeItemId);
    if (
      representative === undefined ||
      representative.topicKey !== cluster.topicKey ||
      representative.eventType !== cluster.eventType ||
      representative.stance !== cluster.stance ||
      representative.contentSha256 !== cluster.effectiveContentSha256 ||
      !cluster.memberItemIds.includes(representative.itemId) ||
      !cluster.publisherIds.includes(representative.publisherId) ||
      !cluster.sourceIds.includes(representative.sourceId)
    ) {
      throw new Error("Linkage cluster representative does not match");
    }
    const expectedCluster = await sha256CanonicalIntelligence({
      schemaVersion: "external-intelligence-evidence-cluster-v1",
      topicKey: cluster.topicKey,
      entityKeys: cluster.entityKeys,
      tradable: cluster.tradable,
      eventType: cluster.eventType,
      stance: cluster.stance,
      effectiveContentSha256: cluster.effectiveContentSha256,
      representativeItemId: cluster.representativeItemId,
      memberItemIds: cluster.memberItemIds,
      publisherIds: cluster.publisherIds,
      sourceIds: cluster.sourceIds,
      correctionSha256s: cluster.correctionSha256s,
    });
    if (expectedCluster !== cluster.clusterSha256) {
      throw new Error("External intelligence linkage cluster digest does not match");
    }
  }
  const expected = await sha256CanonicalIntelligence({
    schemaVersion: linkage.schemaVersion,
    linkedAtMs: linkage.linkedAtMs,
    topicRegistrySha256: linkage.topicRegistrySha256,
    clusters: linkage.clusters,
    representativeItems: linkage.representativeItems,
    inactiveItems: linkage.inactiveItems,
  });
  if (expected !== linkage.linkageSha256) {
    throw new Error("External intelligence linkage digest does not match");
  }
}

async function verifyRepostCluster(
  cluster: ExternalIntelligenceRepostCluster,
): Promise<void> {
  assertDigest("repostClusterSha256", cluster.repostClusterSha256);
  assertCanonicalText("topicKey", cluster.topicKey);
  assertCanonicalText("representativeItemId", cluster.representativeItemId);
  if (!EVENT_TYPES.has(cluster.eventType) || !STANCES.has(cluster.stance)) {
    throw new Error("Repost cluster classification is invalid");
  }
  if (cluster.evidenceClusterSha256s.length < 1) {
    throw new Error("Repost cluster must reference evidence");
  }
  assertSortedUnique(
    "evidenceClusterSha256s",
    cluster.evidenceClusterSha256s,
  );
  assertSortedUniqueText("memberItemIds", cluster.memberItemIds);
  assertSortedUniqueText("publisherIds", cluster.publisherIds);
  assertSortedUniqueText("sourceIds", cluster.sourceIds);
  if (
    cluster.corroborationUnitCount !== 1 ||
    !Number.isSafeInteger(cluster.maximumPublicationSkewMs) ||
    cluster.maximumPublicationSkewMs < 0 ||
    (cluster.minimumPairSimilarityBps !== null &&
      (!Number.isSafeInteger(cluster.minimumPairSimilarityBps) ||
        cluster.minimumPairSimilarityBps < 0 ||
        cluster.minimumPairSimilarityBps > 10_000)) ||
    (cluster.evidenceClusterSha256s.length === 1) !==
      (cluster.minimumPairSimilarityBps === null) ||
    (cluster.evidenceClusterSha256s.length === 1
      ? cluster.maximumPublicationSkewMs !== 0
      : false)
  ) {
    throw new Error("Repost cluster metrics are invalid");
  }
  if (
    (cluster.coordinationSignal === "none" &&
      cluster.handling !== "single-evidence-unit") ||
    (cluster.coordinationSignal === "rapid-multi-publisher-repost" &&
      (cluster.handling !== "watch-only" || cluster.publisherIds.length < 2)) ||
    (cluster.coordinationSignal !== "none" &&
      cluster.coordinationSignal !== "rapid-multi-publisher-repost")
  ) {
    throw new Error("Repost cluster coordination handling is invalid");
  }
  const expected = await sha256CanonicalIntelligence({
    schemaVersion: "external-intelligence-repost-cluster-v1",
    topicKey: cluster.topicKey,
    eventType: cluster.eventType,
    stance: cluster.stance,
    representativeItemId: cluster.representativeItemId,
    evidenceClusterSha256s: cluster.evidenceClusterSha256s,
    memberItemIds: cluster.memberItemIds,
    publisherIds: cluster.publisherIds,
    sourceIds: cluster.sourceIds,
    minimumPairSimilarityBps: cluster.minimumPairSimilarityBps,
    maximumPublicationSkewMs: cluster.maximumPublicationSkewMs,
    corroborationUnitCount: cluster.corroborationUnitCount,
    coordinationSignal: cluster.coordinationSignal,
    handling: cluster.handling,
  });
  if (expected !== cluster.repostClusterSha256) {
    throw new Error("External intelligence repost-cluster digest does not match");
  }
}

export async function verifyExternalIntelligenceManipulationEvidenceArtifact(
  evidence: ExternalIntelligenceManipulationEvidence,
): Promise<void> {
  if (
    evidence.schemaVersion !==
    "external-intelligence-manipulation-evidence-v1"
  ) {
    throw new Error("Unsupported manipulation-evidence schema");
  }
  assertTime("analysedAtMs", evidence.analysedAtMs);
  assertDigest("linkageSha256", evidence.linkageSha256);
  assertDigest("policySha256", evidence.policySha256);
  assertDigest("evidenceSha256", evidence.evidenceSha256);
  if (
    evidence.repostClusters.length < 1 ||
    evidence.repostClusters.length > 500 ||
    evidence.representativeItems.length !== evidence.repostClusters.length
  ) {
    throw new Error("Manipulation clusters and representatives must form a bounded bijection");
  }
  await Promise.all(evidence.repostClusters.map(verifyRepostCluster));
  const clusterDigests = evidence.repostClusters.map(
    (cluster) => cluster.repostClusterSha256,
  );
  if (new Set(clusterDigests).size !== clusterDigests.length) {
    throw new Error("Manipulation evidence contains duplicate clusters");
  }
  const representatives = new Set(
    evidence.representativeItems.map((item) => item.itemId),
  );
  if (representatives.size !== evidence.representativeItems.length) {
    throw new Error("Manipulation evidence contains duplicate representatives");
  }
  const expected = await sha256CanonicalIntelligence({
    schemaVersion: evidence.schemaVersion,
    analysedAtMs: evidence.analysedAtMs,
    linkageSha256: evidence.linkageSha256,
    policySha256: evidence.policySha256,
    repostClusters: evidence.repostClusters,
    representativeItems: evidence.representativeItems,
  });
  if (expected !== evidence.evidenceSha256) {
    throw new Error("External intelligence manipulation-evidence digest does not match");
  }
}

function sortedUnion(
  values: readonly (readonly string[])[],
): readonly string[] {
  return [...new Set(values.flat())].sort();
}

async function verifyCrossArtifactBinding(
  linkage: ExternalIntelligenceLinkage,
  evidence: ExternalIntelligenceManipulationEvidence,
): Promise<void> {
  if (
    evidence.linkageSha256 !== linkage.linkageSha256 ||
    evidence.analysedAtMs < linkage.linkedAtMs
  ) {
    throw new Error("Assessment integration provenance or chronology is invalid");
  }
  const linkageClusters = new Map(
    linkage.clusters.map((cluster) => [cluster.clusterSha256, cluster]),
  );
  const linkageRepresentatives = new Map(
    linkage.representativeItems.map((item) => [item.itemId, item]),
  );
  const evidenceRepresentatives = new Map(
    evidence.representativeItems.map((item) => [item.itemId, item]),
  );
  const usedEvidenceClusters = new Set<string>();
  const usedRepresentatives = new Set<string>();
  for (const repost of evidence.repostClusters) {
    const members = repost.evidenceClusterSha256s.map((digest) => {
      const cluster = linkageClusters.get(digest);
      if (cluster === undefined || usedEvidenceClusters.has(digest)) {
        throw new Error("Manipulation evidence does not partition linkage clusters");
      }
      usedEvidenceClusters.add(digest);
      if (
        cluster.topicKey !== repost.topicKey ||
        cluster.eventType !== repost.eventType ||
        cluster.stance !== repost.stance
      ) {
        throw new Error("Repost cluster classification does not match linkage");
      }
      return cluster;
    });
    if (
      !canonicalEqual(
        repost.memberItemIds,
        sortedUnion(members.map((cluster) => cluster.memberItemIds)),
      ) ||
      !canonicalEqual(
        repost.publisherIds,
        sortedUnion(members.map((cluster) => cluster.publisherIds)),
      ) ||
      !canonicalEqual(
        repost.sourceIds,
        sortedUnion(members.map((cluster) => cluster.sourceIds)),
      )
    ) {
      throw new Error("Repost cluster membership does not match linkage");
    }
    const representative = evidenceRepresentatives.get(
      repost.representativeItemId,
    );
    const linkageRepresentative = linkageRepresentatives.get(
      repost.representativeItemId,
    );
    if (
      representative === undefined ||
      linkageRepresentative === undefined ||
      !members.some(
        (cluster) =>
          cluster.representativeItemId === repost.representativeItemId,
      ) ||
      !canonicalEqual(representative, linkageRepresentative) ||
      usedRepresentatives.has(repost.representativeItemId)
    ) {
      throw new Error("Repost representative is not bound to linkage");
    }
    usedRepresentatives.add(repost.representativeItemId);
  }
  if (
    usedEvidenceClusters.size !== linkageClusters.size ||
    usedRepresentatives.size !== evidenceRepresentatives.size
  ) {
    throw new Error("Manipulation evidence and linkage do not form exact partitions");
  }
}

function groupKey(cluster: ExternalIntelligenceRepostCluster): string {
  return `${cluster.topicKey}\u001f${cluster.eventType}\u001f${cluster.stance}`;
}

function remainsActionable(
  cluster: ExternalIntelligenceRepostCluster,
  item: ExternalIntelligenceItem,
): boolean {
  if (cluster.handling === "single-evidence-unit") return true;
  return (
    cluster.stance === "negative" &&
    SEVERE_RISK_EVENTS.has(cluster.eventType) &&
    item.authority === "authoritative"
  );
}

export async function prepareIntegratedExternalIntelligenceAssessments(
  input: ExternalIntelligenceAssessmentIntegrationInput,
): Promise<readonly IntegratedExternalIntelligenceAssessment[]> {
  assertTime("assessedAtMs", input.assessedAtMs);
  await verifyExternalIntelligenceLinkageArtifact(input.linkage);
  await verifyExternalIntelligenceManipulationEvidenceArtifact(
    input.manipulationEvidence,
  );
  await verifyCrossArtifactBinding(input.linkage, input.manipulationEvidence);
  if (
    input.assessedAtMs < input.manipulationEvidence.analysedAtMs
  ) {
    throw new Error("Assessment integration provenance or chronology is invalid");
  }

  const representatives = new Map(
    input.manipulationEvidence.representativeItems.map((item) => [
      item.itemId,
      item,
    ]),
  );
  if (
    representatives.size !==
    input.manipulationEvidence.representativeItems.length
  ) {
    throw new Error("Manipulation evidence has duplicate representatives");
  }
  const groups = new Map<
    string,
    { clusters: ExternalIntelligenceRepostCluster[]; items: ExternalIntelligenceItem[] }
  >();
  for (const cluster of input.manipulationEvidence.repostClusters) {
    const item = representatives.get(cluster.representativeItemId);
    if (
      item === undefined ||
      item.topicKey !== cluster.topicKey ||
      item.eventType !== cluster.eventType ||
      item.stance !== cluster.stance
    ) {
      throw new Error("Repost cluster representative does not match");
    }
    const key = groupKey(cluster);
    const group = groups.get(key) ?? { clusters: [], items: [] };
    group.clusters.push(cluster);
    group.items.push(item);
    groups.set(key, group);
  }
  if (
    [...groups.values()].reduce((sum, group) => sum + group.items.length, 0) !==
    representatives.size
  ) {
    throw new Error("Repost clusters and representatives must form a bijection");
  }
  if (groups.size < 1 || groups.size > MAXIMUM_ASSESSMENTS) {
    throw new Error(`Integrated assessments must contain 1 to ${MAXIMUM_ASSESSMENTS} groups`);
  }

  const assessmentPolicySha256 = await sha256CanonicalIntelligence({
    schemaVersion: "external-intelligence-policy-v1",
    ...input.policy,
  });
  const integrated = await Promise.all(
    [...groups.entries()].map(async ([, group]) => {
      const actionable = group.clusters.filter((cluster, index) => {
        const item = group.items[index];
        return item !== undefined && remainsActionable(cluster, item);
      });
      const actionableIds = new Set(
        actionable.map((cluster) => cluster.representativeItemId),
      );
      const assessmentItems =
        actionable.length > 0
          ? group.items.filter((item) => actionableIds.has(item.itemId))
          : group.items;
      const first = group.clusters[0];
      if (first === undefined) throw new Error("Empty assessment group");
      const assessment = await assessExternalIntelligence(
        first.topicKey,
        first.eventType,
        first.stance,
        assessmentItems,
        input.assessedAtMs,
        input.policy,
      );
      const watchOnly = group.clusters.filter(
        (cluster) => !actionableIds.has(cluster.representativeItemId),
      );
      const effectiveReaction =
        actionable.length === 0 ? "watch" : assessment.reaction;
      const warnings =
        watchOnly.length === 0
          ? []
          : ["rapid-repost evidence excluded from actionable corroboration"];
      const canonical = {
        schemaVersion: "integrated-external-intelligence-assessment-v1",
        assessedAtMs: input.assessedAtMs,
        linkageSha256: input.linkage.linkageSha256,
        manipulationEvidenceSha256:
          input.manipulationEvidence.evidenceSha256,
        manipulationPolicySha256: input.manipulationEvidence.policySha256,
        assessmentPolicySha256,
        assessment,
        effectiveReaction,
        actionableRepostClusterSha256s: actionable
          .map((cluster) => cluster.repostClusterSha256)
          .sort(),
        watchOnlyRepostClusterSha256s: watchOnly
          .map((cluster) => cluster.repostClusterSha256)
          .sort(),
        warnings,
      } as const;
      return {
        ...canonical,
        integrationSha256: await sha256CanonicalIntelligence(canonical),
      };
    }),
  );
  return integrated.sort((left, right) =>
    left.integrationSha256.localeCompare(right.integrationSha256),
  );
}

export async function verifyIntegratedExternalIntelligenceAssessment(
  integration: IntegratedExternalIntelligenceAssessment,
): Promise<void> {
  if (
    integration.schemaVersion !==
    "integrated-external-intelligence-assessment-v1"
  ) {
    throw new Error("Unsupported integrated-assessment schema");
  }
  assertTime("assessedAtMs", integration.assessedAtMs);
  assertDigest("integrationSha256", integration.integrationSha256);
  assertDigest("linkageSha256", integration.linkageSha256);
  assertDigest(
    "manipulationEvidenceSha256",
    integration.manipulationEvidenceSha256,
  );
  assertDigest("manipulationPolicySha256", integration.manipulationPolicySha256);
  assertDigest("assessmentPolicySha256", integration.assessmentPolicySha256);
  assertDigest("assessmentSha256", integration.assessment.assessmentSha256);
  if (!REACTIONS.has(integration.effectiveReaction)) {
    throw new Error("Integrated assessment reaction is invalid");
  }
  if (
    integration.warnings.length > 1 ||
    integration.warnings.some(
      (warning) =>
        warning !==
        "rapid-repost evidence excluded from actionable corroboration",
    )
  ) {
    throw new Error("Integrated assessment warnings are invalid");
  }
  assertSortedUnique(
    "actionableRepostClusterSha256s",
    integration.actionableRepostClusterSha256s,
  );
  assertSortedUnique(
    "watchOnlyRepostClusterSha256s",
    integration.watchOnlyRepostClusterSha256s,
  );
  const expected = await sha256CanonicalIntelligence({
    schemaVersion: integration.schemaVersion,
    assessedAtMs: integration.assessedAtMs,
    linkageSha256: integration.linkageSha256,
    manipulationEvidenceSha256: integration.manipulationEvidenceSha256,
    manipulationPolicySha256: integration.manipulationPolicySha256,
    assessmentPolicySha256: integration.assessmentPolicySha256,
    assessment: integration.assessment,
    effectiveReaction: integration.effectiveReaction,
    actionableRepostClusterSha256s:
      integration.actionableRepostClusterSha256s,
    watchOnlyRepostClusterSha256s:
      integration.watchOnlyRepostClusterSha256s,
    warnings: integration.warnings,
  });
  if (expected !== integration.integrationSha256) {
    throw new Error("Integrated external intelligence assessment digest does not match");
  }
}
