import { bytesToHex } from "../utils/encoding.ts";
import type {
  IntelligenceAcquisitionMode,
  IntelligenceSourceKind,
} from "./externalIntelligence.ts";
import {
  sourceContractAllowsReference,
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAXIMUM_RETRY_DELAY_MS = 60_000;
const MAXIMUM_TIMEOUT_MS = 60_000;
const MAXIMUM_ATTEMPTS = 2;
const MAXIMUM_PAYLOAD_BYTES = 1_048_576;
const MAXIMUM_CONTENT_TYPES = 8;
const CONTENT_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const FORBIDDEN_QUERY_PARAMETER_PATTERN =
  /^(?:api[-_]?key|key|token|access[-_]?token|secret|signature|sig|auth|authorization)$/iu;
const encoder = new TextEncoder();

export type ExternalIntelligenceFeedAcquisitionMode = Extract<
  IntelligenceAcquisitionMode,
  "minute-poll" | "scheduled-poll"
>;

export type ExternalIntelligenceAdapterSourceKind = Exclude<
  IntelligenceSourceKind,
  "reddit"
>;

export interface ExternalIntelligenceFeedTarget {
  readonly sourceId: string;
  readonly sourceRef: string;
  readonly acquisitionMode: ExternalIntelligenceFeedAcquisitionMode;
  readonly acceptedContentTypes: readonly string[];
}

export interface ExternalIntelligenceWebhookTarget {
  readonly sourceId: string;
  readonly sourceRef: string;
  readonly acceptedContentTypes: readonly string[];
}

export interface ExternalIntelligenceCacheValidators {
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface ExternalIntelligencePayloadCapture {
  readonly captureId: string;
  readonly sourceId: string;
  readonly sourceContractSha256: string;
  readonly sourceKind: ExternalIntelligenceAdapterSourceKind;
  readonly publisherId: string;
  readonly providerId: string;
  readonly sourceRef: string;
  readonly acquisitionMode: Exclude<IntelligenceAcquisitionMode, "stream">;
  readonly requestStartedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly responseLatencyMs: number;
  readonly availabilityLatencyMs: number;
  readonly payloadSha256: string;
  readonly payloadByteLength: number;
  readonly payloadBytes: Uint8Array;
  readonly contentType: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly payloadRetention: "transient-only" | "contract-permitted-full";
  readonly modelTrainingAllowed: false;
}

export interface ExternalIntelligenceNotModified {
  readonly status: "not-modified";
  readonly sourceId: string;
  readonly sourceContractSha256: string;
  readonly sourceRef: string;
  readonly acquisitionMode: ExternalIntelligenceFeedAcquisitionMode;
  readonly requestStartedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly responseLatencyMs: number;
  readonly availabilityLatencyMs: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly attempts: number;
}

export interface ExternalIntelligencePayloadResult {
  readonly status: "payload";
  readonly capture: ExternalIntelligencePayloadCapture;
  readonly attempts: number;
}

export type ExternalIntelligenceFeedPollResult =
  | ExternalIntelligenceNotModified
  | ExternalIntelligencePayloadResult;

export interface PollExternalIntelligenceFeedOptions {
  readonly scheduledAtMs: number;
  readonly cacheValidators?: ExternalIntelligenceCacheValidators;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
}

export interface ExternalIntelligenceWebhookVerificationInput {
  readonly body: Uint8Array;
  readonly headers: Headers;
  readonly sourceId: string;
  readonly sourceContractSha256: string;
  readonly receivedAtMs: number;
}

export interface CaptureExternalIntelligenceWebhookOptions {
  readonly receivedAtMs: number;
  readonly verifySignature: (
    input: ExternalIntelligenceWebhookVerificationInput,
  ) => boolean | Promise<boolean>;
  readonly nowMs?: () => number;
  readonly timeoutMs?: number;
}

interface AttemptDeadline {
  readonly signal: AbortSignal;
  race<T>(promise: Promise<T>): Promise<T>;
  clear(): void;
}

class ExternalIntelligenceHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, retryAfterMs: number | null) {
    super(`External intelligence source returned HTTP ${status}`);
    this.name = "ExternalIntelligenceHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function assertBoundedTimeout(value: number): void {
  assertPositiveInteger("timeoutMs", value);
  if (value > MAXIMUM_TIMEOUT_MS) {
    throw new Error(`timeoutMs must not exceed ${MAXIMUM_TIMEOUT_MS}`);
  }
}

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

function canonicalHeader(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    throw new Error("External intelligence response contains an unsafe cache header");
  }
  return trimmed;
}

function canonicalContentTypes(values: readonly string[]): readonly string[] {
  if (values.length < 1 || values.length > MAXIMUM_CONTENT_TYPES) {
    throw new Error(
      `acceptedContentTypes must contain 1 to ${MAXIMUM_CONTENT_TYPES} values`,
    );
  }
  const contentTypes = values.map((value) => {
    if (
      value.trim() !== value ||
      value !== value.toLowerCase() ||
      !CONTENT_TYPE_PATTERN.test(value)
    ) {
      throw new Error(`Invalid accepted content type ${value}`);
    }
    return value;
  });
  if (new Set(contentTypes).size !== contentTypes.length) {
    throw new Error("acceptedContentTypes contains duplicates");
  }
  return [...contentTypes].sort();
}

function assertCanonicalSourceRef(value: string): void {
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
  url.searchParams.forEach((_value, name) => {
    if (FORBIDDEN_QUERY_PARAMETER_PATTERN.test(name)) {
      throw new Error("sourceRef query must not contain credentials or signatures");
    }
  });
}

function contentTypeOf(headers: Headers): string {
  const raw = headers.get("content-type");
  if (raw === null) {
    throw new Error("External intelligence response is missing Content-Type");
  }
  const contentType = raw.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!CONTENT_TYPE_PATTERN.test(contentType)) {
    throw new Error("External intelligence response has invalid Content-Type");
  }
  return contentType;
}

function assertDeclaredLength(headers: Headers): void {
  const declaredLength = headers.get("content-length");
  if (declaredLength === null) return;
  const parsed = Number(declaredLength);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAXIMUM_PAYLOAD_BYTES
  ) {
    throw new Error("External intelligence Content-Length is outside bounds");
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

function timeoutError(): Error {
  const error = new Error("External intelligence acquisition timed out");
  error.name = "TimeoutError";
  return error;
}

function createAttemptDeadline(timeoutMs: number): AttemptDeadline {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, timeoutMs);
  });
  return {
    signal: controller.signal,
    race: <T>(promise: Promise<T>) => Promise.race([promise, timeout]),
    clear: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  deadline: AttemptDeadline,
): Promise<Uint8Array> {
  if (body === null) {
    throw new Error("External intelligence payload is missing a body");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await deadline.race(reader.read());
      if (done) break;
      if (value.byteLength === 0) continue;
      if (total + value.byteLength > MAXIMUM_PAYLOAD_BYTES) {
        try {
          await reader.cancel("External intelligence payload exceeds limit");
        } catch {
          // The size rejection remains authoritative if cancellation also fails.
        }
        throw new Error("External intelligence payload is outside bounds");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      try {
        await reader.cancel("External intelligence payload timed out");
      } catch {
        // The timeout rejection remains authoritative.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total === 0) {
    throw new Error("External intelligence payload is outside bounds");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function retryableError(error: unknown): boolean {
  if (error instanceof ExternalIntelligenceHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function retryAfterMs(headers: Headers, nowMs: number): number | null {
  const value = headers.get("retry-after");
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    return Math.min(Number(trimmed) * 1_000, MAXIMUM_RETRY_DELAY_MS);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(0, parsed - nowMs), MAXIMUM_RETRY_DELAY_MS);
}

function assertChronology(
  requestStartedAtMs: number,
  receivedAtMs: number,
  availableAtMs: number,
): void {
  assertTime("requestStartedAtMs", requestStartedAtMs);
  assertTime("receivedAtMs", receivedAtMs);
  assertTime("availableAtMs", availableAtMs);
  if (requestStartedAtMs > receivedAtMs || receivedAtMs > availableAtMs) {
    throw new Error("External intelligence acquisition chronology is invalid");
  }
}

async function assertApprovedAdapter(
  contract: ExternalIntelligenceSourceContract,
  sourceId: string,
  sourceRef: string,
  acquisitionMode: Exclude<IntelligenceAcquisitionMode, "stream">,
  atMs: number,
): Promise<ExternalIntelligenceAdapterSourceKind> {
  await verifyExternalIntelligenceSourceContract(contract);
  assertCanonicalText("sourceId", sourceId);
  assertCanonicalSourceRef(sourceRef);
  assertTime("adapter time", atMs);
  if (sourceId !== contract.sourceId) {
    throw new Error("Adapter sourceId does not match its source contract");
  }
  if (contract.sourceKind === "reddit") {
    throw new Error("Reddit requires the separate compliant OAuth collector");
  }
  if (!contract.enabled) {
    throw new Error("External intelligence source contract is disabled");
  }
  if (
    atMs < contract.effectiveFromMs ||
    (contract.expiresAtMs !== null && atMs >= contract.expiresAtMs)
  ) {
    throw new Error("External intelligence source contract is not active");
  }
  if (!contract.allowedAcquisitionModes.includes(acquisitionMode)) {
    throw new Error("Source contract does not permit this acquisition mode");
  }
  if (!sourceContractAllowsReference(contract, sourceRef)) {
    throw new Error("Source reference is outside the approved source origin");
  }
  return contract.sourceKind;
}

function payloadRetention(
  contract: ExternalIntelligenceSourceContract,
): ExternalIntelligencePayloadCapture["payloadRetention"] {
  return contract.contentPolicy === "permitted-full"
    ? "contract-permitted-full"
    : "transient-only";
}

async function createPayloadCapture(
  contract: ExternalIntelligenceSourceContract,
  sourceKind: ExternalIntelligenceAdapterSourceKind,
  sourceRef: string,
  acquisitionMode: Exclude<IntelligenceAcquisitionMode, "stream">,
  requestStartedAtMs: number,
  receivedAtMs: number,
  bytes: Uint8Array,
  contentType: string,
  etag: string | null,
  lastModified: string | null,
  nowMs: () => number,
  deadline: AttemptDeadline,
): Promise<ExternalIntelligencePayloadCapture> {
  const payloadSha256 = await deadline.race(sha256Bytes(bytes));
  const availableAtMs = nowMs();
  assertChronology(requestStartedAtMs, receivedAtMs, availableAtMs);
  const envelope = JSON.stringify({
    schemaVersion: "external-intelligence-payload-capture-v1",
    sourceId: contract.sourceId,
    sourceContractSha256: contract.sourceContractSha256,
    sourceKind,
    sourceRef,
    acquisitionMode,
    requestStartedAtMs,
    receivedAtMs,
    availableAtMs,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    contentType,
    etag,
    lastModified,
  });
  return {
    captureId: await deadline.race(sha256Bytes(encoder.encode(envelope))),
    sourceId: contract.sourceId,
    sourceContractSha256: contract.sourceContractSha256,
    sourceKind,
    publisherId: contract.publisherId,
    providerId: contract.providerId,
    sourceRef,
    acquisitionMode,
    requestStartedAtMs,
    receivedAtMs,
    availableAtMs,
    responseLatencyMs: receivedAtMs - requestStartedAtMs,
    availabilityLatencyMs: availableAtMs - receivedAtMs,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    payloadBytes: bytes,
    contentType,
    etag,
    lastModified,
    payloadRetention: payloadRetention(contract),
    modelTrainingAllowed: false,
  };
}

function requestHeaders(
  target: ExternalIntelligenceFeedTarget,
  cacheValidators: ExternalIntelligenceCacheValidators | undefined,
): Headers {
  const headers = new Headers({
    Accept: target.acceptedContentTypes.join(", "),
    "User-Agent": "AI-Trading-Bot-External-Intelligence/1",
  });
  if (cacheValidators?.etag !== null && cacheValidators?.etag !== undefined) {
    const etag = canonicalHeader(cacheValidators.etag);
    if (etag !== null) headers.set("If-None-Match", etag);
  }
  if (
    cacheValidators?.lastModified !== null &&
    cacheValidators?.lastModified !== undefined
  ) {
    const lastModified = canonicalHeader(cacheValidators.lastModified);
    if (lastModified !== null) {
      headers.set("If-Modified-Since", lastModified);
    }
  }
  return headers;
}

export async function pollExternalIntelligenceFeed(
  contract: ExternalIntelligenceSourceContract,
  target: ExternalIntelligenceFeedTarget,
  options: PollExternalIntelligenceFeedOptions,
): Promise<ExternalIntelligenceFeedPollResult> {
  const acceptedContentTypes = canonicalContentTypes(target.acceptedContentTypes);
  const canonicalTarget = { ...target, acceptedContentTypes };
  const sourceKind = await assertApprovedAdapter(
    contract,
    target.sourceId,
    target.sourceRef,
    target.acquisitionMode,
    options.scheduledAtMs,
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  assertBoundedTimeout(timeoutMs);
  assertPositiveInteger("retryDelayMs", retryDelayMs);
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const nowMs = options.nowMs ?? Date.now;

  for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt += 1) {
    const requestStartedAtMs = nowMs();
    assertTime("requestStartedAtMs", requestStartedAtMs);
    if (requestStartedAtMs < options.scheduledAtMs) {
      throw new Error("External intelligence request precedes its scheduled slot");
    }
    const deadline = createAttemptDeadline(timeoutMs);
    try {
      const response = await deadline.race(
        (options.fetchImpl ?? fetch)(target.sourceRef, {
          method: "GET",
          redirect: "error",
          signal: deadline.signal,
          headers: requestHeaders(canonicalTarget, options.cacheValidators),
        }),
      );
      const receivedAtMs = nowMs();
      assertChronology(requestStartedAtMs, receivedAtMs, receivedAtMs);
      if (response.url !== "" && response.url !== target.sourceRef) {
        throw new Error(
          "External intelligence source redirected away from its canonical URL",
        );
      }
      const etag = canonicalHeader(response.headers.get("etag"));
      const lastModified = canonicalHeader(
        response.headers.get("last-modified"),
      );
      if (response.status === 304) {
        if (
          options.cacheValidators === undefined ||
          (options.cacheValidators.etag === null &&
            options.cacheValidators.lastModified === null)
        ) {
          throw new Error(
            "External intelligence returned 304 without cache validators",
          );
        }
        const availableAtMs = nowMs();
        assertChronology(requestStartedAtMs, receivedAtMs, availableAtMs);
        return {
          status: "not-modified",
          sourceId: contract.sourceId,
          sourceContractSha256: contract.sourceContractSha256,
          sourceRef: target.sourceRef,
          acquisitionMode: target.acquisitionMode,
          requestStartedAtMs,
          receivedAtMs,
          availableAtMs,
          responseLatencyMs: receivedAtMs - requestStartedAtMs,
          availabilityLatencyMs: availableAtMs - receivedAtMs,
          etag: etag ?? options.cacheValidators.etag,
          lastModified:
            lastModified ?? options.cacheValidators.lastModified,
          attempts: attempt,
        };
      }
      if (!response.ok) {
        throw new ExternalIntelligenceHttpError(
          response.status,
          retryAfterMs(response.headers, receivedAtMs),
        );
      }
      const contentType = contentTypeOf(response.headers);
      if (!acceptedContentTypes.includes(contentType)) {
        throw new Error(
          `External intelligence source returned unsupported ${contentType}`,
        );
      }
      assertDeclaredLength(response.headers);
      const bytes = await readBoundedBody(response.body, deadline);
      return {
        status: "payload",
        capture: await createPayloadCapture(
          contract,
          sourceKind,
          target.sourceRef,
          target.acquisitionMode,
          requestStartedAtMs,
          receivedAtMs,
          bytes,
          contentType,
          etag,
          lastModified,
          nowMs,
          deadline,
        ),
        attempts: attempt,
      };
    } catch (error: unknown) {
      if (attempt >= MAXIMUM_ATTEMPTS || !retryableError(error)) {
        throw error;
      }
      const providerDelay =
        error instanceof ExternalIntelligenceHttpError
          ? error.retryAfterMs
          : null;
      deadline.clear();
      await sleep(
        providerDelay ??
          Math.min(retryDelayMs * attempt, MAXIMUM_RETRY_DELAY_MS),
      );
    } finally {
      deadline.clear();
    }
  }
  throw new Error("External intelligence polling exhausted without a result");
}

export async function captureExternalIntelligenceWebhook(
  contract: ExternalIntelligenceSourceContract,
  target: ExternalIntelligenceWebhookTarget,
  request: Request,
  options: CaptureExternalIntelligenceWebhookOptions,
): Promise<ExternalIntelligencePayloadCapture> {
  const acceptedContentTypes = canonicalContentTypes(target.acceptedContentTypes);
  const sourceKind = await assertApprovedAdapter(
    contract,
    target.sourceId,
    target.sourceRef,
    "webhook",
    options.receivedAtMs,
  );
  if (request.method !== "POST") {
    throw new Error("External intelligence webhook requires POST");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertBoundedTimeout(timeoutMs);
  const contentType = contentTypeOf(request.headers);
  if (!acceptedContentTypes.includes(contentType)) {
    throw new Error(
      `External intelligence webhook returned unsupported ${contentType}`,
    );
  }
  assertDeclaredLength(request.headers);
  const deadline = createAttemptDeadline(timeoutMs);
  try {
    const bytes = await readBoundedBody(request.body, deadline);
    const verified = await deadline.race(
      Promise.resolve(
        options.verifySignature({
          body: bytes.slice(),
          headers: request.headers,
          sourceId: contract.sourceId,
          sourceContractSha256: contract.sourceContractSha256,
          receivedAtMs: options.receivedAtMs,
        }),
      ),
    );
    if (verified !== true) {
      throw new Error("External intelligence webhook signature is invalid");
    }
    return createPayloadCapture(
      contract,
      sourceKind,
      target.sourceRef,
      "webhook",
      options.receivedAtMs,
      options.receivedAtMs,
      bytes,
      contentType,
      canonicalHeader(request.headers.get("etag")),
      canonicalHeader(request.headers.get("last-modified")),
      options.nowMs ?? Date.now,
      deadline,
    );
  } finally {
    deadline.clear();
  }
}
