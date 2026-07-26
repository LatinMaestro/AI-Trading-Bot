import { sha256Hex } from "../utils/crypto.ts";
import type {
  LifecycleAnnouncementInput,
  UniverseSourceEvidence,
} from "./ingestion.ts";
import type { MarketLifecycleEventType } from "./types.ts";

const MAXIMUM_PAYLOAD_BYTES = 2_000_000;
const NOTICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PAIR_PATTERN = /^[A-Z0-9][A-Z0-9.-]*\/[A-Z0-9][A-Z0-9.-]*$/;
const SOURCE_CLASSES = new Set<KrakenLifecycleSourceClass>([
  "support-article",
  "status-incident",
]);
const LIFECYCLE_EVENT_TYPES = new Set<MarketLifecycleEventType>([
  "listed",
  "trading-online",
  "trading-suspended",
  "trading-resumed",
  "delisted",
  "au-enabled",
  "au-disabled",
]);
const STATUS_EVENT_TYPES = new Set<MarketLifecycleEventType>([
  "trading-suspended",
  "trading-resumed",
]);

export type KrakenLifecycleSourceClass =
  | "support-article"
  | "status-incident";

export interface KrakenLifecycleNoticeEventInput {
  readonly canonicalPair: string;
  readonly eventType: MarketLifecycleEventType;
  readonly effectiveAtMs: number;
}

export interface KrakenLifecycleNoticeInput {
  readonly noticeId: string;
  readonly sourceClass: KrakenLifecycleSourceClass;
  readonly sourceUrl: string;
  readonly fetchedAtMs: number;
  readonly publishedAtMs: number;
  readonly payloadText: string;
  readonly events: readonly KrakenLifecycleNoticeEventInput[];
}

export interface PreparedKrakenLifecycleNotice {
  readonly source: UniverseSourceEvidence;
  readonly announcements: readonly LifecycleAnnouncementInput[];
}

function assertSafeTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertOfficialUrl(
  sourceClass: KrakenLifecycleSourceClass,
  sourceUrl: string,
): string {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error("Kraken lifecycle sourceUrl must be a valid URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Kraken lifecycle sourceUrl must be canonical HTTPS without credentials, query or fragment",
    );
  }
  const expectedHost =
    sourceClass === "support-article"
      ? "support.kraken.com"
      : "status.kraken.com";
  if (url.hostname !== expectedHost) {
    throw new Error(`${sourceClass} evidence must use ${expectedHost}`);
  }
  if (url.pathname === "/") {
    throw new Error(
      "Kraken lifecycle sourceUrl must identify a specific official record",
    );
  }
  if (sourceClass === "support-article" && !url.pathname.startsWith("/hc/")) {
    throw new Error(
      "Kraken support evidence must use an official Help Center article URL",
    );
  }
  return url.toString();
}

function assertCanonicalPair(value: string): void {
  if (value.trim() !== value || !PAIR_PATTERN.test(value)) {
    throw new Error(`${value} must be a canonical uppercase BASE/QUOTE pair`);
  }
}

export async function prepareKrakenLifecycleNotice(
  input: KrakenLifecycleNoticeInput,
): Promise<PreparedKrakenLifecycleNotice> {
  if (!SOURCE_CLASSES.has(input.sourceClass)) {
    throw new Error("Kraken lifecycle sourceClass is invalid");
  }
  if (!NOTICE_ID_PATTERN.test(input.noticeId)) {
    throw new Error(
      "noticeId must be a canonical identifier of at most 128 characters",
    );
  }
  assertSafeTime("fetchedAtMs", input.fetchedAtMs);
  assertSafeTime("publishedAtMs", input.publishedAtMs);
  if (input.publishedAtMs > input.fetchedAtMs) {
    throw new Error(
      "Kraken lifecycle evidence cannot be fetched before publication",
    );
  }
  const sourceRef = assertOfficialUrl(input.sourceClass, input.sourceUrl);
  if (
    typeof input.payloadText !== "string" ||
    input.payloadText.length === 0 ||
    input.payloadText.trim().length === 0
  ) {
    throw new Error("Kraken lifecycle payloadText must not be empty");
  }
  const payloadBytes = new TextEncoder().encode(input.payloadText).byteLength;
  if (payloadBytes > MAXIMUM_PAYLOAD_BYTES) {
    throw new Error("Kraken lifecycle payload exceeded the size limit");
  }
  if (!Array.isArray(input.events) || input.events.length === 0) {
    throw new Error(
      "Kraken lifecycle notice must contain at least one explicit event",
    );
  }

  const identities = new Set<string>();
  const announcements = [...input.events]
    .map((event): LifecycleAnnouncementInput => {
      assertCanonicalPair(event.canonicalPair);
      assertSafeTime("effectiveAtMs", event.effectiveAtMs);
      if (!LIFECYCLE_EVENT_TYPES.has(event.eventType)) {
        throw new Error("Kraken lifecycle eventType is invalid");
      }
      if (
        input.sourceClass === "status-incident" &&
        !STATUS_EVENT_TYPES.has(event.eventType)
      ) {
        throw new Error(
          "Kraken status incidents may only establish suspension or resumption events",
        );
      }
      const identity = `${event.canonicalPair}:${event.eventType}:${event.effectiveAtMs}`;
      if (identities.has(identity)) {
        throw new Error(`Duplicate Kraken lifecycle event ${identity}`);
      }
      identities.add(identity);
      return {
        canonicalPair: event.canonicalPair,
        eventType: event.eventType,
        effectiveAtMs: event.effectiveAtMs,
        publishedAtMs: input.publishedAtMs,
      };
    })
    .sort((left, right) =>
      `${left.canonicalPair}:${left.effectiveAtMs}:${left.eventType}`.localeCompare(
        `${right.canonicalPair}:${right.effectiveAtMs}:${right.eventType}`,
      ),
    );

  const payloadSha256 = await sha256Hex(input.payloadText);
  return {
    source: {
      sourceId: `kraken:lifecycle:${input.sourceClass}:${input.noticeId}:${payloadSha256.slice(0, 16)}`,
      sourceKind: "official-lifecycle-announcement",
      sourceRef,
      fetchedAtMs: input.fetchedAtMs,
      payloadSha256,
    },
    announcements,
  };
}
