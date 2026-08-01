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
import type { ExternalIntelligenceItemRecord } from "../storage/externalIntelligence.ts";

export const SEC_PRESS_RELEASES_SOURCE_ID = "sec-press-releases-rss";
export const SEC_PRESS_RELEASES_SOURCE_REF =
  "https://www.sec.gov/news/pressreleases.rss";
export const SEC_SOURCE_ORIGIN = "https://www.sec.gov/";
export const SEC_RSS_POLICY_REF = "https://www.sec.gov/about/rss-feeds";
export const SEC_PUBLISHER_ID = "us-sec";
export const SEC_PROVIDER_ID = "us-sec-rss";
export const SEC_REGULATOR_SCOPE = "SEC.REGULATOR";

const MAXIMUM_ITEMS = 100;
const MAXIMUM_XML_CHARACTERS = 1_048_576;
const MAXIMUM_TEXT_LENGTH = 20_000;
const SEC_CONTENT_TYPES = [
  "application/rss+xml",
  "application/xml",
  "text/xml",
] as const;
const decoder = new TextDecoder("utf-8", { fatal: true });

interface SecPressRelease {
  readonly externalId: string;
  readonly sourceRef: string;
  readonly title: string;
  readonly publishedAtMs: number;
}

export interface ScheduledExternalIntelligenceSource {
  readonly contract: ExternalIntelligenceSourceContract;
  readonly target: ExternalIntelligenceFeedTarget & {
    readonly acquisitionMode: "scheduled-poll";
  };
  normaliseCapture(
    capture: ExternalIntelligencePayloadCapture,
  ): Promise<NormalisedExternalIntelligenceCapture | null>;
}

function assertDeclaredUserAgent(value: string): void {
  if (
    value.trim() !== value ||
    value.length < 20 ||
    value.length > 300 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
  ) {
    throw new Error(
      "SEC User-Agent must be canonical text containing a truthful contact email",
    );
  }
}

function decodeXmlText(value: string, name: string): string {
  let text = value;
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/u.exec(text);
  if (cdata !== null) text = cdata[1] ?? "";
  if (/<[^>]*>/u.test(text)) {
    throw new Error(`${name} must not contain nested markup`);
  }
  if (
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/u.test(text)
  ) {
    throw new Error(`${name} contains an unsupported XML entity`);
  }
  text = text.replace(
    /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/gu,
    (_entity, token: string) => {
      switch (token) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default: {
          const codePoint = token.startsWith("#x")
            ? Number.parseInt(token.slice(2), 16)
            : Number.parseInt(token.slice(1), 10);
          if (
            !Number.isSafeInteger(codePoint) ||
            codePoint <= 0 ||
            codePoint > 0x10ffff ||
            (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ) {
            throw new Error(`${name} contains an invalid XML character`);
          }
          return String.fromCodePoint(codePoint);
        }
      }
    },
  );
  if (
    text.trim() !== text ||
    text.length === 0 ||
    text.length > MAXIMUM_TEXT_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
  ) {
    throw new Error(`${name} must be bounded canonical XML text`);
  }
  return text;
}

function exactlyOneTag(block: string, tag: string): string {
  const pattern = new RegExp(
    `<${tag}(?:\\s+[^<>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "gu",
  );
  const values = [...block.matchAll(pattern)];
  if (values.length !== 1) {
    throw new Error(`SEC RSS item must contain exactly one ${tag}`);
  }
  return decodeXmlText(values[0]?.[1] ?? "", `SEC RSS ${tag}`);
}

function canonicalPressReleaseUrl(value: string): {
  readonly externalId: string;
  readonly sourceRef: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SEC press-release link must be an absolute URL");
  }
  if (
    url.toString() !== value ||
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("SEC press-release link is outside the approved origin");
  }
  const match =
    /^\/(?:newsroom\/press-releases|news\/press-release)\/([0-9]{4}-[0-9]+)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/u.exec(
      url.pathname,
    );
  if (match === null) {
    throw new Error("SEC press-release link has an unsupported canonical path");
  }
  return { externalId: match[1] ?? "", sourceRef: value };
}

function parsePublishedAt(value: string, receivedAtMs: number): number {
  const parsed = Date.parse(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > receivedAtMs
  ) {
    throw new Error("SEC press-release publication time is invalid");
  }
  return parsed;
}

function parseItem(block: string, receivedAtMs: number): SecPressRelease {
  const title = exactlyOneTag(block, "title");
  const link = canonicalPressReleaseUrl(exactlyOneTag(block, "link"));
  const guid = exactlyOneTag(block, "guid");
  if (guid !== link.sourceRef && guid !== link.externalId) {
    throw new Error("SEC press-release guid does not match its canonical link");
  }
  return {
    ...link,
    title,
    publishedAtMs: parsePublishedAt(
      exactlyOneTag(block, "pubDate"),
      receivedAtMs,
    ),
  };
}

async function assertManifest(
  contract: ExternalIntelligenceSourceContract,
  capture?: ExternalIntelligencePayloadCapture,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  if (
    contract.sourceId !== SEC_PRESS_RELEASES_SOURCE_ID ||
    contract.sourceKind !== "regulator" ||
    contract.authority !== "authoritative" ||
    contract.sourceOrigin !== SEC_SOURCE_ORIGIN ||
    contract.publisherId !== SEC_PUBLISHER_ID ||
    contract.providerId !== SEC_PROVIDER_ID ||
    contract.contentPolicy !== "digest-only" ||
    contract.licenceRef !== SEC_RSS_POLICY_REF ||
    contract.attributionRequired !== true ||
    contract.deletionHandling !== "not-applicable" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    contract.maximumRetentionMs !== null ||
    contract.allowedAcquisitionModes.length !== 1 ||
    contract.allowedAcquisitionModes[0] !== "scheduled-poll"
  ) {
    throw new Error("SEC RSS source contract does not match the approved manifest");
  }
  if (capture === undefined) return;
  if (
    capture.sourceId !== contract.sourceId ||
    capture.sourceContractSha256 !== contract.sourceContractSha256 ||
    capture.sourceKind !== "regulator" ||
    capture.publisherId !== contract.publisherId ||
    capture.providerId !== contract.providerId ||
    capture.sourceRef !== SEC_PRESS_RELEASES_SOURCE_REF ||
    capture.acquisitionMode !== "scheduled-poll" ||
    !SEC_CONTENT_TYPES.includes(
      capture.contentType as (typeof SEC_CONTENT_TYPES)[number],
    ) ||
    capture.payloadRetention !== "transient-only" ||
    capture.modelTrainingAllowed !== false
  ) {
    throw new Error("SEC RSS capture does not match the approved manifest");
  }
}

async function parsePayload(
  capture: ExternalIntelligencePayloadCapture,
): Promise<readonly SecPressRelease[]> {
  if (capture.payloadByteLength !== capture.payloadBytes.byteLength) {
    throw new Error("SEC RSS payload byte length does not match its capture");
  }
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(capture.payloadBytes),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== capture.payloadSha256) {
    throw new Error("SEC RSS payload digest does not match its capture");
  }
  let xml: string;
  try {
    xml = decoder.decode(capture.payloadBytes);
  } catch {
    throw new Error("SEC RSS payload must be valid UTF-8 XML");
  }
  if (
    xml.length === 0 ||
    xml.length > MAXIMUM_XML_CHARACTERS ||
    /<!DOCTYPE|<!ENTITY/iu.test(xml)
  ) {
    throw new Error("SEC RSS payload contains forbidden or oversized XML");
  }
  const rss = /^\s*(?:<\?xml\s+[^<>]*\?>\s*)?<rss(?:\s+[^<>]*)?>([\s\S]*)<\/rss>\s*$/u.exec(
    xml,
  );
  if (rss === null || /<\/?rss(?:\s|>)/u.test(rss[1] ?? "")) {
    throw new Error("SEC RSS payload must contain one canonical RSS root");
  }
  const channels = [
    ...(rss[1] ?? "").matchAll(
      /<channel(?:\s+[^<>]*)?>([\s\S]*?)<\/channel>/gu,
    ),
  ];
  const channelOpenings = [
    ...(rss[1] ?? "").matchAll(/<channel(?:\s+[^<>]*)?>/gu),
  ].length;
  const channelClosings = [...(rss[1] ?? "").matchAll(/<\/channel>/gu)].length;
  if (
    channels.length !== 1 ||
    channelOpenings !== 1 ||
    channelClosings !== 1
  ) {
    throw new Error("SEC RSS payload must contain exactly one channel");
  }
  const channel = channels[0]?.[1] ?? "";
  const itemBlocks = [
    ...channel.matchAll(/<item(?:\s+[^<>]*)?>([\s\S]*?)<\/item>/gu),
  ];
  const itemOpenings = [...channel.matchAll(/<item(?:\s+[^<>]*)?>/gu)].length;
  const itemClosings = [...channel.matchAll(/<\/item>/gu)].length;
  if (
    itemOpenings !== itemBlocks.length ||
    itemClosings !== itemBlocks.length
  ) {
    throw new Error("SEC RSS payload contains malformed item markup");
  }
  if (itemBlocks.length > MAXIMUM_ITEMS) {
    throw new Error(`SEC RSS payload exceeds ${MAXIMUM_ITEMS} items`);
  }
  const items = itemBlocks.map((match) =>
    parseItem(match[1] ?? "", capture.receivedAtMs),
  );
  const externalIds = items.map((item) => item.externalId);
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error("SEC RSS payload contains duplicate press-release ids");
  }
  return [...items].sort((left, right) =>
    left.externalId.localeCompare(right.externalId),
  );
}

async function itemRecordFor(
  release: SecPressRelease,
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
): Promise<ExternalIntelligenceItemRecord> {
  const contentSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "sec-press-release-content-v1",
    externalId: release.externalId,
    sourceRef: release.sourceRef,
    title: release.title,
    publishedAtMs: release.publishedAtMs,
  });
  const itemId = await sha256CanonicalIntelligence({
    schemaVersion: "sec-press-release-item-id-v1",
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
    topicKey: `sec-press-release:${release.externalId}`,
    assetSymbols: [SEC_REGULATOR_SCOPE],
    eventType: "other",
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

export async function normaliseSecPressReleaseCapture(
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
  policy: ExternalIntelligencePolicy,
): Promise<NormalisedExternalIntelligenceCapture | null> {
  await assertManifest(contract, capture);
  const releases = await parsePayload(capture);
  if (releases.length === 0) return null;
  const itemRecords = await Promise.all(
    releases.map((release) => itemRecordFor(release, contract, capture)),
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
  if (retained.includes('"payloadBytes":') || retained.includes('"title":')) {
    throw new Error("SEC RSS normalisation retained raw provider content");
  }
  return result;
}

export async function createSecPressReleaseScheduledSource(
  contract: ExternalIntelligenceSourceContract,
  policy: ExternalIntelligencePolicy,
  declaredUserAgent: string,
): Promise<ScheduledExternalIntelligenceSource> {
  await assertManifest(contract);
  assertDeclaredUserAgent(declaredUserAgent);
  return {
    contract,
    target: {
      sourceId: SEC_PRESS_RELEASES_SOURCE_ID,
      sourceRef: SEC_PRESS_RELEASES_SOURCE_REF,
      acquisitionMode: "scheduled-poll",
      acceptedContentTypes: [...SEC_CONTENT_TYPES],
      userAgent: declaredUserAgent,
    },
    normaliseCapture: (capture) =>
      normaliseSecPressReleaseCapture(contract, capture, policy),
  };
}
