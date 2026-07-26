import { bytesToHex } from "../utils/encoding.ts";

const DAY_MS = 86_400_000;
const MAXIMUM_PAYLOAD_BYTES = 1_048_576;
const CHUNK_BYTES = 32_768;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAXIMUM_ATTEMPTS = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type KrakenLifecycleCaptureSourceKind =
  | "asset-listings-index"
  | "delistings-index"
  | "status-incidents"
  | "status-maintenance";

export interface KrakenLifecycleCaptureTarget {
  readonly sourceKind: KrakenLifecycleCaptureSourceKind;
  readonly sourceRef: string;
  readonly acceptedContentTypes: readonly string[];
}

export interface KrakenLifecycleCaptureChunk {
  readonly index: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly text: string;
}

export interface KrakenLifecycleSourceCapture {
  readonly captureId: string;
  readonly sourceKind: KrakenLifecycleCaptureSourceKind;
  readonly sourceRef: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly payloadByteLength: number;
  readonly contentType: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly chunks: readonly KrakenLifecycleCaptureChunk[];
}

export interface KrakenLifecycleCaptureSink {
  persistCaptures(
    captures: readonly KrakenLifecycleSourceCapture[],
    committedAtMs: number,
  ): Promise<void>;
}

export interface ScheduledKrakenLifecycleCaptureOptions {
  readonly scheduledAtMs: number;
  readonly nowMs?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly requestSpacingMs?: number;
}

export interface ScheduledKrakenLifecycleCaptureResult {
  readonly due: boolean;
  readonly captures: readonly KrakenLifecycleSourceCapture[];
  readonly requestCount: number;
}

interface FetchedLifecycleTarget {
  readonly response: Response;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export const KRAKEN_LIFECYCLE_CAPTURE_TARGETS: readonly KrakenLifecycleCaptureTarget[] = [
  {
    sourceKind: "asset-listings-index",
    sourceRef: "https://blog.kraken.com/category/product/asset-listings",
    acceptedContentTypes: ["text/html"],
  },
  {
    sourceKind: "delistings-index",
    sourceRef: "https://support.kraken.com/sections/delistings",
    acceptedContentTypes: ["text/html"],
  },
  {
    sourceKind: "status-incidents",
    sourceRef: "https://status.kraken.com/api/v2/incidents.json",
    acceptedContentTypes: ["application/json"],
  },
  {
    sourceKind: "status-maintenance",
    sourceRef: "https://status.kraken.com/api/v2/scheduled-maintenances.json",
    acceptedContentTypes: ["application/json"],
  },
] as const;

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

function canonicalHeader(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    throw new Error("Lifecycle response contains an unsafe cache header");
  }
  return trimmed;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

function splitUtf8(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of text) {
    const characterBytes = encoder.encode(character).byteLength;
    if (characterBytes > CHUNK_BYTES) {
      throw new Error("Lifecycle payload contains an oversized UTF-8 character");
    }
    if (currentBytes + characterBytes > CHUNK_BYTES && current.length > 0) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current.length > 0) chunks.push(current);
  if (chunks.length === 0 || chunks.length > 64) {
    throw new Error("Lifecycle payload has an invalid chunk count");
  }
  return chunks;
}

function contentTypeOf(response: Response): string {
  const raw = response.headers.get("content-type");
  if (raw === null) throw new Error("Lifecycle response is missing Content-Type");
  const contentType = raw.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contentType.length === 0 || contentType.length > 100) {
    throw new Error("Lifecycle response has invalid Content-Type");
  }
  return contentType;
}

function assertCanonicalTarget(target: KrakenLifecycleCaptureTarget): void {
  const matched = KRAKEN_LIFECYCLE_CAPTURE_TARGETS.find(
    (candidate) =>
      candidate.sourceKind === target.sourceKind &&
      candidate.sourceRef === target.sourceRef,
  );
  if (matched === undefined) {
    throw new Error("Lifecycle capture target is not allowlisted");
  }
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const statusMatch = /returned HTTP (\d{3})/.exec(error.message);
  if (statusMatch !== null) return retryable(Number(statusMatch[1]));
  return error instanceof TypeError || error.name === "AbortError";
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (response.body === null) {
    throw new Error("Lifecycle response is missing a body");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      if (total + value.byteLength > MAXIMUM_PAYLOAD_BYTES) {
        try {
          await reader.cancel("Lifecycle response body exceeds limit");
        } catch {
          // The size rejection remains authoritative even if cancellation fails.
        }
        throw new Error("Lifecycle response body is outside bounds");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) {
    throw new Error("Lifecycle response body is outside bounds");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchTarget(
  target: KrakenLifecycleCaptureTarget,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchedLifecycleTarget> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target.sourceRef, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: target.acceptedContentTypes.join(", "),
        "User-Agent": "AI-Trading-Bot-Lifecycle-Capture/1",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Lifecycle source ${target.sourceKind} returned HTTP ${response.status}`,
      );
    }
    if (response.url !== "" && response.url !== target.sourceRef) {
      throw new Error("Lifecycle source redirected away from its canonical URL");
    }
    const contentType = contentTypeOf(response);
    if (!target.acceptedContentTypes.includes(contentType)) {
      throw new Error(
        `Lifecycle source ${target.sourceKind} returned unsupported ${contentType}`,
      );
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const parsed = Number(declaredLength);
      if (
        !Number.isSafeInteger(parsed) ||
        parsed <= 0 ||
        parsed > MAXIMUM_PAYLOAD_BYTES
      ) {
        throw new Error("Lifecycle response Content-Length is outside bounds");
      }
    }
    const bytes = await readBoundedBody(response);
    return { response, contentType, bytes };
  } finally {
    clearTimeout(timeout);
  }
}

export function isKrakenLifecycleCaptureDue(scheduledAtMs: number): boolean {
  assertTime("scheduledAtMs", scheduledAtMs);
  return scheduledAtMs % DAY_MS === 0;
}

export async function captureKrakenLifecycleTarget(
  target: KrakenLifecycleCaptureTarget,
  fetchedAtMs: number,
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  } = {},
): Promise<KrakenLifecycleSourceCapture> {
  assertCanonicalTarget(target);
  assertTime("fetchedAtMs", fetchedAtMs);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertPositiveInteger("timeoutMs", timeoutMs);
  const { response, contentType, bytes } = await fetchTarget(
    target,
    options.fetchImpl ?? fetch,
    timeoutMs,
  );
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new Error("Lifecycle response is not valid UTF-8");
  }
  const roundTrip = encoder.encode(text);
  const payloadSha256 = await sha256Bytes(bytes);
  if (
    roundTrip.byteLength !== bytes.byteLength ||
    (await sha256Bytes(roundTrip)) !== payloadSha256
  ) {
    throw new Error("Lifecycle payload cannot be preserved as exact UTF-8 text");
  }
  const chunkTexts = splitUtf8(text);
  const chunks: KrakenLifecycleCaptureChunk[] = [];
  for (const [index, chunkText] of chunkTexts.entries()) {
    const chunkBytes = encoder.encode(chunkText);
    chunks.push({
      index,
      sha256: await sha256Bytes(chunkBytes),
      byteLength: chunkBytes.byteLength,
      text: chunkText,
    });
  }
  if (
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) !==
    bytes.byteLength
  ) {
    throw new Error("Lifecycle capture chunks do not reconstruct the payload");
  }
  const etag = canonicalHeader(response.headers.get("etag"));
  const lastModified = canonicalHeader(response.headers.get("last-modified"));
  const captureEnvelope = JSON.stringify({
    schemaVersion: "kraken-lifecycle-source-capture-v1",
    sourceKind: target.sourceKind,
    sourceRef: target.sourceRef,
    fetchedAtMs,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    contentType,
    etag,
    lastModified,
    chunks: chunks.map((chunk) => ({
      index: chunk.index,
      sha256: chunk.sha256,
      byteLength: chunk.byteLength,
    })),
  });
  return {
    captureId: await sha256Bytes(encoder.encode(captureEnvelope)),
    sourceKind: target.sourceKind,
    sourceRef: target.sourceRef,
    fetchedAtMs,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    contentType,
    etag,
    lastModified,
    chunks,
  };
}

export async function runScheduledKrakenLifecycleCapture(
  sink: KrakenLifecycleCaptureSink,
  options: ScheduledKrakenLifecycleCaptureOptions,
): Promise<ScheduledKrakenLifecycleCaptureResult> {
  const scheduledAtMs = options.scheduledAtMs;
  if (!isKrakenLifecycleCaptureDue(scheduledAtMs)) {
    return { due: false, captures: [], requestCount: 0 };
  }
  const nowMs = options.nowMs ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const requestSpacingMs = options.requestSpacingMs ?? 250;
  assertPositiveInteger("timeoutMs", timeoutMs);
  assertPositiveInteger("retryDelayMs", retryDelayMs);
  if (!Number.isSafeInteger(requestSpacingMs) || requestSpacingMs < 0) {
    throw new Error("requestSpacingMs must be a non-negative safe integer");
  }

  const captures: KrakenLifecycleSourceCapture[] = [];
  let requestCount = 0;
  for (const [targetIndex, target] of KRAKEN_LIFECYCLE_CAPTURE_TARGETS.entries()) {
    if (targetIndex > 0 && requestSpacingMs > 0) {
      await sleep(requestSpacingMs);
    }
    for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt += 1) {
      const fetchedAtMs = nowMs();
      assertTime("capture fetchedAtMs", fetchedAtMs);
      requestCount += 1;
      try {
        captures.push(
          await captureKrakenLifecycleTarget(target, fetchedAtMs, {
            fetchImpl,
            timeoutMs,
          }),
        );
        break;
      } catch (error: unknown) {
        if (attempt >= MAXIMUM_ATTEMPTS || !retryableError(error)) {
          throw error;
        }
        await sleep(retryDelayMs * attempt);
      }
    }
  }
  const committedAtMs = nowMs();
  assertTime("capture committedAtMs", committedAtMs);
  if (captures.length !== KRAKEN_LIFECYCLE_CAPTURE_TARGETS.length) {
    throw new Error("Lifecycle capture set is incomplete");
  }
  if (captures.some((capture) => capture.fetchedAtMs > committedAtMs)) {
    throw new Error("Lifecycle capture commit precedes a source fetch");
  }
  await sink.persistCaptures(captures, committedAtMs);
  return { due: true, captures, requestCount };
}