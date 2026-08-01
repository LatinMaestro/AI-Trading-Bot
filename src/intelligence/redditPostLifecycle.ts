import {
  REDDIT_DATA_API_TERMS_REF,
  REDDIT_MAXIMUM_RETENTION_MS,
  REDDIT_OAUTH_ORIGIN,
  REDDIT_PROVIDER_ID,
  REDDIT_PUBLISHER_ID,
  createRedditOAuthInfoTarget,
  createRedditOAuthListingTarget,
  type RedditOAuthInfoTarget,
  type RedditOAuthListingCapture,
  type RedditOAuthListingTarget,
} from "./redditOAuthAdapter.ts";
import { sha256CanonicalIntelligence } from "./canonical.ts";
import { externalIntelligencePayloadCaptureId } from "./sourceAdapters.ts";
import {
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";
import { bytesToHex } from "../utils/encoding.ts";

const POST_ID_PATTERN = /^[0-9a-z]{1,13}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_POSTS = 100;
const SWEEP_INTERVAL_MS = 15 * 60 * 1_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

interface ParsedRedditPost {
  readonly fullname: string;
  readonly publishedAtMs: number;
  readonly unavailable: boolean;
}

export interface RedditTransientPostObservation {
  readonly observationId: string;
  readonly sourceId: string;
  readonly sourceContractSha256: string;
  readonly captureId: string;
  readonly subreddit: string;
  readonly fullname: string;
  readonly sourceRef: string;
  readonly publishedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly payloadSha256: string;
  readonly metadataSha256: string;
  readonly deleteByMs: number;
  readonly contentPolicy: "metadata-only";
  readonly payloadRetention: "transient-only";
  readonly modelTrainingAllowed: false;
}

export interface RedditTransientPostBatch {
  readonly batchId: string;
  readonly sourceId: string;
  readonly sourceContractSha256: string;
  readonly captureId: string;
  readonly observations: readonly RedditTransientPostObservation[];
  readonly ignoredUnavailableCount: number;
  readonly durableQueueAllowed: false;
}

export type RedditRetentionPurgeReason =
  | "provider-unavailable"
  | "retention-expired";

export interface RedditRetentionPurge {
  readonly observationId: string;
  readonly reason: RedditRetentionPurgeReason;
  readonly purgeByMs: number;
}

export interface RedditRetentionAudit {
  readonly auditId: string;
  readonly sourceId: string;
  readonly observedAtMs: number;
  readonly checkedCount: number;
  readonly presentCount: number;
  readonly providerUnavailableCount: number;
  readonly retentionExpiredCount: number;
  readonly retainedCount: number;
  readonly nextSweepAtMs: number | null;
  readonly containsRedditPostData: false;
}

export interface RedditRetentionSweep {
  readonly retained: readonly RedditTransientPostObservation[];
  readonly purges: readonly RedditRetentionPurge[];
  readonly audit: RedditRetentionAudit;
  readonly durableQueueAllowed: false;
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function checkedAddTime(name: string, value: number, increment: number): number {
  const result = value + increment;
  if (!Number.isSafeInteger(result) || result < value) {
    throw new Error(`${name} exceeds the safe time range`);
  }
  return result;
}

function assertContractActive(
  contract: ExternalIntelligenceSourceContract,
  atMs: number,
): void {
  assertTime("Reddit contract activity time", atMs);
  if (
    atMs < contract.effectiveFromMs ||
    (contract.expiresAtMs !== null && atMs >= contract.expiresAtMs)
  ) {
    throw new Error("Reddit source contract is not active");
  }
}

async function assertManifest(
  contract: ExternalIntelligenceSourceContract,
  sourceId: string,
  atMs: number,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  if (
    contract.sourceId !== sourceId ||
    contract.sourceKind !== "reddit" ||
    contract.authority !== "social" ||
    contract.publisherId !== REDDIT_PUBLISHER_ID ||
    contract.providerId !== REDDIT_PROVIDER_ID ||
    contract.sourceOrigin !== REDDIT_OAUTH_ORIGIN ||
    contract.contentPolicy !== "metadata-only" ||
    contract.licenceRef !== REDDIT_DATA_API_TERMS_REF ||
    contract.attributionRequired !== true ||
    contract.maximumRetentionMs === null ||
    contract.maximumRetentionMs < 1 ||
    contract.maximumRetentionMs > REDDIT_MAXIMUM_RETENTION_MS ||
    contract.deletionHandling !== "required" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    contract.allowedAcquisitionModes.length !== 1 ||
    contract.allowedAcquisitionModes[0] !== "minute-poll" ||
    !SHA256_PATTERN.test(contract.sourceContractSha256)
  ) {
    throw new Error("Reddit post lifecycle contract is outside the manifest");
  }
  assertContractActive(contract, atMs);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  );
}

function objectOf(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parsePublishedAtMs(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
  ) {
    throw new Error("Reddit created_utc is invalid");
  }
  return value * 1_000;
}

function parsePermalink(value: unknown, subreddit: string, id: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 500 ||
    !value.startsWith(`/r/${subreddit}/comments/${id}/`) ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("%") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Reddit post permalink is not canonical");
  }
}

function providerUnavailable(data: Record<string, unknown>): boolean {
  const removed = data.removed_by_category;
  if (removed !== undefined && removed !== null && typeof removed !== "string") {
    throw new Error("Reddit removed_by_category is malformed");
  }
  for (const field of ["author", "title", "selftext"] as const) {
    const value = data[field];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Reddit ${field} is malformed`);
    }
  }
  return (
    (typeof removed === "string" && removed.length > 0) ||
    data.author === "[deleted]" ||
    data.title === "[deleted]" ||
    data.selftext === "[deleted]"
  );
}

async function parseListing(
  capture: RedditOAuthListingCapture,
  subreddit: string,
): Promise<readonly ParsedRedditPost[]> {
  if (
    capture.payloadByteLength !== capture.payloadBytes.byteLength ||
    capture.payloadSha256 !== (await sha256Bytes(capture.payloadBytes))
  ) {
    throw new Error("Reddit lifecycle payload identity does not match");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(capture.payloadBytes));
  } catch {
    throw new Error("Reddit lifecycle payload must be valid UTF-8 JSON");
  }
  const root = objectOf(parsed, "Reddit listing");
  if (root.kind !== "Listing") {
    throw new Error("Reddit lifecycle payload is not a Listing");
  }
  const data = objectOf(root.data, "Reddit listing data");
  if (!Array.isArray(data.children) || data.children.length > MAXIMUM_POSTS) {
    throw new Error("Reddit listing children are outside bounds");
  }
  const posts: ParsedRedditPost[] = [];
  const fullnames = new Set<string>();
  for (const value of data.children) {
    const child = objectOf(value, "Reddit listing child");
    if (child.kind !== "t3") {
      throw new Error("Reddit listing contains a non-post child");
    }
    const post = objectOf(child.data, "Reddit post");
    const id = post.id;
    if (typeof id !== "string" || !POST_ID_PATTERN.test(id)) {
      throw new Error("Reddit post id is not canonical");
    }
    const fullname = `t3_${id}`;
    if (
      post.name !== fullname ||
      post.subreddit !== subreddit ||
      post.subreddit_name_prefixed !== `r/${subreddit}` ||
      fullnames.has(fullname)
    ) {
      throw new Error("Reddit post identity is inconsistent");
    }
    parsePermalink(post.permalink, subreddit, id);
    const publishedAtMs = parsePublishedAtMs(post.created_utc);
    if (publishedAtMs > capture.receivedAtMs) {
      throw new Error("Reddit post publication is after receipt");
    }
    fullnames.add(fullname);
    posts.push({
      fullname,
      publishedAtMs,
      unavailable: providerUnavailable(post),
    });
  }
  return posts.sort((left, right) =>
    left.fullname.localeCompare(right.fullname),
  );
}

async function assertCapture(
  contract: ExternalIntelligenceSourceContract,
  sourceRef: string,
  capture: RedditOAuthListingCapture,
): Promise<void> {
  assertTime("Reddit lifecycle request start", capture.requestStartedAtMs);
  assertTime("Reddit lifecycle receipt", capture.receivedAtMs);
  assertTime("Reddit lifecycle availability", capture.availableAtMs);
  assertTime("Reddit lifecycle deletion deadline", capture.deleteByMs);
  assertTime("Reddit lifecycle response latency", capture.responseLatencyMs);
  assertTime(
    "Reddit lifecycle availability latency",
    capture.availabilityLatencyMs,
  );
  assertContractActive(contract, capture.requestStartedAtMs);
  assertContractActive(contract, capture.availableAtMs);
  const maximumRetentionMs = contract.maximumRetentionMs;
  if (maximumRetentionMs === null) {
    throw new Error("Reddit lifecycle contract lacks finite retention");
  }
  const expectedCaptureId = await externalIntelligencePayloadCaptureId({
    sourceId: contract.sourceId,
    sourceContractSha256: contract.sourceContractSha256,
    sourceKind: "reddit",
    sourceRef,
    acquisitionMode: "minute-poll",
    requestStartedAtMs: capture.requestStartedAtMs,
    receivedAtMs: capture.receivedAtMs,
    availableAtMs: capture.availableAtMs,
    payloadSha256: capture.payloadSha256,
    payloadByteLength: capture.payloadByteLength,
    contentType: "application/json",
    etag: null,
    lastModified: null,
  });
  if (
    capture.captureId !== expectedCaptureId ||
    capture.sourceId !== contract.sourceId ||
    capture.sourceContractSha256 !== contract.sourceContractSha256 ||
    capture.sourceKind !== "reddit" ||
    capture.publisherId !== contract.publisherId ||
    capture.providerId !== contract.providerId ||
    capture.sourceRef !== sourceRef ||
    capture.acquisitionMode !== "minute-poll" ||
    capture.contentType !== "application/json" ||
    capture.etag !== null ||
    capture.lastModified !== null ||
    capture.payloadRetention !== "transient-only" ||
    capture.modelTrainingAllowed !== false ||
    !SHA256_PATTERN.test(capture.payloadSha256) ||
    capture.requestStartedAtMs > capture.receivedAtMs ||
    capture.receivedAtMs > capture.availableAtMs ||
    capture.responseLatencyMs !==
      capture.receivedAtMs - capture.requestStartedAtMs ||
    capture.availabilityLatencyMs !==
      capture.availableAtMs - capture.receivedAtMs ||
    capture.deleteByMs !==
      checkedAddTime(
        "Reddit lifecycle deletion deadline",
        capture.receivedAtMs,
        maximumRetentionMs,
      )
  ) {
    throw new Error("Reddit lifecycle capture is inconsistent");
  }
}

export async function normaliseRedditPostListing(
  contract: ExternalIntelligenceSourceContract,
  target: RedditOAuthListingTarget,
  capture: RedditOAuthListingCapture,
): Promise<RedditTransientPostBatch> {
  await assertManifest(contract, target.sourceId, capture.availableAtMs);
  const expectedTarget = createRedditOAuthListingTarget(
    target.sourceId,
    target.subreddit,
  );
  if (
    target.sourceRef !== expectedTarget.sourceRef ||
    target.acquisitionMode !== expectedTarget.acquisitionMode ||
    target.limit !== expectedTarget.limit
  ) {
    throw new Error("Reddit post listing target is not canonical");
  }
  await assertCapture(contract, target.sourceRef, capture);
  const posts = await parseListing(capture, target.subreddit);
  const observations: RedditTransientPostObservation[] = [];
  let ignoredUnavailableCount = 0;
  for (const post of posts) {
    if (post.unavailable) {
      ignoredUnavailableCount += 1;
      continue;
    }
    const metadataSha256 = await sha256CanonicalIntelligence({
      schemaVersion: "reddit-transient-post-metadata-v1",
      sourceId: contract.sourceId,
      subreddit: target.subreddit,
      fullname: post.fullname,
      publishedAtMs: post.publishedAtMs,
    });
    const observationId = await sha256CanonicalIntelligence({
      schemaVersion: "reddit-transient-post-observation-v1",
      sourceContractSha256: contract.sourceContractSha256,
      captureId: capture.captureId,
      metadataSha256,
    });
    observations.push({
      observationId,
      sourceId: contract.sourceId,
      sourceContractSha256: contract.sourceContractSha256,
      captureId: capture.captureId,
      subreddit: target.subreddit,
      fullname: post.fullname,
      sourceRef: capture.sourceRef,
      publishedAtMs: post.publishedAtMs,
      receivedAtMs: capture.receivedAtMs,
      availableAtMs: capture.availableAtMs,
      payloadSha256: capture.payloadSha256,
      metadataSha256,
      deleteByMs: capture.deleteByMs,
      contentPolicy: "metadata-only",
      payloadRetention: "transient-only",
      modelTrainingAllowed: false,
    });
  }
  const canonical = {
    schemaVersion: "reddit-transient-post-batch-v1",
    sourceId: contract.sourceId,
    sourceContractSha256: contract.sourceContractSha256,
    captureId: capture.captureId,
    observationIds: observations.map((entry) => entry.observationId),
    ignoredUnavailableCount,
  };
  return {
    batchId: await sha256CanonicalIntelligence(canonical),
    sourceId: contract.sourceId,
    sourceContractSha256: contract.sourceContractSha256,
    captureId: capture.captureId,
    observations,
    ignoredUnavailableCount,
    durableQueueAllowed: false,
  };
}

async function assertObservation(
  observation: RedditTransientPostObservation,
  contract: ExternalIntelligenceSourceContract,
  target: RedditOAuthInfoTarget,
): Promise<void> {
  assertTime("Reddit observation publication", observation.publishedAtMs);
  assertTime("Reddit observation receipt", observation.receivedAtMs);
  assertTime("Reddit observation availability", observation.availableAtMs);
  assertTime("Reddit observation deletion deadline", observation.deleteByMs);
  const listingTarget = createRedditOAuthListingTarget(
    contract.sourceId,
    target.subreddit,
  );
  const metadataSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-transient-post-metadata-v1",
    sourceId: contract.sourceId,
    subreddit: target.subreddit,
    fullname: observation.fullname,
    publishedAtMs: observation.publishedAtMs,
  });
  const observationId = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-transient-post-observation-v1",
    sourceContractSha256: contract.sourceContractSha256,
    captureId: observation.captureId,
    metadataSha256,
  });
  const maximumRetentionMs = contract.maximumRetentionMs;
  if (
    maximumRetentionMs === null ||
    observation.observationId !== observationId ||
    observation.metadataSha256 !== metadataSha256 ||
    observation.sourceId !== contract.sourceId ||
    observation.sourceContractSha256 !== contract.sourceContractSha256 ||
    !SHA256_PATTERN.test(observation.captureId) ||
    observation.subreddit !== target.subreddit ||
    !target.fullnames.includes(observation.fullname) ||
    observation.sourceRef !== listingTarget.sourceRef ||
    observation.contentPolicy !== "metadata-only" ||
    observation.payloadRetention !== "transient-only" ||
    observation.modelTrainingAllowed !== false ||
    !SHA256_PATTERN.test(observation.payloadSha256) ||
    observation.publishedAtMs > observation.receivedAtMs ||
    observation.receivedAtMs > observation.availableAtMs ||
    observation.deleteByMs !==
      checkedAddTime(
        "Reddit observation deletion deadline",
        observation.receivedAtMs,
        maximumRetentionMs,
      )
  ) {
    throw new Error("Reddit transient observation is invalid");
  }
}

export async function reconcileRedditPostRetention(
  contract: ExternalIntelligenceSourceContract,
  observations: readonly RedditTransientPostObservation[],
  target: RedditOAuthInfoTarget,
  capture: RedditOAuthListingCapture,
): Promise<RedditRetentionSweep> {
  await assertManifest(contract, target.sourceId, capture.availableAtMs);
  const expectedTarget = createRedditOAuthInfoTarget(
    target.sourceId,
    target.subreddit,
    target.fullnames,
  );
  if (
    target.sourceRef !== expectedTarget.sourceRef ||
    target.acquisitionMode !== expectedTarget.acquisitionMode ||
    target.fullnames.some(
      (fullname, index) => fullname !== expectedTarget.fullnames[index],
    )
  ) {
    throw new Error("Reddit retention target is not canonical");
  }
  await assertCapture(contract, target.sourceRef, capture);
  if (
    observations.length < 1 ||
    observations.length !== target.fullnames.length ||
    observations.length > MAXIMUM_POSTS
  ) {
    throw new Error("Reddit retention sweep input is outside bounds");
  }
  const observationFullnames = observations.map((entry) => entry.fullname).sort();
  if (
    new Set(observationFullnames).size !== observationFullnames.length ||
    observationFullnames.some(
      (fullname, index) => fullname !== target.fullnames[index],
    )
  ) {
    throw new Error("Reddit retention sweep target does not match observations");
  }
  for (const observation of observations) {
    await assertObservation(observation, contract, target);
  }
  const current = new Map(
    (await parseListing(capture, target.subreddit)).map((entry) => [
      entry.fullname,
      entry,
    ]),
  );
  for (const fullname of current.keys()) {
    if (!target.fullnames.includes(fullname)) {
      throw new Error("Reddit info response contains an unrequested post");
    }
  }

  const retained: RedditTransientPostObservation[] = [];
  const purges: RedditRetentionPurge[] = [];
  let providerUnavailableCount = 0;
  let retentionExpiredCount = 0;
  for (const observation of [...observations].sort((left, right) =>
    left.fullname.localeCompare(right.fullname),
  )) {
    const post = current.get(observation.fullname);
    if (post !== undefined && post.publishedAtMs !== observation.publishedAtMs) {
      throw new Error("Reddit post immutable metadata changed");
    }
    const retentionExpired = capture.availableAtMs >= observation.deleteByMs;
    const unavailable = post === undefined || post.unavailable;
    if (retentionExpired || unavailable) {
      const reason = retentionExpired
        ? "retention-expired"
        : "provider-unavailable";
      if (reason === "retention-expired") retentionExpiredCount += 1;
      else providerUnavailableCount += 1;
      purges.push({
        observationId: observation.observationId,
        reason,
        purgeByMs: capture.availableAtMs,
      });
    } else {
      retained.push(observation);
    }
  }
  const nextSweepAtMs =
    retained.length === 0
      ? null
      : Math.min(
          checkedAddTime(
            "Reddit next retention sweep",
            capture.availableAtMs,
            SWEEP_INTERVAL_MS,
          ),
          ...retained.map((entry) => entry.deleteByMs),
        );
  const auditInput = {
    schemaVersion: "reddit-retention-audit-v1",
    sourceId: contract.sourceId,
    observedAtMs: capture.availableAtMs,
    checkedCount: observations.length,
    presentCount: current.size,
    providerUnavailableCount,
    retentionExpiredCount,
    retainedCount: retained.length,
    nextSweepAtMs,
    containsRedditPostData: false as const,
  };
  return {
    retained,
    purges,
    audit: {
      auditId: await sha256CanonicalIntelligence(auditInput),
      ...auditInput,
    },
    durableQueueAllowed: false,
  };
}

export function createRedditPostRetentionTarget(
  sourceId: string,
  subreddit: string,
  observations: readonly RedditTransientPostObservation[],
): RedditOAuthInfoTarget {
  return createRedditOAuthInfoTarget(
    sourceId,
    subreddit,
    observations.map((entry) => entry.fullname),
  );
}
