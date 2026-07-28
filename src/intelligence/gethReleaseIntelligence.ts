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
import { bytesToHex } from "../utils/encoding.ts";

export const GETH_RELEASES_SOURCE_ID = "ethereum-geth-github-releases";
export const GETH_RELEASES_SOURCE_REF =
  "https://api.github.com/repos/ethereum/go-ethereum/releases";
export const GITHUB_API_ORIGIN = "https://api.github.com/";
export const GITHUB_RELEASES_API_REF =
  "https://docs.github.com/en/rest/releases/releases#list-releases";
export const GITHUB_RATE_LIMIT_REF =
  "https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api";
export const GITHUB_TERMS_REF =
  "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms";
export const GITHUB_API_USER_AGENT = "LatinMaestro-AI-Trading-Bot/1.0";
export const GETH_REPOSITORY_REF = "https://github.com/ethereum/go-ethereum";
export const GETH_PUBLISHER_ID = "ethereum-go-ethereum";
export const GITHUB_RELEASES_PROVIDER_ID = "github-rest-api";
export const GETH_SCOPE = "ETH.GETH";

const MAXIMUM_RELEASES = 30;
const MAXIMUM_PROVIDER_TEXT_LENGTH = 100_000;
const RELEASE_TAG_PATTERN =
  /^v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,99})?$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });

interface GethRelease {
  readonly externalId: string;
  readonly sourceRef: string;
  readonly tag: string;
  readonly prerelease: boolean;
  readonly createdAtMs: number;
  readonly publishedAtMs: number;
  readonly nameSha256: string;
  readonly bodySha256: string;
  readonly providerName: string;
  readonly providerBody: string;
}

export interface ScheduledGethReleaseIntelligenceSource {
  readonly contract: ExternalIntelligenceSourceContract;
  readonly target: ExternalIntelligenceFeedTarget & {
    readonly acquisitionMode: "scheduled-poll";
  };
  normaliseCapture(
    capture: ExternalIntelligencePayloadCapture,
  ): Promise<NormalisedExternalIntelligenceCapture | null>;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function providerText(
  value: unknown,
  name: string,
  nullable = false,
): string {
  if (nullable && value === null) return "";
  if (
    typeof value !== "string" ||
    value.length > MAXIMUM_PROVIDER_TEXT_LENGTH ||
    value.includes("\u0000")
  ) {
    throw new Error(`${name} must be bounded provider text`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be boolean`);
  }
  return value;
}

function isoTime(value: unknown, name: string): number {
  const text = providerText(value, name);
  const parsed = Date.parse(text);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a valid non-negative ISO timestamp`);
  }
  return parsed;
}

function releaseTag(value: unknown): string {
  const tag = providerText(value, "Geth release tag");
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error("Geth release tag is unsupported");
  }
  return tag;
}

function canonicalReleaseUrl(value: unknown, tag: string): string {
  const text = providerText(value, "Geth release URL");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Geth release URL must be absolute");
  }
  if (
    url.toString() !== text ||
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Geth release URL is outside the approved repository");
  }
  const prefix = "/ethereum/go-ethereum/releases/tag/";
  if (!url.pathname.startsWith(prefix)) {
    throw new Error("Geth release URL is outside the approved repository");
  }
  let urlTag: string;
  try {
    urlTag = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    throw new Error("Geth release URL contains invalid encoding");
  }
  if (
    urlTag !== tag ||
    url.pathname !== `${prefix}${encodeURIComponent(tag)}`
  ) {
    throw new Error("Geth release URL does not match its tag");
  }
  return text;
}

async function parseRelease(
  value: unknown,
  receivedAtMs: number,
): Promise<GethRelease> {
  const release = record(value, "Geth release");
  const id = positiveInteger(release.id, "Geth release id");
  const tag = releaseTag(release.tag_name);
  const sourceRef = canonicalReleaseUrl(release.html_url, tag);
  if (boolean(release.draft, "Geth release draft")) {
    throw new Error("Geth release payload must not contain drafts");
  }
  const prerelease = boolean(release.prerelease, "Geth release prerelease");
  const createdAtMs = isoTime(release.created_at, "Geth release created_at");
  const publishedAtMs = isoTime(
    release.published_at,
    "Geth release published_at",
  );
  if (createdAtMs > publishedAtMs || publishedAtMs > receivedAtMs) {
    throw new Error("Geth release chronology is invalid");
  }
  const providerName = providerText(release.name, "Geth release name", true);
  const providerBody = providerText(release.body, "Geth release body", true);
  return {
    externalId: `release:${id}`,
    sourceRef,
    tag,
    prerelease,
    createdAtMs,
    publishedAtMs,
    nameSha256: await sha256CanonicalIntelligence({
      schemaVersion: "geth-release-name-v1",
      value: providerName,
    }),
    bodySha256: await sha256CanonicalIntelligence({
      schemaVersion: "geth-release-body-v1",
      value: providerBody,
    }),
    providerName,
    providerBody,
  };
}

async function assertManifest(
  contract: ExternalIntelligenceSourceContract,
  capture?: ExternalIntelligencePayloadCapture,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  if (
    contract.sourceId !== GETH_RELEASES_SOURCE_ID ||
    contract.sourceKind !== "issuer" ||
    contract.authority !== "authoritative" ||
    contract.sourceOrigin !== GITHUB_API_ORIGIN ||
    contract.publisherId !== GETH_PUBLISHER_ID ||
    contract.providerId !== GITHUB_RELEASES_PROVIDER_ID ||
    contract.contentPolicy !== "digest-only" ||
    contract.licenceRef !== GITHUB_TERMS_REF ||
    contract.attributionRequired !== true ||
    contract.deletionHandling !== "not-applicable" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    !contract.allowedAcquisitionModes.includes("scheduled-poll")
  ) {
    throw new Error(
      "Geth release source contract does not match the approved manifest",
    );
  }
  if (capture === undefined) return;
  if (
    capture.sourceId !== contract.sourceId ||
    capture.sourceContractSha256 !== contract.sourceContractSha256 ||
    capture.sourceKind !== "issuer" ||
    capture.publisherId !== contract.publisherId ||
    capture.providerId !== contract.providerId ||
    capture.sourceRef !== GETH_RELEASES_SOURCE_REF ||
    capture.acquisitionMode !== "scheduled-poll" ||
    !["application/json", "application/vnd.github+json"].includes(
      capture.contentType,
    ) ||
    capture.payloadRetention !== "transient-only" ||
    capture.modelTrainingAllowed !== false
  ) {
    throw new Error(
      "Geth release capture does not match the approved manifest",
    );
  }
}

async function parsePayload(
  capture: ExternalIntelligencePayloadCapture,
): Promise<readonly GethRelease[]> {
  if (capture.payloadByteLength !== capture.payloadBytes.byteLength) {
    throw new Error("Geth release byte length does not match its capture");
  }
  const digest = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(capture.payloadBytes),
      ),
    ),
  );
  if (digest !== capture.payloadSha256) {
    throw new Error("Geth release digest does not match its capture");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(capture.payloadBytes));
  } catch {
    throw new Error("Geth release payload must be valid UTF-8 JSON");
  }
  if (!Array.isArray(parsed) || parsed.length > MAXIMUM_RELEASES) {
    throw new Error(
      `Geth release payload must contain at most ${MAXIMUM_RELEASES} releases`,
    );
  }
  const releases = await Promise.all(
    parsed.map((entry) => parseRelease(entry, capture.receivedAtMs)),
  );
  const externalIds = releases.map((release) => release.externalId);
  const tags = releases.map((release) => release.tag);
  if (
    new Set(externalIds).size !== externalIds.length ||
    new Set(tags).size !== tags.length
  ) {
    throw new Error("Geth release payload contains duplicate identities");
  }
  return [...releases].sort((left, right) =>
    left.externalId.localeCompare(right.externalId),
  );
}

async function itemRecordFor(
  release: GethRelease,
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
): Promise<ExternalIntelligenceItemRecord> {
  const contentSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "geth-release-content-v1",
    externalId: release.externalId,
    sourceRef: release.sourceRef,
    tag: release.tag,
    prerelease: release.prerelease,
    createdAtMs: release.createdAtMs,
    publishedAtMs: release.publishedAtMs,
    nameSha256: release.nameSha256,
    bodySha256: release.bodySha256,
  });
  const item: ExternalIntelligenceItem = {
    itemId: await sha256CanonicalIntelligence({
      schemaVersion: "geth-release-item-id-v1",
      sourceId: contract.sourceId,
      externalId: release.externalId,
    }),
    sourceId: contract.sourceId,
    sourceKind: "issuer",
    authority: "authoritative",
    publisherId: contract.publisherId,
    sourceRef: release.sourceRef,
    externalId: release.externalId,
    acquisitionMode: "scheduled-poll",
    topicKey: `geth-release:${release.externalId}`,
    assetSymbols: [GETH_SCOPE],
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

export async function normaliseGethReleaseCapture(
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
  if (
    retained.includes("payloadBytes") ||
    releases.some(
      (release) =>
        (release.providerName.length > 0 &&
          retained.includes(release.providerName)) ||
        (release.providerBody.length > 0 &&
          retained.includes(release.providerBody)),
    )
  ) {
    throw new Error("Geth release normalisation retained provider text");
  }
  return result;
}

export async function createGethReleaseScheduledSource(
  contract: ExternalIntelligenceSourceContract,
  policy: ExternalIntelligencePolicy,
): Promise<ScheduledGethReleaseIntelligenceSource> {
  await assertManifest(contract);
  return {
    contract,
    target: {
      sourceId: GETH_RELEASES_SOURCE_ID,
      sourceRef: GETH_RELEASES_SOURCE_REF,
      acquisitionMode: "scheduled-poll",
      acceptedContentTypes: [
        "application/json",
        "application/vnd.github+json",
      ],
      userAgent: GITHUB_API_USER_AGENT,
    },
    normaliseCapture: (capture) =>
      normaliseGethReleaseCapture(contract, capture, policy),
  };
}
