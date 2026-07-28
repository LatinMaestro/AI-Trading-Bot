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
import type {
  ExternalIntelligenceFeedTarget,
  ExternalIntelligencePayloadCapture,
} from "./sourceAdapters.ts";
import {
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";
import { parseStrictRssPayload } from "./strictRssFeed.ts";
import type { ExternalIntelligenceItemRecord } from "../storage/externalIntelligence.ts";

export const AUSTRAC_MEDIA_RELEASES_SOURCE_ID =
  "austrac-media-releases-rss";
export const AUSTRAC_MEDIA_RELEASES_SOURCE_REF =
  "https://www.austrac.gov.au/media-release/rss.xml";
export const AUSTRAC_SOURCE_ORIGIN = "https://www.austrac.gov.au/";
export const AUSTRAC_RSS_GUIDANCE_REF =
  "https://www.austrac.gov.au/subscribing-media-release-alerts";
export const AUSTRAC_COPYRIGHT_REF =
  "https://www.austrac.gov.au/copyright";
export const AUSTRAC_PUBLISHER_ID = "austrac";
export const AUSTRAC_PROVIDER_ID = "austrac-rss";
export const AUSTRAC_REGULATOR_SCOPE = "AUSTRAC.REGULATOR";

const MAXIMUM_ITEMS = 100;
const AUSTRAC_CONTENT_TYPES = [
  "application/rss+xml",
  "application/xml",
  "text/xml",
] as const;
const RELEASE_PATH_PATTERN =
  /^\/new-and-media\/news\/([a-z0-9]+(?:-[a-z0-9]+){2,39})$/u;

interface AustracMediaRelease {
  readonly externalId: string;
  readonly sourceRef: string;
  readonly title: string;
  readonly publishedAtMs: number;
}

export interface ScheduledAustracIntelligenceSource {
  readonly contract: ExternalIntelligenceSourceContract;
  readonly target: ExternalIntelligenceFeedTarget & {
    readonly acquisitionMode: "scheduled-poll";
  };
  normaliseCapture(
    capture: ExternalIntelligencePayloadCapture,
  ): Promise<NormalisedExternalIntelligenceCapture | null>;
}

function canonicalMediaReleaseUrl(value: string): {
  readonly externalId: string;
  readonly sourceRef: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AUSTRAC media-release link must be an absolute URL");
  }
  if (
    url.toString() !== value ||
    url.protocol !== "https:" ||
    url.hostname !== "www.austrac.gov.au" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("AUSTRAC media-release link is outside the approved origin");
  }
  const match = RELEASE_PATH_PATTERN.exec(url.pathname);
  if (match === null) {
    throw new Error(
      "AUSTRAC media-release link has an unsupported canonical path",
    );
  }
  return { externalId: match[1] ?? "", sourceRef: value };
}

function parsePublicationTime(value: string, receivedAtMs: number): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > receivedAtMs) {
    throw new Error("AUSTRAC media-release publication time is invalid");
  }
  return parsed;
}

async function assertManifest(
  contract: ExternalIntelligenceSourceContract,
  capture?: ExternalIntelligencePayloadCapture,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  if (
    contract.sourceId !== AUSTRAC_MEDIA_RELEASES_SOURCE_ID ||
    contract.sourceKind !== "regulator" ||
    contract.authority !== "authoritative" ||
    contract.sourceOrigin !== AUSTRAC_SOURCE_ORIGIN ||
    contract.publisherId !== AUSTRAC_PUBLISHER_ID ||
    contract.providerId !== AUSTRAC_PROVIDER_ID ||
    contract.contentPolicy !== "digest-only" ||
    contract.licenceRef !== AUSTRAC_COPYRIGHT_REF ||
    contract.attributionRequired !== true ||
    contract.deletionHandling !== "not-applicable" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    !contract.allowedAcquisitionModes.includes("scheduled-poll")
  ) {
    throw new Error(
      "AUSTRAC RSS source contract does not match the approved manifest",
    );
  }
  if (capture === undefined) return;
  if (
    capture.sourceId !== contract.sourceId ||
    capture.sourceContractSha256 !== contract.sourceContractSha256 ||
    capture.sourceKind !== "regulator" ||
    capture.publisherId !== contract.publisherId ||
    capture.providerId !== contract.providerId ||
    capture.sourceRef !== AUSTRAC_MEDIA_RELEASES_SOURCE_REF ||
    capture.acquisitionMode !== "scheduled-poll" ||
    !AUSTRAC_CONTENT_TYPES.includes(
      capture.contentType as (typeof AUSTRAC_CONTENT_TYPES)[number],
    ) ||
    capture.payloadRetention !== "transient-only" ||
    capture.modelTrainingAllowed !== false
  ) {
    throw new Error("AUSTRAC RSS capture does not match the approved manifest");
  }
}

async function parseReleases(
  capture: ExternalIntelligencePayloadCapture,
): Promise<readonly AustracMediaRelease[]> {
  const items = await parseStrictRssPayload(
    capture,
    "AUSTRAC media releases",
    MAXIMUM_ITEMS,
  );
  const releases = items.map((item) => {
    const link = canonicalMediaReleaseUrl(item.link);
    if (item.guid !== link.sourceRef) {
      throw new Error(
        "AUSTRAC media-release guid does not match its canonical link",
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
  const externalIds = releases.map((release) => release.externalId);
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error("AUSTRAC RSS contains duplicate media-release ids");
  }
  return [...releases].sort((left, right) =>
    left.externalId.localeCompare(right.externalId),
  );
}

async function itemRecordFor(
  release: AustracMediaRelease,
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
): Promise<ExternalIntelligenceItemRecord> {
  const contentSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "austrac-media-release-content-v1",
    externalId: release.externalId,
    sourceRef: release.sourceRef,
    title: release.title,
    publishedAtMs: release.publishedAtMs,
  });
  const itemId = await sha256CanonicalIntelligence({
    schemaVersion: "austrac-media-release-item-id-v1",
    sourceId: contract.sourceId,
    externalId: release.externalId,
  });
  const item: ExternalIntelligenceItem = {
    itemId,
    sourceId: contract.sourceId,
    sourceKind: "regulator",
    authority: "authoritative",
    publisherId: contract.publisherId,
    sourceRef: release.sourceRef,
    externalId: release.externalId,
    acquisitionMode: "scheduled-poll",
    topicKey: `austrac-media-release:${release.externalId}`,
    assetSymbols: [AUSTRAC_REGULATOR_SCOPE],
    eventType: "regulatory-action",
    stance: "neutral",
    publishedAtMs: release.publishedAtMs,
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

export async function normaliseAustracMediaReleaseCapture(
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
  policy: ExternalIntelligencePolicy,
): Promise<NormalisedExternalIntelligenceCapture | null> {
  await assertManifest(contract, capture);
  const releases = await parseReleases(capture);
  if (releases.length === 0) return null;
  const itemRecords = await Promise.all(
    releases.map((release) => itemRecordFor(release, contract, capture)),
  );
  const assessmentRequests: ExternalIntelligenceAssessmentRequestInput[] =
    itemRecords.map((record) => ({
      topicKey: record.item.topicKey,
      eventType: "regulatory-action",
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
    releases.some((release) => retained.includes(release.title))
  ) {
    throw new Error("AUSTRAC RSS normalisation retained raw provider content");
  }
  return result;
}

export async function createAustracMediaReleaseScheduledSource(
  contract: ExternalIntelligenceSourceContract,
  policy: ExternalIntelligencePolicy,
): Promise<ScheduledAustracIntelligenceSource> {
  await assertManifest(contract);
  return {
    contract,
    target: {
      sourceId: AUSTRAC_MEDIA_RELEASES_SOURCE_ID,
      sourceRef: AUSTRAC_MEDIA_RELEASES_SOURCE_REF,
      acquisitionMode: "scheduled-poll",
      acceptedContentTypes: [...AUSTRAC_CONTENT_TYPES],
    },
    normaliseCapture: (capture) =>
      normaliseAustracMediaReleaseCapture(contract, capture, policy),
  };
}
