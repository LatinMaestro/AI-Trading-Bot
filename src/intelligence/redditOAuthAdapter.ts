import {
  externalIntelligencePayloadCaptureId,
} from "./sourceAdapters.ts";
import {
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";
import { bytesToHex } from "../utils/encoding.ts";

export const REDDIT_OAUTH_ORIGIN = "https://oauth.reddit.com/";
export const REDDIT_DATA_API_TERMS_REF =
  "https://redditinc.com/policies/data-api-terms";
export const REDDIT_DATA_API_WIKI_REF =
  "https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki";
export const REDDIT_PUBLISHER_ID = "reddit";
export const REDDIT_PROVIDER_ID = "reddit-data-api";
export const REDDIT_MAXIMUM_RETENTION_MS = 48 * 60 * 60 * 1_000;
export const REDDIT_FREE_WINDOW_MAXIMUM_MILLIQUERIES = 1_000_000;
export const REDDIT_RATE_RESERVE_MILLIQUERIES = 100_000;

const MAXIMUM_RESPONSE_BYTES = 1_048_576;
const MAXIMUM_ACCESS_TOKEN_LENGTH = 4_096;
const MAXIMUM_TIMEOUT_MS = 30_000;
const MINIMUM_REQUEST_SPACING_MS = 1_000;
const MAXIMUM_RATE_WINDOW_MS = 600_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{3,21}$/u;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface RedditOAuthListingTarget {
  readonly sourceId: string;
  readonly subreddit: string;
  readonly sourceRef: string;
  readonly acquisitionMode: "minute-poll";
  readonly limit: 100;
}

export interface RedditRateLimitState {
  readonly observedAtMs: number;
  readonly usedMilliqueries: number;
  readonly remainingMilliqueries: number;
  readonly resetAtMs: number;
  readonly nextAllowedRequestAtMs: number;
}

export interface RedditOAuthListingCapture {
  readonly captureId: string;
  readonly sourceId: string;
  readonly sourceContractSha256: string;
  readonly sourceKind: "reddit";
  readonly publisherId: string;
  readonly providerId: string;
  readonly sourceRef: string;
  readonly acquisitionMode: "minute-poll";
  readonly requestStartedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly responseLatencyMs: number;
  readonly availabilityLatencyMs: number;
  readonly payloadSha256: string;
  readonly payloadByteLength: number;
  readonly payloadBytes: Uint8Array;
  readonly contentType: "application/json";
  readonly etag: null;
  readonly lastModified: null;
  readonly payloadRetention: "transient-only";
  readonly deleteByMs: number;
  readonly rateLimit: RedditRateLimitState;
  readonly modelTrainingAllowed: false;
}

export type RedditOAuthListingOutcome =
  | {
      readonly status: "captured";
      readonly capture: RedditOAuthListingCapture;
      readonly rateLimit: RedditRateLimitState;
    }
  | {
      readonly status: "deferred";
      readonly capture: null;
      readonly rateLimit: RedditRateLimitState;
    }
  | {
      readonly status: "rate-limited";
      readonly capture: null;
      readonly rateLimit: RedditRateLimitState;
    };

export interface RedditOAuthFetcher {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface AcquireRedditOAuthListingOptions {
  readonly contract: ExternalIntelligenceSourceContract;
  readonly target: RedditOAuthListingTarget;
  readonly accessToken: string;
  readonly userAgent: string;
  readonly scheduledAtMs: number;
  readonly previousRateLimit?: RedditRateLimitState;
  readonly timeoutMs?: number;
  readonly fetcher?: RedditOAuthFetcher;
  readonly now?: () => number;
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

function assertCanonicalText(name: string, value: string): void {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be bounded canonical text`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function defaultFetcher(): RedditOAuthFetcher {
  return { fetch: (input, init) => fetch(input, init) };
}

export function createRedditOAuthUserAgent(
  redditUsername: string,
): string {
  if (!USERNAME_PATTERN.test(redditUsername)) {
    throw new Error("Reddit username is not canonical");
  }
  return `cloudflare-worker:ai-crypto-trader:v1.0 (by /u/${redditUsername})`;
}

export function createRedditOAuthListingTarget(
  sourceId: string,
  subreddit: string,
): RedditOAuthListingTarget {
  assertCanonicalText("Reddit sourceId", sourceId);
  if (!SUBREDDIT_PATTERN.test(subreddit)) {
    throw new Error("Reddit subreddit is not canonical");
  }
  return {
    sourceId,
    subreddit,
    sourceRef:
      `https://oauth.reddit.com/r/${subreddit}/new?limit=100&raw_json=1`,
    acquisitionMode: "minute-poll",
    limit: 100,
  };
}

function assertTarget(target: RedditOAuthListingTarget): void {
  const expected = createRedditOAuthListingTarget(
    target.sourceId,
    target.subreddit,
  );
  if (
    target.sourceRef !== expected.sourceRef ||
    target.acquisitionMode !== expected.acquisitionMode ||
    target.limit !== expected.limit
  ) {
    throw new Error("Reddit OAuth target is not canonical");
  }
}

async function assertManifest(
  contract: ExternalIntelligenceSourceContract,
  target: RedditOAuthListingTarget,
  atMs: number,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  assertTarget(target);
  if (
    contract.sourceId !== target.sourceId ||
    contract.sourceKind !== "reddit" ||
    contract.authority !== "social" ||
    contract.sourceOrigin !== REDDIT_OAUTH_ORIGIN ||
    contract.publisherId !== REDDIT_PUBLISHER_ID ||
    contract.providerId !== REDDIT_PROVIDER_ID ||
    contract.contentPolicy !== "metadata-only" ||
    contract.licenceRef !== REDDIT_DATA_API_TERMS_REF ||
    contract.attributionRequired !== true ||
    contract.maximumRetentionMs === null ||
    contract.maximumRetentionMs > REDDIT_MAXIMUM_RETENTION_MS ||
    contract.deletionHandling !== "required" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    contract.allowedAcquisitionModes.length !== 1 ||
    contract.allowedAcquisitionModes[0] !== "minute-poll"
  ) {
    throw new Error("Reddit source contract is outside the approved manifest");
  }
  assertContractActive(contract, atMs);
}

function assertAccessToken(value: string): void {
  if (
    value.trim() !== value ||
    value.length < 20 ||
    value.length > MAXIMUM_ACCESS_TOKEN_LENGTH ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    throw new Error("Reddit OAuth access token is malformed");
  }
}

function assertUserAgent(value: string): void {
  const match =
    /^cloudflare-worker:ai-crypto-trader:v1\.0 \(by \/u\/([A-Za-z0-9_-]{3,20})\)$/u.exec(
      value,
    );
  if (match === null || createRedditOAuthUserAgent(match[1] ?? "") !== value) {
    throw new Error("Reddit User-Agent is not truthful-format canonical");
  }
}

function parseDecimalMilliqueries(value: string | null, name: string): number {
  if (value === null || !/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,3})?$/u.test(value)) {
    throw new Error(`${name} is missing or malformed`);
  }
  const parsed = Number(value);
  const milliqueries = Math.round(parsed * 1_000);
  if (!Number.isSafeInteger(milliqueries) || milliqueries < 0) {
    throw new Error(`${name} is outside bounds`);
  }
  return milliqueries;
}

function parseResetMs(value: string | null): number {
  if (value === null || !/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,3})?$/u.test(value)) {
    throw new Error("X-Ratelimit-Reset is missing or malformed");
  }
  const resetMs = Math.ceil(Number(value) * 1_000);
  if (
    !Number.isSafeInteger(resetMs) ||
    resetMs < 0 ||
    resetMs > MAXIMUM_RATE_WINDOW_MS
  ) {
    throw new Error("X-Ratelimit-Reset is outside the free-access window");
  }
  return resetMs;
}

function rateLimitFromHeaders(
  headers: Headers,
  observedAtMs: number,
): RedditRateLimitState {
  assertTime("Reddit rate-limit observation", observedAtMs);
  const usedMilliqueries = parseDecimalMilliqueries(
    headers.get("x-ratelimit-used"),
    "X-Ratelimit-Used",
  );
  const remainingMilliqueries = parseDecimalMilliqueries(
    headers.get("x-ratelimit-remaining"),
    "X-Ratelimit-Remaining",
  );
  const resetMs = parseResetMs(headers.get("x-ratelimit-reset"));
  if (
    usedMilliqueries + remainingMilliqueries >
    REDDIT_FREE_WINDOW_MAXIMUM_MILLIQUERIES
  ) {
    throw new Error("Reddit rate-limit headers exceed the free-access ceiling");
  }
  const spendable =
    remainingMilliqueries - REDDIT_RATE_RESERVE_MILLIQUERIES;
  const spacingMs =
    spendable <= 0
      ? resetMs
      : Math.max(
          MINIMUM_REQUEST_SPACING_MS,
          Math.ceil((resetMs * 1_000) / spendable),
        );
  return {
    observedAtMs,
    usedMilliqueries,
    remainingMilliqueries,
    resetAtMs: checkedAddTime(
      "Reddit rate-limit reset",
      observedAtMs,
      resetMs,
    ),
    nextAllowedRequestAtMs: checkedAddTime(
      "Reddit next request time",
      observedAtMs,
      spendable <= 0 ? resetMs : spacingMs,
    ),
  };
}

function rateLimitFor429(
  headers: Headers,
  observedAtMs: number,
): RedditRateLimitState {
  const retryAfter = headers.get("retry-after");
  if (retryAfter === null || !/^(?:0|[1-9][0-9]{0,3})$/u.test(retryAfter)) {
    throw new Error("Reddit 429 response requires bounded Retry-After");
  }
  const retryAfterMs = Number(retryAfter) * 1_000;
  if (
    !Number.isSafeInteger(retryAfterMs) ||
    retryAfterMs < MINIMUM_REQUEST_SPACING_MS ||
    retryAfterMs > MAXIMUM_RATE_WINDOW_MS
  ) {
    throw new Error("Reddit Retry-After is outside bounds");
  }
  return {
    observedAtMs,
    usedMilliqueries: REDDIT_FREE_WINDOW_MAXIMUM_MILLIQUERIES,
    remainingMilliqueries: 0,
    resetAtMs: checkedAddTime(
      "Reddit Retry-After reset",
      observedAtMs,
      retryAfterMs,
    ),
    nextAllowedRequestAtMs: checkedAddTime(
      "Reddit Retry-After next request",
      observedAtMs,
      retryAfterMs,
    ),
  };
}

function assertPreviousRateLimit(value: RedditRateLimitState): void {
  assertTime("Reddit rate observedAtMs", value.observedAtMs);
  assertTime("Reddit rate resetAtMs", value.resetAtMs);
  assertTime(
    "Reddit rate nextAllowedRequestAtMs",
    value.nextAllowedRequestAtMs,
  );
  if (
    !Number.isSafeInteger(value.usedMilliqueries) ||
    !Number.isSafeInteger(value.remainingMilliqueries) ||
    value.usedMilliqueries < 0 ||
    value.remainingMilliqueries < 0 ||
    value.usedMilliqueries + value.remainingMilliqueries >
      REDDIT_FREE_WINDOW_MAXIMUM_MILLIQUERIES ||
    value.resetAtMs < value.observedAtMs ||
    value.nextAllowedRequestAtMs < value.observedAtMs ||
    value.nextAllowedRequestAtMs > value.resetAtMs
  ) {
    throw new Error("Previous Reddit rate-limit state is invalid");
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  let declaredLength: number | null = null;
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declared)) {
      throw new Error("Reddit Content-Length is malformed");
    }
    declaredLength = Number(declared);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 1 ||
      declaredLength > MAXIMUM_RESPONSE_BYTES
    ) {
      throw new Error("Reddit response length is outside bounds");
    }
  }
  if (response.body === null) {
    throw new Error("Reddit response body is missing");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel("Reddit response exceeded the byte ceiling");
      throw new Error("Reddit response exceeds the byte ceiling");
    }
    chunks.push(part.value);
  }
  if (total === 0) throw new Error("Reddit response body is empty");
  if (declaredLength !== null && total !== declaredLength) {
    throw new Error("Reddit response length does not match Content-Length");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertListingJson(bytes: Uint8Array): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("Reddit response must be valid UTF-8 JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as { kind?: unknown }).kind !== "Listing"
  ) {
    throw new Error("Reddit response is not a Listing");
  }
}

export async function acquireRedditOAuthListing(
  options: AcquireRedditOAuthListingOptions,
): Promise<RedditOAuthListingOutcome> {
  assertTime("scheduledAtMs", options.scheduledAtMs);
  await assertManifest(
    options.contract,
    options.target,
    options.scheduledAtMs,
  );
  const maximumRetentionMs = options.contract.maximumRetentionMs;
  if (maximumRetentionMs === null) {
    throw new Error("Reddit source contract is missing finite retention");
  }
  assertAccessToken(options.accessToken);
  assertUserAgent(options.userAgent);
  if (options.previousRateLimit !== undefined) {
    assertPreviousRateLimit(options.previousRateLimit);
    if (options.previousRateLimit.observedAtMs > options.scheduledAtMs) {
      throw new Error("Previous Reddit rate-limit state is from the future");
    }
    if (
      options.scheduledAtMs <
      options.previousRateLimit.nextAllowedRequestAtMs
    ) {
      return {
        status: "deferred",
        capture: null,
        rateLimit: options.previousRateLimit,
      };
    }
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAXIMUM_TIMEOUT_MS
  ) {
    throw new Error("Reddit timeout is outside bounds");
  }
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? defaultFetcher();
  const requestStartedAtMs = now();
  assertTime("Reddit request start", requestStartedAtMs);
  if (requestStartedAtMs < options.scheduledAtMs) {
    throw new Error("Reddit request precedes its scheduled slot");
  }
  assertContractActive(options.contract, requestStartedAtMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher.fetch(options.target.sourceRef, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.accessToken}`,
        "user-agent": options.userAgent,
      },
      signal: controller.signal,
    });
    const receivedAtMs = now();
    assertTime("Reddit receipt", receivedAtMs);
    if (receivedAtMs < requestStartedAtMs) {
      throw new Error("Reddit receipt precedes request start");
    }
    if (
      response.redirected ||
      (response.url !== "" && response.url !== options.target.sourceRef)
    ) {
      throw new Error("Reddit OAuth response is not from the canonical target");
    }
    if (response.status === 429) {
      return {
        status: "rate-limited",
        capture: null,
        rateLimit: rateLimitFor429(response.headers, receivedAtMs),
      };
    }
    if (
      response.status !== 200 ||
      !response.ok
    ) {
      throw new Error(`Reddit OAuth request failed with HTTP ${response.status}`);
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      throw new Error("Reddit response has an unsupported media type");
    }
    const rateLimit = rateLimitFromHeaders(response.headers, receivedAtMs);
    const payloadBytes = await readBoundedBody(response);
    const availableAtMs = now();
    assertTime("Reddit availability", availableAtMs);
    if (availableAtMs < receivedAtMs) {
      throw new Error("Reddit availability precedes receipt");
    }
    assertListingJson(payloadBytes);
    const payloadSha256 = bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(payloadBytes),
        ),
      ),
    );
    assertDigest("Reddit payloadSha256", payloadSha256);
    const captureId = await externalIntelligencePayloadCaptureId({
      sourceId: options.contract.sourceId,
      sourceContractSha256: options.contract.sourceContractSha256,
      sourceKind: "reddit",
      sourceRef: options.target.sourceRef,
      acquisitionMode: "minute-poll",
      requestStartedAtMs,
      receivedAtMs,
      availableAtMs,
      payloadSha256,
      payloadByteLength: payloadBytes.byteLength,
      contentType: "application/json",
      etag: null,
      lastModified: null,
    });
    const capture: RedditOAuthListingCapture = {
      captureId,
      sourceId: options.contract.sourceId,
      sourceContractSha256: options.contract.sourceContractSha256,
      sourceKind: "reddit",
      publisherId: options.contract.publisherId,
      providerId: options.contract.providerId,
      sourceRef: options.target.sourceRef,
      acquisitionMode: "minute-poll",
      requestStartedAtMs,
      receivedAtMs,
      availableAtMs,
      responseLatencyMs: receivedAtMs - requestStartedAtMs,
      availabilityLatencyMs: availableAtMs - receivedAtMs,
      payloadSha256,
      payloadByteLength: payloadBytes.byteLength,
      payloadBytes,
      contentType: "application/json",
      etag: null,
      lastModified: null,
      payloadRetention: "transient-only",
      deleteByMs: checkedAddTime(
        "Reddit deletion deadline",
        receivedAtMs,
        maximumRetentionMs,
      ),
      rateLimit,
      modelTrainingAllowed: false,
    };
    return { status: "captured", capture, rateLimit };
  } finally {
    clearTimeout(timeout);
  }
}
