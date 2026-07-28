import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";
import type {
  ExternalIntelligenceItem,
  IntelligenceAuthority,
} from "./externalIntelligence.ts";
import type {
  ExternalIntelligenceEvidenceCluster,
  ExternalIntelligenceLinkage,
} from "./externalIntelligenceLinking.ts";
import { sha256Hex } from "../utils/crypto.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_CONTENT_BYTES = 65_536;
const MAXIMUM_FINGERPRINTS = 500;
const MAXIMUM_SHINGLES = 4_096;
const MAXIMUM_PUBLICATION_SKEW_MS = 7 * 24 * 60 * 60 * 1_000;
const SHINGLE_SIZE = 5;
const FINGERPRINT_VERSION =
  "external-intelligence-permitted-content-fingerprint-v1" as const;

export interface PermittedContentFingerprint {
  readonly schemaVersion: typeof FINGERPRINT_VERSION;
  readonly itemId: string;
  readonly effectiveContentSha256: string;
  readonly fingerprintedAtMs: number;
  readonly normalization: "nfkc-lower-alphanumeric-v1";
  readonly shingleSize: 5;
  readonly tokenCount: number;
  readonly shingleSha256s: readonly string[];
  readonly fingerprintSha256: string;
}

export interface CreatePermittedContentFingerprintInput {
  readonly item: ExternalIntelligenceItem;
  readonly permittedContent: string;
  readonly fingerprintedAtMs: number;
}

export interface ExternalIntelligenceManipulationPolicy {
  readonly minimumNearDuplicateSimilarityBps: number;
  readonly maximumNearDuplicatePublicationSkewMs: number;
  readonly rapidRepostWindowMs: number;
  readonly minimumRapidRepostPublishers: number;
}

export interface ExternalIntelligenceManipulationInput {
  readonly analysedAtMs: number;
  readonly linkage: ExternalIntelligenceLinkage;
  readonly policy: ExternalIntelligenceManipulationPolicy;
  readonly fingerprints: readonly PermittedContentFingerprint[];
}

export interface ExternalIntelligenceRepostCluster {
  readonly repostClusterSha256: string;
  readonly topicKey: string;
  readonly eventType: ExternalIntelligenceEvidenceCluster["eventType"];
  readonly stance: ExternalIntelligenceEvidenceCluster["stance"];
  readonly representativeItemId: string;
  readonly evidenceClusterSha256s: readonly string[];
  readonly memberItemIds: readonly string[];
  readonly publisherIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly minimumPairSimilarityBps: number | null;
  readonly maximumPublicationSkewMs: number;
  readonly corroborationUnitCount: 1;
  readonly coordinationSignal: "none" | "rapid-multi-publisher-repost";
  readonly handling: "single-evidence-unit" | "watch-only";
}

export interface ExternalIntelligenceManipulationEvidence {
  readonly schemaVersion: "external-intelligence-manipulation-evidence-v1";
  readonly analysedAtMs: number;
  readonly linkageSha256: string;
  readonly policySha256: string;
  readonly repostClusters: readonly ExternalIntelligenceRepostCluster[];
  readonly representativeItems: readonly ExternalIntelligenceItem[];
  readonly evidenceSha256: string;
}

interface EvidenceUnit {
  readonly cluster: ExternalIntelligenceEvidenceCluster;
  readonly representative: ExternalIntelligenceItem;
  readonly fingerprint: PermittedContentFingerprint | null;
}

const AUTHORITY_RANK: Readonly<Record<IntelligenceAuthority, number>> = {
  authoritative: 0,
  reputable: 1,
  social: 2,
};

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
    value.length === 0 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be canonical text`);
  }
}

function assertBasisPoints(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${name} must be integer basis points`);
  }
}

function contentCanBeFingerprinted(item: ExternalIntelligenceItem): boolean {
  return (
    item.sourceKind !== "reddit" &&
    (item.contentPolicy === "permitted-excerpt" ||
      item.contentPolicy === "permitted-full")
  );
}

function normalizeTokens(content: string): readonly string[] {
  const normalized = content
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/https?:\/\/[^\s]+/gu, " ");
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

async function hashShingles(tokens: readonly string[]): Promise<readonly string[]> {
  if (tokens.length < SHINGLE_SIZE) {
    throw new Error(`permittedContent must contain at least ${SHINGLE_SIZE} tokens`);
  }
  const count = tokens.length - SHINGLE_SIZE + 1;
  if (count > MAXIMUM_SHINGLES) {
    throw new Error(`permittedContent cannot exceed ${MAXIMUM_SHINGLES} shingles`);
  }
  const digests = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      sha256Hex(tokens.slice(index, index + SHINGLE_SIZE).join("\u001f")),
    ),
  );
  return [...new Set(digests)].sort();
}

export async function createPermittedContentFingerprint(
  input: CreatePermittedContentFingerprintInput,
): Promise<PermittedContentFingerprint> {
  const { item } = input;
  assertCanonicalText("itemId", item.itemId);
  assertDigest("contentSha256", item.contentSha256);
  assertTime("fingerprintedAtMs", input.fingerprintedAtMs);
  if (!contentCanBeFingerprinted(item)) {
    throw new Error(
      `${item.itemId} content policy does not permit durable fingerprinting`,
    );
  }
  if (
    input.fingerprintedAtMs < item.availableAtMs ||
    item.modelTrainingAllowed !== false
  ) {
    throw new Error(`${item.itemId} has invalid fingerprint chronology or use`);
  }
  const byteLength = new TextEncoder().encode(input.permittedContent).byteLength;
  if (byteLength < 1 || byteLength > MAXIMUM_CONTENT_BYTES) {
    throw new Error(
      `permittedContent must contain 1 to ${MAXIMUM_CONTENT_BYTES} bytes`,
    );
  }
  const contentSha256 = await sha256Hex(input.permittedContent);
  if (contentSha256 !== item.contentSha256) {
    throw new Error(`${item.itemId} permittedContent digest does not match`);
  }
  const tokens = normalizeTokens(input.permittedContent);
  const shingleSha256s = await hashShingles(tokens);
  const canonical = {
    schemaVersion: FINGERPRINT_VERSION,
    itemId: item.itemId,
    effectiveContentSha256: item.contentSha256,
    fingerprintedAtMs: input.fingerprintedAtMs,
    normalization: "nfkc-lower-alphanumeric-v1",
    shingleSize: SHINGLE_SIZE,
    tokenCount: tokens.length,
    shingleSha256s,
  } as const;
  return {
    ...canonical,
    fingerprintSha256: await sha256CanonicalIntelligence(canonical),
  };
}

async function verifyLinkage(linkage: ExternalIntelligenceLinkage): Promise<void> {
  if (linkage.schemaVersion !== "external-intelligence-linkage-v1") {
    throw new Error("Unsupported external intelligence linkage schema");
  }
  assertTime("linkedAtMs", linkage.linkedAtMs);
  assertDigest("linkageSha256", linkage.linkageSha256);
  assertDigest("topicRegistrySha256", linkage.topicRegistrySha256);
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

function assertSortedUnique(
  name: string,
  values: readonly string[],
  maximum = 500,
): void {
  if (values.length < 1 || values.length > maximum) {
    throw new Error(`${name} must contain 1 to ${maximum} values`);
  }
  const sorted = [...values].sort();
  for (const value of sorted) assertCanonicalText(name, value);
  if (
    new Set(sorted).size !== sorted.length ||
    canonicalIntelligenceJson(sorted) !== canonicalIntelligenceJson(values)
  ) {
    throw new Error(`${name} must be sorted and unique`);
  }
}

async function verifyEvidenceCluster(
  cluster: ExternalIntelligenceEvidenceCluster,
  representative: ExternalIntelligenceItem,
): Promise<void> {
  assertDigest("clusterSha256", cluster.clusterSha256);
  assertDigest("effectiveContentSha256", cluster.effectiveContentSha256);
  assertSortedUnique("entityKeys", cluster.entityKeys, 50);
  assertSortedUnique("memberItemIds", cluster.memberItemIds);
  assertSortedUnique("publisherIds", cluster.publisherIds);
  assertSortedUnique("sourceIds", cluster.sourceIds);
  if (cluster.correctionSha256s.length > 500) {
    throw new Error("correctionSha256s cannot exceed 500 values");
  }
  const sortedCorrectionSha256s = [...cluster.correctionSha256s].sort();
  if (
    new Set(sortedCorrectionSha256s).size !==
      sortedCorrectionSha256s.length ||
    canonicalIntelligenceJson(sortedCorrectionSha256s) !==
      canonicalIntelligenceJson(cluster.correctionSha256s)
  ) {
    throw new Error("correctionSha256s must be sorted and unique");
  }
  for (const digest of sortedCorrectionSha256s) {
    assertDigest("correctionSha256", digest);
  }
  const expected = await sha256CanonicalIntelligence({
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
  if (expected !== cluster.clusterSha256) {
    throw new Error(`${cluster.representativeItemId} cluster digest does not match`);
  }
  if (
    representative.itemId !== cluster.representativeItemId ||
    representative.topicKey !== cluster.topicKey ||
    representative.eventType !== cluster.eventType ||
    representative.stance !== cluster.stance ||
    representative.contentSha256 !== cluster.effectiveContentSha256 ||
    !cluster.memberItemIds.includes(representative.itemId) ||
    !cluster.publisherIds.includes(representative.publisherId) ||
    !cluster.sourceIds.includes(representative.sourceId)
  ) {
    throw new Error(
      `${cluster.representativeItemId} cluster representative does not match`,
    );
  }
}

async function verifyFingerprint(
  fingerprint: PermittedContentFingerprint,
  representative: ExternalIntelligenceItem,
  analysedAtMs: number,
): Promise<void> {
  if (
    fingerprint.schemaVersion !== FINGERPRINT_VERSION ||
    fingerprint.normalization !== "nfkc-lower-alphanumeric-v1" ||
    fingerprint.shingleSize !== SHINGLE_SIZE
  ) {
    throw new Error(`${fingerprint.itemId} has unsupported fingerprint metadata`);
  }
  assertCanonicalText("fingerprint itemId", fingerprint.itemId);
  assertDigest("effectiveContentSha256", fingerprint.effectiveContentSha256);
  assertDigest("fingerprintSha256", fingerprint.fingerprintSha256);
  assertTime("fingerprintedAtMs", fingerprint.fingerprintedAtMs);
  if (
    fingerprint.fingerprintedAtMs < representative.availableAtMs ||
    fingerprint.fingerprintedAtMs > analysedAtMs
  ) {
    throw new Error(`${fingerprint.itemId} has invalid fingerprint chronology`);
  }
  if (
    fingerprint.itemId !== representative.itemId ||
    fingerprint.effectiveContentSha256 !== representative.contentSha256 ||
    !contentCanBeFingerprinted(representative)
  ) {
    throw new Error(`${fingerprint.itemId} is not bound to permitted effective content`);
  }
  if (
    !Number.isSafeInteger(fingerprint.tokenCount) ||
    fingerprint.tokenCount < SHINGLE_SIZE ||
    fingerprint.tokenCount > MAXIMUM_SHINGLES + SHINGLE_SIZE - 1 ||
    fingerprint.shingleSha256s.length < 1 ||
    fingerprint.shingleSha256s.length > MAXIMUM_SHINGLES ||
    fingerprint.shingleSha256s.length >
      fingerprint.tokenCount - SHINGLE_SIZE + 1
  ) {
    throw new Error(`${fingerprint.itemId} has invalid fingerprint bounds`);
  }
  const sorted = [...fingerprint.shingleSha256s].sort();
  if (
    new Set(sorted).size !== sorted.length ||
    canonicalIntelligenceJson(sorted) !==
      canonicalIntelligenceJson(fingerprint.shingleSha256s)
  ) {
    throw new Error(`${fingerprint.itemId} shingles must be sorted and unique`);
  }
  for (const digest of sorted) assertDigest("shingleSha256", digest);
  const expected = await sha256CanonicalIntelligence({
    schemaVersion: fingerprint.schemaVersion,
    itemId: fingerprint.itemId,
    effectiveContentSha256: fingerprint.effectiveContentSha256,
    fingerprintedAtMs: fingerprint.fingerprintedAtMs,
    normalization: fingerprint.normalization,
    shingleSize: fingerprint.shingleSize,
    tokenCount: fingerprint.tokenCount,
    shingleSha256s: fingerprint.shingleSha256s,
  });
  if (expected !== fingerprint.fingerprintSha256) {
    throw new Error(`${fingerprint.itemId} fingerprint digest does not match`);
  }
}

function preparePolicy(
  policy: ExternalIntelligenceManipulationPolicy,
): ExternalIntelligenceManipulationPolicy {
  assertBasisPoints(
    "minimumNearDuplicateSimilarityBps",
    policy.minimumNearDuplicateSimilarityBps,
  );
  if (policy.minimumNearDuplicateSimilarityBps < 5_000) {
    throw new Error("minimumNearDuplicateSimilarityBps cannot be below 5000");
  }
  assertTime(
    "maximumNearDuplicatePublicationSkewMs",
    policy.maximumNearDuplicatePublicationSkewMs,
  );
  assertTime("rapidRepostWindowMs", policy.rapidRepostWindowMs);
  if (
    policy.maximumNearDuplicatePublicationSkewMs < 1 ||
    policy.maximumNearDuplicatePublicationSkewMs >
      MAXIMUM_PUBLICATION_SKEW_MS ||
    policy.rapidRepostWindowMs < 1 ||
    policy.rapidRepostWindowMs >
      policy.maximumNearDuplicatePublicationSkewMs
  ) {
    throw new Error("Manipulation policy publication windows are invalid");
  }
  if (
    !Number.isSafeInteger(policy.minimumRapidRepostPublishers) ||
    policy.minimumRapidRepostPublishers < 2 ||
    policy.minimumRapidRepostPublishers > 50
  ) {
    throw new Error("minimumRapidRepostPublishers must be between 2 and 50");
  }
  return { ...policy };
}

function representativeOrder(left: EvidenceUnit, right: EvidenceUnit): number {
  return (
    AUTHORITY_RANK[left.representative.authority] -
      AUTHORITY_RANK[right.representative.authority] ||
    left.representative.publishedAtMs - right.representative.publishedAtMs ||
    left.representative.publisherId.localeCompare(
      right.representative.publisherId,
    ) ||
    left.representative.sourceId.localeCompare(right.representative.sourceId) ||
    left.representative.itemId.localeCompare(right.representative.itemId)
  );
}

function jaccardSimilarityBps(
  left: readonly string[],
  right: readonly string[],
): number {
  let leftIndex = 0;
  let rightIndex = 0;
  let intersection = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];
    if (leftValue === undefined || rightValue === undefined) break;
    const comparison = leftValue.localeCompare(rightValue);
    if (comparison === 0) {
      intersection += 1;
      leftIndex += 1;
      rightIndex += 1;
    } else if (comparison < 0) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  const union = left.length + right.length - intersection;
  return union === 0 ? 0 : Math.floor((intersection * 10_000) / union);
}

function pairSimilarityBps(
  left: EvidenceUnit,
  right: EvidenceUnit,
): number | null {
  if (
    left.cluster.topicKey !== right.cluster.topicKey ||
    left.cluster.eventType !== right.cluster.eventType ||
    left.cluster.stance !== right.cluster.stance ||
    left.fingerprint === null ||
    right.fingerprint === null
  ) {
    return null;
  }
  return jaccardSimilarityBps(
    left.fingerprint.shingleSha256s,
    right.fingerprint.shingleSha256s,
  );
}

function publicationSkewMs(left: EvidenceUnit, right: EvidenceUnit): number {
  return Math.abs(
    left.representative.publishedAtMs - right.representative.publishedAtMs,
  );
}

function canJoinCompleteLinkCluster(
  candidate: EvidenceUnit,
  members: readonly EvidenceUnit[],
  policy: ExternalIntelligenceManipulationPolicy,
): boolean {
  return members.every((member) => {
    const similarity = pairSimilarityBps(candidate, member);
    return (
      similarity !== null &&
      similarity >= policy.minimumNearDuplicateSimilarityBps &&
      publicationSkewMs(candidate, member) <=
        policy.maximumNearDuplicatePublicationSkewMs
    );
  });
}

async function prepareRepostCluster(
  members: readonly EvidenceUnit[],
  policy: ExternalIntelligenceManipulationPolicy,
): Promise<{
  readonly cluster: ExternalIntelligenceRepostCluster;
  readonly representative: ExternalIntelligenceItem;
}> {
  const ordered = [...members].sort(representativeOrder);
  const representative = ordered[0];
  if (representative === undefined) throw new Error("Empty repost cluster");
  const similarities: number[] = [];
  let maximumPublicationSkewMs = 0;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      const leftMember = ordered[left];
      const rightMember = ordered[right];
      if (leftMember === undefined || rightMember === undefined) continue;
      const similarity = pairSimilarityBps(leftMember, rightMember);
      if (similarity === null) {
        throw new Error("Repost cluster contains incomparable evidence");
      }
      similarities.push(similarity);
      maximumPublicationSkewMs = Math.max(
        maximumPublicationSkewMs,
        publicationSkewMs(leftMember, rightMember),
      );
    }
  }
  const publisherIds = [
    ...new Set(ordered.flatMap((member) => member.cluster.publisherIds)),
  ].sort();
  const coordinationSignal =
    ordered.length > 1 &&
    publisherIds.length >= policy.minimumRapidRepostPublishers &&
    maximumPublicationSkewMs <= policy.rapidRepostWindowMs
      ? "rapid-multi-publisher-repost"
      : "none";
  const canonical = {
    topicKey: representative.cluster.topicKey,
    eventType: representative.cluster.eventType,
    stance: representative.cluster.stance,
    representativeItemId: representative.representative.itemId,
    evidenceClusterSha256s: ordered
      .map((member) => member.cluster.clusterSha256)
      .sort(),
    memberItemIds: [
      ...new Set(ordered.flatMap((member) => member.cluster.memberItemIds)),
    ].sort(),
    publisherIds,
    sourceIds: [
      ...new Set(ordered.flatMap((member) => member.cluster.sourceIds)),
    ].sort(),
    minimumPairSimilarityBps:
      similarities.length === 0 ? null : Math.min(...similarities),
    maximumPublicationSkewMs,
    corroborationUnitCount: 1,
    coordinationSignal,
    handling:
      coordinationSignal === "rapid-multi-publisher-repost"
        ? "watch-only"
        : "single-evidence-unit",
  } as const;
  return {
    cluster: {
      ...canonical,
      repostClusterSha256: await sha256CanonicalIntelligence({
        schemaVersion: "external-intelligence-repost-cluster-v1",
        ...canonical,
      }),
    },
    representative: representative.representative,
  };
}

export async function prepareExternalIntelligenceManipulationEvidence(
  input: ExternalIntelligenceManipulationInput,
): Promise<ExternalIntelligenceManipulationEvidence> {
  assertTime("analysedAtMs", input.analysedAtMs);
  await verifyLinkage(input.linkage);
  if (input.analysedAtMs < input.linkage.linkedAtMs) {
    throw new Error("analysedAtMs cannot predate linkage");
  }
  if (input.fingerprints.length > MAXIMUM_FINGERPRINTS) {
    throw new Error(`fingerprints cannot exceed ${MAXIMUM_FINGERPRINTS}`);
  }
  const policy = preparePolicy(input.policy);
  const policySha256 = await sha256CanonicalIntelligence({
    schemaVersion: "external-intelligence-manipulation-policy-v1",
    ...policy,
  });

  const representativesById = new Map(
    input.linkage.representativeItems.map((item) => [item.itemId, item]),
  );
  if (
    representativesById.size !== input.linkage.representativeItems.length
  ) {
    throw new Error("Linkage contains duplicate representative item IDs");
  }
  const fingerprintsByItem = new Map<string, PermittedContentFingerprint>();
  for (const fingerprint of input.fingerprints) {
    if (fingerprintsByItem.has(fingerprint.itemId)) {
      throw new Error(`Duplicate fingerprint for ${fingerprint.itemId}`);
    }
    const representative = representativesById.get(fingerprint.itemId);
    if (representative === undefined) {
      throw new Error(`Fingerprint references non-representative ${fingerprint.itemId}`);
    }
    await verifyFingerprint(fingerprint, representative, input.analysedAtMs);
    fingerprintsByItem.set(fingerprint.itemId, fingerprint);
  }

  const units: EvidenceUnit[] = [];
  const clusterDigests = new Set<string>();
  const clusterRepresentativeIds = new Set<string>();
  for (const cluster of input.linkage.clusters) {
    if (clusterDigests.has(cluster.clusterSha256)) {
      throw new Error(`Duplicate linkage cluster ${cluster.clusterSha256}`);
    }
    clusterDigests.add(cluster.clusterSha256);
    if (clusterRepresentativeIds.has(cluster.representativeItemId)) {
      throw new Error(
        `Duplicate cluster representative ${cluster.representativeItemId}`,
      );
    }
    clusterRepresentativeIds.add(cluster.representativeItemId);
    const representative = representativesById.get(cluster.representativeItemId);
    if (representative === undefined) {
      throw new Error(
        `Missing representative ${cluster.representativeItemId} for cluster`,
      );
    }
    await verifyEvidenceCluster(cluster, representative);
    const fingerprint =
      fingerprintsByItem.get(representative.itemId) ?? null;
    if (contentCanBeFingerprinted(representative) !== (fingerprint !== null)) {
      throw new Error(
        `${representative.itemId} permitted fingerprint coverage is incomplete`,
      );
    }
    units.push({ cluster, representative, fingerprint });
  }
  if (units.length !== input.linkage.representativeItems.length) {
    throw new Error("Linkage clusters and representatives do not form a bijection");
  }
  units.sort((left, right) =>
    left.cluster.clusterSha256.localeCompare(right.cluster.clusterSha256),
  );

  const groups: EvidenceUnit[][] = [];
  for (const unit of units) {
    const target = groups.find((members) =>
      canJoinCompleteLinkCluster(unit, members, policy),
    );
    if (target === undefined) groups.push([unit]);
    else target.push(unit);
  }

  const prepared = await Promise.all(
    groups.map((members) => prepareRepostCluster(members, policy)),
  );
  const repostClusters = prepared
    .map((value) => value.cluster)
    .sort((left, right) =>
      left.repostClusterSha256.localeCompare(right.repostClusterSha256),
    );
  const representativeItems = prepared
    .map((value) => value.representative)
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  const canonical = {
    schemaVersion: "external-intelligence-manipulation-evidence-v1",
    analysedAtMs: input.analysedAtMs,
    linkageSha256: input.linkage.linkageSha256,
    policySha256,
    repostClusters,
    representativeItems,
  } as const;
  return {
    ...canonical,
    evidenceSha256: await sha256CanonicalIntelligence(canonical),
  };
}
