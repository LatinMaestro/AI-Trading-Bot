import { normalizeKrakenDisplayPair } from "../marketData/krakenQuality.ts";
import { sha256Hex } from "../utils/crypto.ts";
import type {
  LifecycleAnnouncementInput,
  UniverseSourceEvidence,
} from "./ingestion.ts";
import type { MarketLifecycleEventType } from "./types.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_DOCUMENTS = 200;
const MAXIMUM_DECLARATIONS_PER_DOCUMENT = 500;
const SOURCE_CLASSES = new Set<KrakenLifecycleSourceClass>([
  "asset-listing",
  "delisting-notice",
  "status-incident",
  "regional-availability",
]);

export const KRAKEN_OFFICIAL_LIFECYCLE_INDEXES = {
  assetListings: "https://blog.kraken.com/category/product/asset-listings",
  delistings: "https://support.kraken.com/sections/delistings",
  statusApi: "https://status.kraken.com/api",
} as const;

export type KrakenLifecycleSourceClass =
  | "asset-listing"
  | "delisting-notice"
  | "status-incident"
  | "regional-availability";

export type KrakenLifecycleScope = "global" | "AU";

export interface KrakenLifecycleDeclaration {
  readonly canonicalPair: string;
  readonly eventType: MarketLifecycleEventType;
  readonly effectiveAtMs: number;
  readonly scope: KrakenLifecycleScope;
}

export interface KrakenOfficialLifecycleDocument {
  readonly documentId: string;
  readonly sourceClass: KrakenLifecycleSourceClass;
  readonly sourceRef: string;
  readonly publishedAtMs: number;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly declarations: readonly KrakenLifecycleDeclaration[];
}

export interface PreparedKrakenLifecycleAnnouncement {
  readonly source: UniverseSourceEvidence;
  readonly announcement: LifecycleAnnouncementInput;
}

export interface KrakenLifecycleCoverage {
  readonly canonicalPair: string;
  readonly complete: boolean;
  readonly currentlyListed: boolean;
  readonly currentlyOnline: boolean;
  readonly currentlyAvailableInAustralia: boolean;
  readonly missingEvidence: readonly (
    | "listing-history"
    | "trading-history"
    | "australian-availability-history"
  )[];
}

export interface PreparedKrakenLifecycleEvidence {
  readonly announcements: readonly PreparedKrakenLifecycleAnnouncement[];
  readonly coverage: readonly KrakenLifecycleCoverage[];
  readonly sourceDigests: readonly string[];
  readonly evidenceSha256: string;
}

const ALLOWED_EVENTS: Readonly<
  Record<KrakenLifecycleSourceClass, ReadonlySet<MarketLifecycleEventType>>
> = {
  "asset-listing": new Set(["listed", "trading-online"]),
  "delisting-notice": new Set(["trading-suspended", "delisted"]),
  "status-incident": new Set(["trading-suspended", "trading-resumed"]),
  "regional-availability": new Set(["au-enabled", "au-disabled"]),
};

function assertCanonical(name: string, value: string): void {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 300
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

function assertOfficialSource(
  sourceClass: KrakenLifecycleSourceClass,
  sourceRef: string,
): void {
  let url: URL;
  try {
    url = new URL(sourceRef);
  } catch {
    throw new Error("Lifecycle sourceRef must be an absolute URL");
  }
  if (
    url.toString() !== sourceRef ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Lifecycle sourceRef must be canonical HTTPS");
  }
  const allowed =
    sourceClass === "asset-listing"
      ? url.hostname === "blog.kraken.com" &&
        url.pathname.startsWith("/product/asset-listings/")
      : sourceClass === "status-incident"
        ? url.hostname === "status.kraken.com" &&
          (url.pathname.startsWith("/api/v2/incidents") ||
            url.pathname.startsWith("/incidents/"))
        : url.hostname === "support.kraken.com" &&
          url.pathname.startsWith("/articles/");
  if (!allowed) {
    throw new Error(
      `Lifecycle sourceRef is not official for ${sourceClass}`,
    );
  }
}

function assertDeclarationAllowed(
  sourceClass: KrakenLifecycleSourceClass,
  declaration: KrakenLifecycleDeclaration,
): void {
  if (!ALLOWED_EVENTS[sourceClass].has(declaration.eventType)) {
    throw new Error(
      `${sourceClass} cannot declare ${declaration.eventType}`,
    );
  }
  const australianEvent =
    declaration.eventType === "au-enabled" ||
    declaration.eventType === "au-disabled";
  if (
    (australianEvent && declaration.scope !== "AU") ||
    (!australianEvent && declaration.scope !== "global")
  ) {
    throw new Error(
      `${declaration.eventType} has incompatible geographic scope`,
    );
  }
}

function eventDimensions(
  eventType: MarketLifecycleEventType,
): readonly string[] {
  if (eventType === "au-enabled" || eventType === "au-disabled") {
    return ["australia"];
  }
  if (eventType === "listed") return ["listing"];
  if (eventType === "delisted") return ["listing", "trading"];
  return ["trading"];
}

function auditCoverage(
  pairs: readonly string[],
  announcements: readonly PreparedKrakenLifecycleAnnouncement[],
  asOfMs: number,
): readonly KrakenLifecycleCoverage[] {
  return pairs.map((pair) => {
    const knowable = announcements
      .filter(
        (item) =>
          item.announcement.canonicalPair === pair &&
          item.announcement.publishedAtMs <= asOfMs &&
          item.source.fetchedAtMs <= asOfMs,
      )
      .sort(
        (left, right) =>
          left.announcement.effectiveAtMs -
            right.announcement.effectiveAtMs ||
          left.announcement.publishedAtMs -
            right.announcement.publishedAtMs ||
          left.announcement.eventType.localeCompare(
            right.announcement.eventType,
          ),
      );
    const hasListingHistory = knowable.some(
      (item) => item.announcement.eventType === "listed",
    );
    const hasTradingHistory = knowable.some((item) =>
      ["trading-online", "trading-suspended", "trading-resumed"].includes(
        item.announcement.eventType,
      ),
    );
    const hasAustralianHistory = knowable.some((item) =>
      ["au-enabled", "au-disabled"].includes(item.announcement.eventType),
    );
    let currentlyListed = false;
    let currentlyOnline = false;
    let currentlyAvailableInAustralia = false;
    for (const item of knowable) {
      if (item.announcement.effectiveAtMs > asOfMs) continue;
      switch (item.announcement.eventType) {
        case "listed":
          currentlyListed = true;
          currentlyOnline = false;
          break;
        case "trading-online":
        case "trading-resumed":
          currentlyOnline = true;
          break;
        case "trading-suspended":
          currentlyOnline = false;
          break;
        case "delisted":
          currentlyListed = false;
          currentlyOnline = false;
          break;
        case "au-enabled":
          currentlyAvailableInAustralia = true;
          break;
        case "au-disabled":
          currentlyAvailableInAustralia = false;
          break;
      }
    }
    const missingEvidence: KrakenLifecycleCoverage["missingEvidence"][number][] =
      [];
    if (!hasListingHistory) missingEvidence.push("listing-history");
    if (!hasTradingHistory) missingEvidence.push("trading-history");
    if (!hasAustralianHistory) {
      missingEvidence.push("australian-availability-history");
    }
    return {
      canonicalPair: pair,
      complete: missingEvidence.length === 0,
      currentlyListed,
      currentlyOnline,
      currentlyAvailableInAustralia,
      missingEvidence,
    };
  });
}

export async function prepareKrakenLifecycleEvidence(
  expectedPairs: readonly string[],
  documents: readonly KrakenOfficialLifecycleDocument[],
  recordedAtMs: number,
): Promise<PreparedKrakenLifecycleEvidence> {
  assertTime("recordedAtMs", recordedAtMs);
  if (
    expectedPairs.length === 0 ||
    expectedPairs.length > MAXIMUM_DECLARATIONS_PER_DOCUMENT
  ) {
    throw new Error("Lifecycle coverage requires 1 to 500 expected pairs");
  }
  const pairs = expectedPairs.map(normalizeKrakenDisplayPair).sort();
  if (new Set(pairs).size !== pairs.length) {
    throw new Error("Lifecycle expectedPairs contain duplicates");
  }
  if (documents.length === 0 || documents.length > MAXIMUM_DOCUMENTS) {
    throw new Error("Lifecycle evidence requires 1 to 200 documents");
  }

  const documentIds = new Set<string>();
  const declarationIdentities = new Set<string>();
  const dimensionStates = new Map<string, MarketLifecycleEventType>();
  const announcements: PreparedKrakenLifecycleAnnouncement[] = [];
  const sourceDigests = new Set<string>();

  for (const document of [...documents].sort((left, right) =>
    left.documentId.localeCompare(right.documentId),
  )) {
    assertCanonical("documentId", document.documentId);
    if (documentIds.has(document.documentId)) {
      throw new Error(`Duplicate lifecycle document ${document.documentId}`);
    }
    documentIds.add(document.documentId);
    if (!SOURCE_CLASSES.has(document.sourceClass)) {
      throw new Error(`Unknown lifecycle source class ${document.sourceClass}`);
    }
    assertOfficialSource(document.sourceClass, document.sourceRef);
    assertTime("document publishedAtMs", document.publishedAtMs);
    assertTime("document fetchedAtMs", document.fetchedAtMs);
    assertDigest("document payloadSha256", document.payloadSha256);
    if (
      document.publishedAtMs > document.fetchedAtMs ||
      document.fetchedAtMs > recordedAtMs
    ) {
      throw new Error(`${document.documentId} has invalid chronology`);
    }
    if (
      document.declarations.length === 0 ||
      document.declarations.length > MAXIMUM_DECLARATIONS_PER_DOCUMENT
    ) {
      throw new Error(
        `${document.documentId} requires 1 to 500 declarations`,
      );
    }
    sourceDigests.add(document.payloadSha256);
    const source: UniverseSourceEvidence = {
      sourceId: `kraken:lifecycle:${document.documentId}:${document.payloadSha256.slice(0, 16)}`,
      sourceKind: "official-lifecycle-announcement",
      sourceRef: document.sourceRef,
      fetchedAtMs: document.fetchedAtMs,
      payloadSha256: document.payloadSha256,
    };

    for (const declaration of document.declarations) {
      const canonicalPair = normalizeKrakenDisplayPair(
        declaration.canonicalPair,
      );
      assertTime("declaration effectiveAtMs", declaration.effectiveAtMs);
      assertDeclarationAllowed(document.sourceClass, declaration);
      const identity = `${canonicalPair}:${declaration.eventType}:${declaration.effectiveAtMs}:${document.publishedAtMs}`;
      if (declarationIdentities.has(identity)) {
        throw new Error(`Duplicate lifecycle declaration ${identity}`);
      }
      declarationIdentities.add(identity);
      for (const dimension of eventDimensions(declaration.eventType)) {
        const dimensionIdentity = `${canonicalPair}:${dimension}:${declaration.effectiveAtMs}:${document.publishedAtMs}`;
        const previous = dimensionStates.get(dimensionIdentity);
        if (previous !== undefined && previous !== declaration.eventType) {
          throw new Error(
            `Conflicting lifecycle declarations ${dimensionIdentity}`,
          );
        }
        dimensionStates.set(dimensionIdentity, declaration.eventType);
      }
      announcements.push({
        source,
        announcement: {
          canonicalPair,
          eventType: declaration.eventType,
          effectiveAtMs: declaration.effectiveAtMs,
          publishedAtMs: document.publishedAtMs,
        },
      });
    }
  }

  announcements.sort((left, right) =>
    `${left.announcement.canonicalPair}:${left.announcement.effectiveAtMs}:${left.announcement.eventType}:${left.source.payloadSha256}`.localeCompare(
      `${right.announcement.canonicalPair}:${right.announcement.effectiveAtMs}:${right.announcement.eventType}:${right.source.payloadSha256}`,
    ),
  );
  const coverage = auditCoverage(pairs, announcements, recordedAtMs);
  const canonical = {
    schemaVersion: "kraken-official-lifecycle-v1",
    recordedAtMs,
    expectedPairs: pairs,
    announcements,
    coverage,
    sourceDigests: [...sourceDigests].sort(),
  };
  return {
    announcements,
    coverage,
    sourceDigests: canonical.sourceDigests,
    evidenceSha256: await sha256Hex(canonicalJson(canonical)),
  };
}
