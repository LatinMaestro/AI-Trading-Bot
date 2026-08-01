import { sha256Hex } from "../utils/crypto.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_ITEMS = 500;

export type IntelligenceSourceKind =
  | "official-exchange"
  | "regulator"
  | "issuer"
  | "mainstream-news"
  | "specialist-news"
  | "reddit";

export type IntelligenceAuthority = "authoritative" | "reputable" | "social";

export type IntelligenceAcquisitionMode =
  | "webhook"
  | "stream"
  | "minute-poll"
  | "scheduled-poll";

export type IntelligenceEventType =
  | "listing"
  | "delisting"
  | "trading-halt"
  | "security-incident"
  | "regulatory-action"
  | "network-incident"
  | "market-structure"
  | "macro"
  | "partnership"
  | "social-attention"
  | "rumour"
  | "other";

export type IntelligenceStance = "positive" | "negative" | "neutral" | "uncertain";

export type IntelligenceReaction =
  | "ignore"
  | "watch"
  | "research-candidate"
  | "pause-new-risk";

export type IntelligenceContentPolicy =
  | "digest-only"
  | "metadata-only"
  | "permitted-excerpt"
  | "permitted-full";

const SOURCE_KINDS = [
  "official-exchange",
  "regulator",
  "issuer",
  "mainstream-news",
  "specialist-news",
  "reddit",
] as const satisfies readonly IntelligenceSourceKind[];

const ACQUISITION_MODES = new Set<string>([
  "webhook",
  "stream",
  "minute-poll",
  "scheduled-poll",
]);
const EVENT_TYPES = new Set<string>([
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
const STANCES = new Set<string>(["positive", "negative", "neutral", "uncertain"]);
const CONTENT_POLICIES = new Set<string>([
  "digest-only",
  "metadata-only",
  "permitted-excerpt",
  "permitted-full",
]);

export interface ExternalIntelligenceItem {
  readonly itemId: string;
  readonly sourceId: string;
  readonly sourceKind: IntelligenceSourceKind;
  readonly authority: IntelligenceAuthority;
  readonly publisherId: string;
  readonly sourceRef: string;
  readonly externalId: string;
  readonly acquisitionMode: IntelligenceAcquisitionMode;
  readonly topicKey: string;
  readonly assetSymbols: readonly string[];
  readonly eventType: IntelligenceEventType;
  readonly stance: IntelligenceStance;
  readonly publishedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly payloadSha256: string;
  readonly contentSha256: string;
  readonly credibilityBps: number;
  readonly confidenceBps: number;
  readonly contentPolicy: IntelligenceContentPolicy;
  readonly modelTrainingAllowed: false;
}

export interface ExternalIntelligencePolicy {
  readonly maximumItemAgeMs: Readonly<Record<IntelligenceSourceKind, number>>;
  readonly maximumReceiptDelayMs: number;
  readonly minimumRiskOnPublishers: number;
  readonly minimumCredibilityBps: number;
  readonly maximumItems: number;
}

export interface RejectedIntelligenceItem {
  readonly itemId: string;
  readonly reason:
    | "stale"
    | "receipt-delay"
    | "low-credibility"
    | "neutral"
    | "uncertain";
}

export interface ExternalIntelligenceAssessment {
  readonly topicKey: string;
  readonly reaction: IntelligenceReaction;
  readonly eventType: IntelligenceEventType;
  readonly stance: IntelligenceStance;
  readonly acceptedItemIds: readonly string[];
  readonly acceptedEvidenceSha256: readonly string[];
  readonly rejectedItems: readonly RejectedIntelligenceItem[];
  readonly independentPublisherCount: number;
  readonly authoritativeSourceCount: number;
  readonly reputableSourceCount: number;
  readonly socialSourceCount: number;
  readonly earliestPublishedAtMs: number;
  readonly latestReceivedAtMs: number;
  readonly maximumPublicationToReceiptMs: number;
  readonly ageAtAssessmentMs: number;
  readonly assessmentSha256: string;
  readonly warnings: readonly string[];
}

const AUTHORITY_BY_SOURCE: Readonly<Record<IntelligenceSourceKind, IntelligenceAuthority>> = {
  "official-exchange": "authoritative",
  regulator: "authoritative",
  issuer: "authoritative",
  "mainstream-news": "reputable",
  "specialist-news": "reputable",
  reddit: "social",
};

const SEVERE_RISK_EVENTS = new Set<IntelligenceEventType>([
  "delisting",
  "trading-halt",
  "security-incident",
  "regulatory-action",
  "network-incident",
]);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot hash non-finite data");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Cannot hash unsupported data");
}

function assertCanonical(name: string, value: string): void {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${name} must be canonical text`);
  }
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertBps(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${name} must be an integer from 0 to 10000`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertSourceRef(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("sourceRef must be an absolute URL");
  }
  if (
    url.toString() !== value ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("sourceRef must be canonical credential-free HTTPS");
  }
}

function assertPolicy(policy: ExternalIntelligencePolicy): void {
  assertTime("maximumReceiptDelayMs", policy.maximumReceiptDelayMs);
  if (
    !Number.isInteger(policy.minimumRiskOnPublishers) ||
    policy.minimumRiskOnPublishers < 2 ||
    policy.minimumRiskOnPublishers > 20
  ) {
    throw new Error("minimumRiskOnPublishers must be an integer from 2 to 20");
  }
  assertBps("minimumCredibilityBps", policy.minimumCredibilityBps);
  if (
    !Number.isInteger(policy.maximumItems) ||
    policy.maximumItems < 1 ||
    policy.maximumItems > MAXIMUM_ITEMS
  ) {
    throw new Error(`maximumItems must be an integer from 1 to ${MAXIMUM_ITEMS}`);
  }
  const configuredSourceKinds = Object.keys(policy.maximumItemAgeMs).sort();
  const requiredSourceKinds = [...SOURCE_KINDS].sort();
  if (
    configuredSourceKinds.length !== requiredSourceKinds.length ||
    configuredSourceKinds.some(
      (sourceKind, index) => sourceKind !== requiredSourceKinds[index],
    )
  ) {
    throw new Error("maximumItemAgeMs must define every supported source kind exactly");
  }
  for (const sourceKind of SOURCE_KINDS) {
    assertTime(
      `${sourceKind} maximumItemAgeMs`,
      policy.maximumItemAgeMs[sourceKind],
    );
  }
}

function validateItem(item: ExternalIntelligenceItem, topicKey: string): void {
  if (!SOURCE_KINDS.includes(item.sourceKind)) {
    throw new Error("Unsupported intelligence source kind");
  }
  if (!ACQUISITION_MODES.has(item.acquisitionMode)) {
    throw new Error("Unsupported intelligence acquisition mode");
  }
  if (!EVENT_TYPES.has(item.eventType)) {
    throw new Error("Unsupported intelligence event type");
  }
  if (!STANCES.has(item.stance)) {
    throw new Error("Unsupported intelligence stance");
  }
  if (!CONTENT_POLICIES.has(item.contentPolicy)) {
    throw new Error("Unsupported intelligence content policy");
  }
  assertCanonical("itemId", item.itemId);
  assertCanonical("sourceId", item.sourceId);
  assertCanonical("publisherId", item.publisherId);
  assertCanonical("externalId", item.externalId);
  assertCanonical("topicKey", item.topicKey);
  if (item.topicKey !== topicKey) {
    throw new Error("All intelligence items must use the assessment topicKey");
  }
  assertSourceRef(item.sourceRef);
  assertTime("publishedAtMs", item.publishedAtMs);
  assertTime("receivedAtMs", item.receivedAtMs);
  assertTime("availableAtMs", item.availableAtMs);
  if (
    item.publishedAtMs > item.receivedAtMs ||
    item.receivedAtMs > item.availableAtMs
  ) {
    throw new Error(`${item.itemId} has invalid intelligence chronology`);
  }
  assertDigest("payloadSha256", item.payloadSha256);
  assertDigest("contentSha256", item.contentSha256);
  assertBps("credibilityBps", item.credibilityBps);
  assertBps("confidenceBps", item.confidenceBps);
  if (item.authority !== AUTHORITY_BY_SOURCE[item.sourceKind]) {
    throw new Error(`${item.sourceKind} has incompatible authority`);
  }
  if (item.modelTrainingAllowed !== false) {
    throw new Error("External intelligence content cannot be approved for model training");
  }
  if (item.assetSymbols.length === 0 || item.assetSymbols.length > 50) {
    throw new Error("assetSymbols must contain 1 to 50 values");
  }
  const symbols = item.assetSymbols.map((symbol) => {
    assertCanonical("asset symbol", symbol);
    if (symbol !== symbol.toUpperCase() || !/^[A-Z0-9.]+$/.test(symbol)) {
      throw new Error(`Invalid asset symbol ${symbol}`);
    }
    return symbol;
  });
  if (new Set(symbols).size !== symbols.length) {
    throw new Error(`${item.itemId} contains duplicate asset symbols`);
  }
  if (
    item.sourceKind === "reddit" &&
    item.contentPolicy === "permitted-full"
  ) {
    throw new Error("Reddit content cannot use permitted-full storage by default");
  }
}

function reactionFor(
  items: readonly ExternalIntelligenceItem[],
  policy: ExternalIntelligencePolicy,
): IntelligenceReaction {
  if (items.length === 0) return "ignore";
  const eventType = items[0]?.eventType;
  const stance = items[0]?.stance;
  if (eventType === undefined || stance === undefined) return "ignore";

  const authoritative = items.filter((item) => item.authority === "authoritative");
  const nonSocial = items.filter((item) => item.authority !== "social");
  const nonSocialPublishers = new Set(
    nonSocial.map((item) => item.publisherId),
  );

  if (
    stance === "negative" &&
    SEVERE_RISK_EVENTS.has(eventType) &&
    authoritative.length > 0
  ) {
    return "pause-new-risk";
  }
  if (
    stance === "negative" &&
    SEVERE_RISK_EVENTS.has(eventType) &&
    nonSocial.length >= 2 &&
    nonSocialPublishers.size >= 2
  ) {
    return "pause-new-risk";
  }
  if (
    stance === "positive" &&
    ((authoritative.length > 0 && nonSocial.length > 0) ||
      (nonSocial.length > 0 &&
        nonSocialPublishers.size >= policy.minimumRiskOnPublishers))
  ) {
    return "research-candidate";
  }
  return "watch";
}

export async function assessExternalIntelligence(
  topicKey: string,
  eventType: IntelligenceEventType,
  stance: IntelligenceStance,
  items: readonly ExternalIntelligenceItem[],
  assessedAtMs: number,
  policy: ExternalIntelligencePolicy,
): Promise<ExternalIntelligenceAssessment> {
  assertCanonical("topicKey", topicKey);
  assertTime("assessedAtMs", assessedAtMs);
  assertPolicy(policy);
  if (items.length < 1 || items.length > policy.maximumItems) {
    throw new Error(`Intelligence assessment requires 1 to ${policy.maximumItems} items`);
  }

  const identities = new Map<string, ExternalIntelligenceItem>();
  const itemIds = new Map<string, string>();
  const accepted: ExternalIntelligenceItem[] = [];
  const rejected: RejectedIntelligenceItem[] = [];

  for (const item of [...items].sort((left, right) =>
    `${left.publishedAtMs}:${left.publisherId}:${left.externalId}:${left.itemId}`.localeCompare(
      `${right.publishedAtMs}:${right.publisherId}:${right.externalId}:${right.itemId}`,
    ),
  )) {
    validateItem(item, topicKey);
    if (item.eventType !== eventType || item.stance !== stance) {
      throw new Error("All intelligence items must match eventType and stance");
    }
    if (item.availableAtMs > assessedAtMs) {
      throw new Error(`${item.itemId} was not available at assessment time`);
    }
    const identity = `${item.publisherId}:${item.externalId}`;
    const existingIdentity = itemIds.get(item.itemId);
    if (existingIdentity !== undefined && existingIdentity !== identity) {
      throw new Error(`Intelligence itemId conflict ${item.itemId}`);
    }
    itemIds.set(item.itemId, identity);
    const existing = identities.get(identity);
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(item)) {
        throw new Error(`Intelligence natural identity conflict ${identity}`);
      }
      continue;
    }
    identities.set(identity, item);

    const maximumAgeMs = policy.maximumItemAgeMs[item.sourceKind];
    if (assessedAtMs - item.publishedAtMs > maximumAgeMs) {
      rejected.push({ itemId: item.itemId, reason: "stale" });
      continue;
    }
    if (item.receivedAtMs - item.publishedAtMs > policy.maximumReceiptDelayMs) {
      rejected.push({ itemId: item.itemId, reason: "receipt-delay" });
      continue;
    }
    if (item.credibilityBps < policy.minimumCredibilityBps) {
      rejected.push({ itemId: item.itemId, reason: "low-credibility" });
      continue;
    }
    if (item.stance === "neutral") {
      rejected.push({ itemId: item.itemId, reason: "neutral" });
      continue;
    }
    if (item.stance === "uncertain") {
      rejected.push({ itemId: item.itemId, reason: "uncertain" });
      continue;
    }
    accepted.push(item);
  }

  const publishers = new Set(accepted.map((item) => item.publisherId));
  const acceptedEvidenceSha256 = await Promise.all(
    accepted.map((item) => sha256Hex(canonicalJson(item))),
  );
  const earliestPublishedAtMs = accepted.reduce(
    (minimum, item) => Math.min(minimum, item.publishedAtMs),
    accepted[0]?.publishedAtMs ?? assessedAtMs,
  );
  const latestReceivedAtMs = accepted.reduce(
    (maximum, item) => Math.max(maximum, item.receivedAtMs),
    accepted[0]?.receivedAtMs ?? assessedAtMs,
  );
  const maximumPublicationToReceiptMs = accepted.reduce(
    (maximum, item) =>
      Math.max(maximum, item.receivedAtMs - item.publishedAtMs),
    0,
  );
  const warnings: string[] = [];
  if (accepted.every((item) => item.authority === "social")) {
    warnings.push("social-only evidence cannot create a risk-on candidate");
  }
  if (publishers.size < policy.minimumRiskOnPublishers) {
    warnings.push("independent-publisher threshold not met");
  }
  warnings.push("external intelligence never submits or approves an order");

  const canonical = {
    topicKey,
    reaction: reactionFor(accepted, policy),
    eventType,
    stance,
    acceptedItemIds: accepted.map((item) => item.itemId),
    acceptedEvidenceSha256,
    rejectedItems: rejected,
    independentPublisherCount: publishers.size,
    authoritativeSourceCount: accepted.filter(
      (item) => item.authority === "authoritative",
    ).length,
    reputableSourceCount: accepted.filter((item) => item.authority === "reputable")
      .length,
    socialSourceCount: accepted.filter((item) => item.authority === "social").length,
    earliestPublishedAtMs,
    latestReceivedAtMs,
    maximumPublicationToReceiptMs,
    ageAtAssessmentMs: Math.max(0, assessedAtMs - earliestPublishedAtMs),
    warnings,
  };
  return {
    ...canonical,
    assessmentSha256: await sha256Hex(canonicalJson(canonical)),
  };
}
