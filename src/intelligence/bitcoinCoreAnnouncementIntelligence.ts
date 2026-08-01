import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";
import type {
  ExternalIntelligenceItem,
  ExternalIntelligencePolicy,
} from "./externalIntelligence.ts";
import type {
  ExternalIntelligenceAssessmentRequestInput,
  NormalisedExternalIntelligenceCapture,
} from "./queuePipeline.ts";
import {
  externalIntelligencePayloadCaptureId,
  type ExternalIntelligenceFeedTarget,
  type ExternalIntelligencePayloadCapture,
} from "./sourceAdapters.ts";
import {
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";
import { parseStrictRssPayload } from "./strictRssFeed.ts";
import type { ExternalIntelligenceItemRecord } from "../storage/externalIntelligence.ts";

export const BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_ID =
  "bitcoin-core-announcements-rss";
export const BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_REF =
  "https://bitcoincore.org/en/announcements.xml";
export const BITCOIN_CORE_SOURCE_ORIGIN = "https://bitcoincore.org/";
export const BITCOIN_CORE_RSS_GUIDANCE_REF =
  "https://bitcoincore.org/en/rss/";
export const BITCOIN_CORE_LICENCE_REF =
  "https://github.com/bitcoin-core/bitcoincore.org/blob/master/COPYING";
export const BITCOIN_CORE_PUBLISHER_ID = "bitcoin-core-project";
export const BITCOIN_CORE_PROVIDER_ID = "bitcoin-core-rss";
export const BITCOIN_CORE_SCOPE = "BTC.CORE";

const MAXIMUM_ITEMS = 5;
const BITCOIN_CORE_CONTENT_TYPES = [
  "application/rss+xml",
  "application/xml",
  "text/xml",
] as const;
const ANNOUNCEMENT_PATH_PATTERN =
  /^\/en\/([0-9]{4})\/([0-9]{2})\/([0-9]{2})\/([a-z0-9.]+(?:-[a-z0-9.]+){0,39})\/$/u;

interface BitcoinCoreAnnouncement {
  readonly externalId: string;
  readonly sourceRef: string;
  readonly title: string;
  readonly publishedAtMs: number;
}

export interface ScheduledBitcoinCoreIntelligenceSource {
  readonly contract: ExternalIntelligenceSourceContract;
  readonly target: ExternalIntelligenceFeedTarget & {
    readonly acquisitionMode: "scheduled-poll";
  };
  normaliseCapture(
    capture: ExternalIntelligencePayloadCapture,
  ): Promise<NormalisedExternalIntelligenceCapture | null>;
}

function canonicalAnnouncementUrl(value: string): {
  readonly externalId: string;
  readonly sourceRef: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Bitcoin Core announcement link must be an absolute URL");
  }
  if (
    url.toString() !== value ||
    url.protocol !== "https:" ||
    url.hostname !== "bitcoincore.org" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Bitcoin Core announcement link is outside the approved origin",
    );
  }
  const match = ANNOUNCEMENT_PATH_PATTERN.exec(url.pathname);
  if (match === null) {
    throw new Error(
      "Bitcoin Core announcement link has an unsupported canonical path",
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const canonicalDate = new Date(Date.UTC(year, month - 1, day));
  if (
    canonicalDate.getUTCFullYear() !== year ||
    canonicalDate.getUTCMonth() !== month - 1 ||
    canonicalDate.getUTCDate() !== day
  ) {
    throw new Error("Bitcoin Core announcement link has an invalid date");
  }
  return {
    externalId: `${match[1]}-${match[2]}-${match[3]}:${match[4]}`,
    sourceRef: value,
  };
}

const BITCOIN_CORE_RSS_PUBLICATION_TIME =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (0[1-9]|[12][0-9]|3[01]) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (19[7-9][0-9]|2[0-9]{3}) ([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]) (GMT|([+-])(0[0-9]|1[0-4])([0-5][0-9]))$/u;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function parsePublicationTime(value: string, receivedAtMs: number): number {
  const match = BITCOIN_CORE_RSS_PUBLICATION_TIME.exec(value);
  if (match === null) {
    throw new Error("Bitcoin Core announcement publication time is invalid");
  }
  const day = Number(match[2]);
  const month = MONTHS.indexOf(match[3] as (typeof MONTHS)[number]);
  const year = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);
  const offsetHour = match[8] === "GMT" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "GMT" ? 0 : Number(match[11]);
  if (offsetHour === 14 && offsetMinute !== 0) {
    throw new Error("Bitcoin Core announcement publication time is invalid");
  }
  const localCalendarMs = Date.UTC(year, month, day, hour, minute, second);
  const localCalendar = new Date(localCalendarMs);
  if (
    localCalendar.getUTCFullYear() !== year ||
    localCalendar.getUTCMonth() !== month ||
    localCalendar.getUTCDate() !== day ||
    localCalendar.getUTCHours() !== hour ||
    localCalendar.getUTCMinutes() !== minute ||
    localCalendar.getUTCSeconds() !== second ||
    WEEKDAYS[localCalendar.getUTCDay()] !== match[1]
  ) {
    throw new Error("Bitcoin Core announcement publication time is invalid");
  }
  const offsetSign = match[9] === "-" ? -1 : 1;
  const parsed =
    localCalendarMs -
    offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > receivedAtMs) {
    throw new Error("Bitcoin Core announcement publication time is invalid");
  }
  return parsed;
}

async function assertManifest(
  contract: ExternalIntelligenceSourceContract,
  capture?: ExternalIntelligencePayloadCapture,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  if (
    contract.sourceId !== BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_ID ||
    contract.sourceKind !== "issuer" ||
    contract.authority !== "authoritative" ||
    contract.sourceOrigin !== BITCOIN_CORE_SOURCE_ORIGIN ||
    contract.publisherId !== BITCOIN_CORE_PUBLISHER_ID ||
    contract.providerId !== BITCOIN_CORE_PROVIDER_ID ||
    contract.contentPolicy !== "digest-only" ||
    contract.licenceRef !== BITCOIN_CORE_LICENCE_REF ||
    contract.attributionRequired !== true ||
    contract.deletionHandling !== "not-applicable" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    contract.maximumRetentionMs !== null ||
    contract.allowedAcquisitionModes.length !== 1 ||
    contract.allowedAcquisitionModes[0] !== "scheduled-poll"
  ) {
    throw new Error(
      "Bitcoin Core RSS source contract does not match the approved manifest",
    );
  }
  if (capture === undefined) return;
  if (
    capture.requestStartedAtMs < contract.effectiveFromMs ||
    (contract.expiresAtMs !== null &&
      capture.requestStartedAtMs >= contract.expiresAtMs)
  ) {
    throw new Error(
      "Bitcoin Core RSS source contract was not active at capture time",
    );
  }
  if (
    capture.sourceId !== contract.sourceId ||
    capture.sourceContractSha256 !== contract.sourceContractSha256 ||
    capture.sourceKind !== "issuer" ||
    capture.publisherId !== contract.publisherId ||
    capture.providerId !== contract.providerId ||
    capture.sourceRef !== BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_REF ||
    capture.acquisitionMode !== "scheduled-poll" ||
    !BITCOIN_CORE_CONTENT_TYPES.includes(
      capture.contentType as (typeof BITCOIN_CORE_CONTENT_TYPES)[number],
    ) ||
    capture.payloadRetention !== "transient-only" ||
    capture.modelTrainingAllowed !== false
  ) {
    throw new Error(
      "Bitcoin Core RSS capture does not match the approved manifest",
    );
  }
  const reproducedCaptureId = await externalIntelligencePayloadCaptureId({
    sourceId: capture.sourceId,
    sourceContractSha256: capture.sourceContractSha256,
    sourceKind: capture.sourceKind,
    sourceRef: capture.sourceRef,
    acquisitionMode: capture.acquisitionMode,
    requestStartedAtMs: capture.requestStartedAtMs,
    receivedAtMs: capture.receivedAtMs,
    availableAtMs: capture.availableAtMs,
    payloadSha256: capture.payloadSha256,
    payloadByteLength: capture.payloadByteLength,
    contentType: capture.contentType,
    etag: capture.etag,
    lastModified: capture.lastModified,
  });
  if (capture.captureId !== reproducedCaptureId) {
    throw new Error("Bitcoin Core RSS capture identity does not reproduce");
  }
}

async function parseAnnouncements(
  capture: ExternalIntelligencePayloadCapture,
): Promise<readonly BitcoinCoreAnnouncement[]> {
  const items = await parseStrictRssPayload(
    capture,
    "Bitcoin Core announcements",
    MAXIMUM_ITEMS,
  );
  const announcements = items.map((item) => {
    const link = canonicalAnnouncementUrl(item.link);
    if (item.guid !== link.sourceRef) {
      throw new Error(
        "Bitcoin Core announcement guid does not match its canonical link",
      );
    }
    return {
      ...link,
      title: item.title,
      publishedAtMs: parsePublicationTime(
        item.publicationText,
        capture.receivedAtMs,
      ),
    };
  });
  const externalIds = announcements.map(
    (announcement) => announcement.externalId,
  );
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error("Bitcoin Core RSS contains duplicate announcement ids");
  }
  return [...announcements].sort((left, right) =>
    left.externalId.localeCompare(right.externalId),
  );
}

async function itemRecordFor(
  announcement: BitcoinCoreAnnouncement,
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
): Promise<ExternalIntelligenceItemRecord> {
  const contentSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "bitcoin-core-announcement-content-v1",
    externalId: announcement.externalId,
    sourceRef: announcement.sourceRef,
    title: announcement.title,
    publishedAtMs: announcement.publishedAtMs,
  });
  const itemId = await sha256CanonicalIntelligence({
    schemaVersion: "bitcoin-core-announcement-item-id-v1",
    sourceId: contract.sourceId,
    externalId: announcement.externalId,
  });
  const item: ExternalIntelligenceItem = {
    itemId,
    sourceId: contract.sourceId,
    sourceKind: "issuer",
    authority: "authoritative",
    publisherId: contract.publisherId,
    sourceRef: announcement.sourceRef,
    externalId: announcement.externalId,
    acquisitionMode: "scheduled-poll",
    topicKey: `bitcoin-core-announcement:${announcement.externalId}`,
    assetSymbols: [BITCOIN_CORE_SCOPE],
    eventType: "other",
    stance: "neutral",
    publishedAtMs: announcement.publishedAtMs,
    receivedAtMs: capture.receivedAtMs,
    availableAtMs: capture.availableAtMs,
    payloadSha256: capture.payloadSha256,
    contentSha256,
    credibilityBps: 10_000,
    confidenceBps: 10_000,
    contentPolicy: contract.contentPolicy,
    modelTrainingAllowed: false,
  };
  return { item, sourceContractSha256: contract.sourceContractSha256 };
}

export async function normaliseBitcoinCoreAnnouncementCapture(
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
  policy: ExternalIntelligencePolicy,
): Promise<NormalisedExternalIntelligenceCapture | null> {
  await assertManifest(contract, capture);
  const announcements = await parseAnnouncements(capture);
  if (announcements.length === 0) return null;
  const itemRecords = await Promise.all(
    announcements.map((announcement) =>
      itemRecordFor(announcement, contract, capture),
    ),
  );
  const assessmentRequests: ExternalIntelligenceAssessmentRequestInput[] =
    itemRecords.map((record) => ({
      topicKey: record.item.topicKey,
      eventType: "other",
      stance: "neutral",
      itemIds: [record.item.itemId],
      policy,
    }));
  const result: NormalisedExternalIntelligenceCapture = {
    itemRecords,
    corrections: [],
    assessmentRequests,
  };
  const retained = canonicalIntelligenceJson(result);
  if (
    retained.includes("payloadBytes") ||
    announcements.some((announcement) =>
      retained.includes(announcement.title),
    )
  ) {
    throw new Error(
      "Bitcoin Core RSS normalisation retained raw provider content",
    );
  }
  return result;
}

export async function createBitcoinCoreAnnouncementScheduledSource(
  contract: ExternalIntelligenceSourceContract,
  policy: ExternalIntelligencePolicy,
): Promise<ScheduledBitcoinCoreIntelligenceSource> {
  await assertManifest(contract);
  return {
    contract,
    target: {
      sourceId: BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_ID,
      sourceRef: BITCOIN_CORE_ANNOUNCEMENTS_SOURCE_REF,
      acquisitionMode: "scheduled-poll",
      acceptedContentTypes: [...BITCOIN_CORE_CONTENT_TYPES],
    },
    normaliseCapture: (capture) =>
      normaliseBitcoinCoreAnnouncementCapture(contract, capture, policy),
  };
}
