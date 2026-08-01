import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";
import type {
  ExternalIntelligenceItem,
  IntelligenceAuthority,
  IntelligenceEventType,
  IntelligenceStance,
} from "./externalIntelligence.ts";
import {
  verifyExternalIntelligenceCorrection,
  type ExternalIntelligenceCorrection,
} from "./externalIntelligenceRecords.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_ITEMS = 500;
const MAXIMUM_CORRECTIONS = 500;
const MAXIMUM_TOPIC_RULES = 500;
const EVENT_TYPES = new Set<IntelligenceEventType>([
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
const STANCES = new Set<IntelligenceStance>([
  "positive",
  "negative",
  "neutral",
  "uncertain",
]);
const AUTHORITY_BY_SOURCE = {
  "official-exchange": "authoritative",
  regulator: "authoritative",
  issuer: "authoritative",
  "mainstream-news": "reputable",
  "specialist-news": "reputable",
  reddit: "social",
} as const;

export interface ExternalIntelligenceTopicRule {
  readonly topicKey: string;
  readonly entityKeys: readonly string[];
  readonly tradable: boolean;
  readonly allowedEventTypes: readonly IntelligenceEventType[];
}

export interface ExternalIntelligenceLinkingInput {
  readonly linkedAtMs: number;
  readonly topicRules: readonly ExternalIntelligenceTopicRule[];
  readonly items: readonly ExternalIntelligenceItem[];
  readonly corrections: readonly ExternalIntelligenceCorrection[];
}

export interface ExternalIntelligenceEvidenceCluster {
  readonly clusterSha256: string;
  readonly topicKey: string;
  readonly entityKeys: readonly string[];
  readonly tradable: boolean;
  readonly eventType: IntelligenceEventType;
  readonly stance: IntelligenceStance;
  readonly effectiveContentSha256: string;
  readonly representativeItemId: string;
  readonly memberItemIds: readonly string[];
  readonly publisherIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly correctionSha256s: readonly string[];
}

export interface InactiveExternalIntelligenceEvidence {
  readonly itemId: string;
  readonly correctionSha256s: readonly string[];
}

export interface ExternalIntelligenceLinkage {
  readonly schemaVersion: "external-intelligence-linkage-v1";
  readonly linkedAtMs: number;
  readonly topicRegistrySha256: string;
  readonly clusters: readonly ExternalIntelligenceEvidenceCluster[];
  readonly representativeItems: readonly ExternalIntelligenceItem[];
  readonly inactiveItems: readonly InactiveExternalIntelligenceEvidence[];
  readonly linkageSha256: string;
}

interface EffectiveItem {
  readonly item: ExternalIntelligenceItem;
  readonly correctionSha256s: readonly string[];
}

interface EffectiveItemResult {
  readonly effective: EffectiveItem | null;
  readonly correctionSha256s: readonly string[];
}

const AUTHORITY_RANK: Readonly<Record<IntelligenceAuthority, number>> = {
  authoritative: 0,
  reputable: 1,
  social: 2,
};

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

function uniqueSorted(
  values: readonly string[],
  name: string,
): readonly string[] {
  if (values.length < 1 || values.length > 50) {
    throw new Error(`${name} must contain 1 to 50 values`);
  }
  const sorted = [...values].sort();
  for (const value of sorted) assertCanonicalText(name, value);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`${name} contains duplicates`);
  }
  return sorted;
}

function prepareTopicRules(
  rules: readonly ExternalIntelligenceTopicRule[],
): readonly ExternalIntelligenceTopicRule[] {
  if (rules.length < 1 || rules.length > MAXIMUM_TOPIC_RULES) {
    throw new Error(`topicRules must contain 1 to ${MAXIMUM_TOPIC_RULES} rules`);
  }
  const prepared = rules
    .map((rule) => {
      assertCanonicalText("topicKey", rule.topicKey);
      const entityKeys = uniqueSorted(rule.entityKeys, "entityKey");
      const allowedEventTypes = [...rule.allowedEventTypes].sort();
      if (
        allowedEventTypes.length < 1 ||
        new Set(allowedEventTypes).size !== allowedEventTypes.length ||
        allowedEventTypes.some((eventType) => !EVENT_TYPES.has(eventType))
      ) {
        throw new Error(
          `${rule.topicKey} allowedEventTypes must be supported, non-empty and unique`,
        );
      }
      if (typeof rule.tradable !== "boolean") {
        throw new Error(`${rule.topicKey} tradable must be boolean`);
      }
      return {
        topicKey: rule.topicKey,
        entityKeys,
        tradable: rule.tradable,
        allowedEventTypes,
      };
    })
    .sort((left, right) => left.topicKey.localeCompare(right.topicKey));
  if (new Set(prepared.map((rule) => rule.topicKey)).size !== prepared.length) {
    throw new Error("topicRules contains duplicate topicKey values");
  }
  return prepared;
}

function validateItem(
  item: ExternalIntelligenceItem,
  linkedAtMs: number,
  rule: ExternalIntelligenceTopicRule,
): void {
  for (const [name, value] of [
    ["itemId", item.itemId],
    ["sourceId", item.sourceId],
    ["publisherId", item.publisherId],
    ["externalId", item.externalId],
    ["topicKey", item.topicKey],
  ] as const) {
    assertCanonicalText(name, value);
  }
  assertDigest("payloadSha256", item.payloadSha256);
  assertDigest("contentSha256", item.contentSha256);
  assertTime("publishedAtMs", item.publishedAtMs);
  assertTime("receivedAtMs", item.receivedAtMs);
  assertTime("availableAtMs", item.availableAtMs);
  if (
    item.publishedAtMs > item.receivedAtMs ||
    item.receivedAtMs > item.availableAtMs ||
    item.availableAtMs > linkedAtMs
  ) {
    throw new Error(`${item.itemId} has invalid linkage chronology`);
  }
  if (
    AUTHORITY_BY_SOURCE[item.sourceKind] !== item.authority ||
    !STANCES.has(item.stance)
  ) {
    throw new Error(`${item.itemId} has invalid source authority or stance`);
  }
  if (item.modelTrainingAllowed !== false) {
    throw new Error(`${item.itemId} cannot permit model training`);
  }
  const entityKeys = uniqueSorted(item.assetSymbols, "asset symbol");
  if (
    entityKeys.some(
      (entityKey) =>
        entityKey !== entityKey.toUpperCase() ||
        !/^[A-Z0-9.]+$/u.test(entityKey),
    )
  ) {
    throw new Error(`${item.itemId} has an invalid entity key`);
  }
  if (
    canonicalIntelligenceJson(entityKeys) !==
    canonicalIntelligenceJson(rule.entityKeys)
  ) {
    throw new Error(`${item.itemId} does not match its reviewed entity rule`);
  }
  if (!rule.allowedEventTypes.includes(item.eventType)) {
    throw new Error(`${item.itemId} uses an unapproved event type`);
  }
}

function representativeOrder(left: EffectiveItem, right: EffectiveItem): number {
  return (
    AUTHORITY_RANK[left.item.authority] -
      AUTHORITY_RANK[right.item.authority] ||
    left.item.publishedAtMs - right.item.publishedAtMs ||
    left.item.publisherId.localeCompare(right.item.publisherId) ||
    left.item.sourceId.localeCompare(right.item.sourceId) ||
    left.item.externalId.localeCompare(right.item.externalId) ||
    left.item.itemId.localeCompare(right.item.itemId)
  );
}

async function effectiveItem(
  item: ExternalIntelligenceItem,
  corrections: readonly ExternalIntelligenceCorrection[],
  linkedAtMs: number,
): Promise<EffectiveItemResult> {
  let payloadSha256 = item.payloadSha256;
  let contentSha256 = item.contentSha256;
  let terminal = false;
  const correctionSha256s: string[] = [];
  const ordered = [...corrections].sort(
    (left, right) =>
      left.observedAtMs - right.observedAtMs ||
      left.correctionSha256.localeCompare(right.correctionSha256),
  );
  for (let index = 0; index < ordered.length; index += 1) {
    const correction = ordered[index];
    if (correction === undefined) continue;
    await verifyExternalIntelligenceCorrection(correction);
    if (
      correction.itemId !== item.itemId ||
      correction.sourceId !== item.sourceId ||
      correction.externalId !== item.externalId
    ) {
      throw new Error(`${item.itemId} has a mismatched correction identity`);
    }
    if (
      correction.observedAtMs < item.availableAtMs ||
      correction.observedAtMs > linkedAtMs
    ) {
      throw new Error(`${item.itemId} has invalid correction chronology`);
    }
    const next = ordered[index + 1];
    if (
      next !== undefined &&
      next.observedAtMs === correction.observedAtMs &&
      next.correctionSha256 !== correction.correctionSha256
    ) {
      throw new Error(`${item.itemId} has conflicting simultaneous corrections`);
    }
    if (terminal) {
      throw new Error(`${item.itemId} has a correction after terminal removal`);
    }
    if (correction.correctionKind === "content-update") {
      const replacementPayloadSha256 = correction.replacementPayloadSha256;
      const replacementContentSha256 = correction.replacementContentSha256;
      if (
        replacementPayloadSha256 === null ||
        replacementContentSha256 === null
      ) {
        throw new Error(`${item.itemId} has an incomplete content update`);
      }
      if (
        replacementPayloadSha256 === payloadSha256 &&
        replacementContentSha256 === contentSha256
      ) {
        throw new Error(`${item.itemId} has a no-op content update`);
      }
      payloadSha256 = replacementPayloadSha256;
      contentSha256 = replacementContentSha256;
    } else {
      terminal = true;
    }
    correctionSha256s.push(correction.correctionSha256);
  }
  if (terminal) return { effective: null, correctionSha256s };
  return {
    effective: {
      item: { ...item, payloadSha256, contentSha256 },
      correctionSha256s,
    },
    correctionSha256s,
  };
}

export async function prepareExternalIntelligenceLinkage(
  input: ExternalIntelligenceLinkingInput,
): Promise<ExternalIntelligenceLinkage> {
  assertTime("linkedAtMs", input.linkedAtMs);
  if (input.items.length < 1 || input.items.length > MAXIMUM_ITEMS) {
    throw new Error(`items must contain 1 to ${MAXIMUM_ITEMS} values`);
  }
  if (input.corrections.length > MAXIMUM_CORRECTIONS) {
    throw new Error(
      `corrections cannot exceed ${MAXIMUM_CORRECTIONS} values`,
    );
  }
  const topicRules = prepareTopicRules(input.topicRules);
  const topicRulesByKey = new Map(
    topicRules.map((rule) => [rule.topicKey, rule]),
  );
  const topicRegistrySha256 = await sha256CanonicalIntelligence({
    schemaVersion: "external-intelligence-topic-registry-v1",
    topicRules,
  });

  const itemsById = new Map<string, ExternalIntelligenceItem>();
  const naturalIdentities = new Map<string, ExternalIntelligenceItem>();
  for (const item of [...input.items].sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  )) {
    const rule = topicRulesByKey.get(item.topicKey);
    if (rule === undefined) {
      throw new Error(`${item.itemId} uses an unreviewed topicKey`);
    }
    validateItem(item, input.linkedAtMs, rule);
    const existingItem = itemsById.get(item.itemId);
    if (existingItem !== undefined) {
      if (
        canonicalIntelligenceJson(existingItem) !==
        canonicalIntelligenceJson(item)
      ) {
        throw new Error(`Changed intelligence item identity ${item.itemId}`);
      }
      continue;
    }
    itemsById.set(item.itemId, item);
    const naturalIdentity = canonicalIntelligenceJson([
      item.publisherId,
      item.externalId,
    ]);
    const existingNatural = naturalIdentities.get(naturalIdentity);
    if (
      existingNatural !== undefined &&
      canonicalIntelligenceJson(existingNatural) !==
        canonicalIntelligenceJson(item)
    ) {
      throw new Error(
        `Intelligence natural identity conflict ${naturalIdentity}`,
      );
    }
    naturalIdentities.set(naturalIdentity, item);
  }

  const correctionsByItem = new Map<
    string,
    ExternalIntelligenceCorrection[]
  >();
  const correctionsByIdentity = new Map<
    string,
    ExternalIntelligenceCorrection
  >();
  for (const correction of input.corrections) {
    const existingCorrection = correctionsByIdentity.get(
      correction.correctionSha256,
    );
    if (existingCorrection !== undefined) {
      if (
        canonicalIntelligenceJson(existingCorrection) !==
        canonicalIntelligenceJson(correction)
      ) {
        throw new Error(
          `Changed correction identity ${correction.correctionSha256}`,
        );
      }
      continue;
    }
    correctionsByIdentity.set(correction.correctionSha256, correction);
    if (!itemsById.has(correction.itemId)) {
      throw new Error(
        `Correction references missing intelligence item ${correction.itemId}`,
      );
    }
    const values = correctionsByItem.get(correction.itemId) ?? [];
    values.push(correction);
    correctionsByItem.set(correction.itemId, values);
  }

  const inactiveItems: InactiveExternalIntelligenceEvidence[] = [];
  const effectiveItems: EffectiveItem[] = [];
  for (const item of itemsById.values()) {
    const result = await effectiveItem(
      item,
      correctionsByItem.get(item.itemId) ?? [],
      input.linkedAtMs,
    );
    if (result.effective === null) {
      inactiveItems.push({
        itemId: item.itemId,
        correctionSha256s: result.correctionSha256s,
      });
    } else {
      effectiveItems.push(result.effective);
    }
  }

  const grouped = new Map<string, EffectiveItem[]>();
  for (const effective of effectiveItems) {
    const item = effective.item;
    const key = canonicalIntelligenceJson({
      topicKey: item.topicKey,
      eventType: item.eventType,
      stance: item.stance,
      contentSha256: item.contentSha256,
    });
    const values = grouped.get(key) ?? [];
    values.push(effective);
    grouped.set(key, values);
  }

  const clusters: ExternalIntelligenceEvidenceCluster[] = [];
  const representativeItems: ExternalIntelligenceItem[] = [];
  for (const members of grouped.values()) {
    members.sort(representativeOrder);
    const representative = members[0];
    if (representative === undefined) continue;
    const item = representative.item;
    const rule = topicRulesByKey.get(item.topicKey);
    if (rule === undefined) throw new Error("Topic rule disappeared");
    const canonical = {
      topicKey: item.topicKey,
      entityKeys: rule.entityKeys,
      tradable: rule.tradable,
      eventType: item.eventType,
      stance: item.stance,
      effectiveContentSha256: item.contentSha256,
      representativeItemId: item.itemId,
      memberItemIds: members.map((member) => member.item.itemId).sort(),
      publisherIds: [
        ...new Set(members.map((member) => member.item.publisherId)),
      ].sort(),
      sourceIds: [
        ...new Set(members.map((member) => member.item.sourceId)),
      ].sort(),
      correctionSha256s: [
        ...new Set(members.flatMap((member) => member.correctionSha256s)),
      ].sort(),
    } as const;
    clusters.push({
      ...canonical,
      clusterSha256: await sha256CanonicalIntelligence({
        schemaVersion: "external-intelligence-evidence-cluster-v1",
        ...canonical,
      }),
    });
    representativeItems.push(item);
  }
  clusters.sort((left, right) =>
    left.clusterSha256.localeCompare(right.clusterSha256),
  );
  representativeItems.sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  );
  inactiveItems.sort((left, right) => left.itemId.localeCompare(right.itemId));
  const canonical = {
    schemaVersion: "external-intelligence-linkage-v1",
    linkedAtMs: input.linkedAtMs,
    topicRegistrySha256,
    clusters,
    representativeItems,
    inactiveItems,
  } as const;
  return {
    ...canonical,
    linkageSha256: await sha256CanonicalIntelligence(canonical),
  };
}
