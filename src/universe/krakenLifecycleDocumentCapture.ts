import { sha256Hex } from "../utils/crypto.ts";
import type {
  KrakenLifecycleDiscoveredTarget,
  KrakenLifecycleDiscoveryResult,
} from "./krakenLifecycleDiscovery.ts";

const MAXIMUM_PAYLOAD_BYTES = 1_048_576;
const MAXIMUM_BATCH_TARGETS = 10;
const DEFAULT_BATCH_TARGETS = 8;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAXIMUM_ATTEMPTS = 2;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface KrakenLifecycleDocumentCapture {
  readonly captureId: string;
  readonly sourceKind: KrakenLifecycleDiscoveredTarget["sourceKind"];
  readonly sourceRef: string;
  readonly discoveredFromCaptureId: string;
  readonly discoveredFromPayloadSha256: string;
  readonly discoverySha256: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly payloadByteLength: number;
  readonly payloadText: string;
  readonly contentType: "text/html";
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface KrakenLifecycleDocumentCaptureSink {
  persistDocumentCaptures(
    captures: readonly KrakenLifecycleDocumentCapture[],
    committedAtMs: number,
  ): Promise<void>;
}

export interface KrakenLifecycleDocumentCaptureBatchOptions {
  readonly alreadyCapturedSourceRefs?: ReadonlySet<string>;
  readonly maximumTargets?: number;
  readonly nowMs?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly requestSpacingMs?: number;
}

export interface KrakenLifecycleDocumentCaptureBatchResult {
  readonly captures: readonly KrakenLifecycleDocumentCapture[];
  readonly selectedTargetCount: number;
  readonly remainingTargetCount: number;
  readonly requestCount: number;
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
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

function canonicalHeader(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    throw new Error("Lifecycle document response contains an unsafe cache header");
  }
  return trimmed;
}

export function assertCanonicalKrakenLifecycleDiscoveredTarget(
  target: KrakenLifecycleDiscoveredTarget,
): void {
  assertDigest("discoveredFromCaptureId", target.discoveredFromCaptureId);
  assertDigest(
    "discoveredFromPayloadSha256",
    target.discoveredFromPayloadSha256,
  );
  if (
    target.sourceRef.length === 0 ||
    target.sourceRef.length > 500 ||
    target.sourceRef.trim() !== target.sourceRef ||
    /[\u0000-\u001f\u007f\\%]/u.test(target.sourceRef)
  ) {
    throw new Error("Lifecycle document target is not canonical");
  }
  let url: URL;
  try {
    url = new URL(target.sourceRef);
  } catch {
    throw new Error("Lifecycle document target is not canonical");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname.endsWith("/") ||
    target.sourceRef !== `https://${url.hostname}${url.pathname}`
  ) {
    throw new Error("Lifecycle document target is not canonical");
  }
  const canonical =
    target.sourceKind === "asset-listing-document"
      ? url.hostname === "blog.kraken.com" &&
        /^\/product\/asset-listings\/[a-z0-9][a-z0-9-]{0,199}$/u.test(
          url.pathname,
        )
      : target.sourceKind === "asset-listings-index-page"
        ? url.hostname === "blog.kraken.com" &&
          /^\/category\/product\/asset-listings\/page\/(?:[2-9]|[1-9][0-9]|[1-4][0-9]{2}|500)$/u.test(
            url.pathname,
          )
        : target.sourceKind === "support-lifecycle-document" &&
          url.hostname === "support.kraken.com" &&
          /^\/articles\/[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u.test(url.pathname);
  if (!canonical) {
    throw new Error("Lifecycle document target is not canonical");
  }
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const statusMatch = /returned HTTP (\d{3})/u.exec(error.message);
  if (statusMatch !== null) return retryable(Number(statusMatch[1]));
  return (
    error instanceof TypeError ||
    error.name === "AbortError" ||
    error.name === "TimeoutError"
  );
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (response.body === null) {
    throw new Error("Lifecycle document response is missing a body");
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
          await reader.cancel("Lifecycle document response exceeds limit");
        } catch {
          // The size rejection remains authoritative.
        }
        throw new Error("Lifecycle document response body is outside bounds");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) {
    throw new Error("Lifecycle document response body is outside bounds");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchDocument(
  target: KrakenLifecycleDiscoveredTarget,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{
  readonly response: Response;
  readonly bytes: Uint8Array;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target.sourceRef, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "text/html",
        "User-Agent": "AI-Trading-Bot-Lifecycle-Document-Capture/1",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Lifecycle document ${target.sourceKind} returned HTTP ${response.status}`,
      );
    }
    if (response.url !== "" && response.url !== target.sourceRef) {
      throw new Error("Lifecycle document redirected away from its canonical URL");
    }
    const rawContentType = response.headers.get("content-type");
    const contentType =
      rawContentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (contentType !== "text/html") {
      throw new Error(
        `Lifecycle document returned unsupported ${contentType || "Content-Type"}`,
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
        throw new Error(
          "Lifecycle document Content-Length is outside bounds",
        );
      }
    }
    return { response, bytes: await readBoundedBody(response) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function captureKrakenLifecycleDiscoveredTarget(
  target: KrakenLifecycleDiscoveredTarget,
  discoverySha256: string,
  fetchedAtMs: number,
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  } = {},
): Promise<KrakenLifecycleDocumentCapture> {
  assertCanonicalKrakenLifecycleDiscoveredTarget(target);
  assertDigest("discoverySha256", discoverySha256);
  assertTime("fetchedAtMs", fetchedAtMs);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertPositiveInteger("timeoutMs", timeoutMs);
  const { response, bytes } = await fetchDocument(
    target,
    options.fetchImpl ?? fetch,
    timeoutMs,
  );
  let payloadText: string;
  try {
    payloadText = decoder.decode(bytes);
  } catch {
    throw new Error("Lifecycle document response is not valid UTF-8");
  }
  const roundTrip = encoder.encode(payloadText);
  const payloadSha256 = await sha256Hex(payloadText);
  if (
    roundTrip.byteLength !== bytes.byteLength ||
    payloadSha256 !== (await sha256Hex(decoder.decode(bytes)))
  ) {
    throw new Error(
      "Lifecycle document payload cannot be preserved as exact UTF-8 text",
    );
  }
  const etag = canonicalHeader(response.headers.get("etag"));
  const lastModified = canonicalHeader(response.headers.get("last-modified"));
  const captureEnvelope = JSON.stringify({
    schemaVersion: "kraken-lifecycle-document-capture-v1",
    sourceKind: target.sourceKind,
    sourceRef: target.sourceRef,
    discoveredFromCaptureId: target.discoveredFromCaptureId,
    discoveredFromPayloadSha256: target.discoveredFromPayloadSha256,
    discoverySha256,
    fetchedAtMs,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    contentType: "text/html",
    etag,
    lastModified,
  });
  return {
    captureId: await sha256Hex(captureEnvelope),
    sourceKind: target.sourceKind,
    sourceRef: target.sourceRef,
    discoveredFromCaptureId: target.discoveredFromCaptureId,
    discoveredFromPayloadSha256: target.discoveredFromPayloadSha256,
    discoverySha256,
    fetchedAtMs,
    payloadSha256,
    payloadByteLength: bytes.byteLength,
    payloadText,
    contentType: "text/html",
    etag,
    lastModified,
  };
}

function targetIdentity(target: KrakenLifecycleDiscoveredTarget): string {
  return `${target.sourceKind}\u0000${target.sourceRef}`;
}

export async function captureKrakenLifecycleDiscoveryBatch(
  discovery: KrakenLifecycleDiscoveryResult,
  sink: KrakenLifecycleDocumentCaptureSink,
  options: KrakenLifecycleDocumentCaptureBatchOptions = {},
): Promise<KrakenLifecycleDocumentCaptureBatchResult> {
  assertDigest("discoverySha256", discovery.discoverySha256);
  if (discovery.targets.length > 2_000) {
    throw new Error("Lifecycle discovery contains too many targets");
  }
  const maximumTargets = options.maximumTargets ?? DEFAULT_BATCH_TARGETS;
  if (
    !Number.isSafeInteger(maximumTargets) ||
    maximumTargets < 1 ||
    maximumTargets > MAXIMUM_BATCH_TARGETS
  ) {
    throw new Error("maximumTargets must be an integer from 1 to 10");
  }
  const alreadyCaptured = options.alreadyCapturedSourceRefs ?? new Set<string>();
  const identities = new Set<string>();
  const remaining = [...discovery.targets]
    .sort(
      (left, right) =>
        left.sourceKind.localeCompare(right.sourceKind) ||
        left.sourceRef.localeCompare(right.sourceRef),
    )
    .filter((target) => {
      assertCanonicalKrakenLifecycleDiscoveredTarget(target);
      const identity = targetIdentity(target);
      if (identities.has(identity)) {
        throw new Error("Lifecycle discovery contains duplicate targets");
      }
      identities.add(identity);
      return !alreadyCaptured.has(target.sourceRef);
    });
  const selected = remaining.slice(0, maximumTargets);
  if (selected.length === 0) {
    return {
      captures: [],
      selectedTargetCount: 0,
      remainingTargetCount: 0,
      requestCount: 0,
    };
  }

  const nowMs = options.nowMs ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const requestSpacingMs = options.requestSpacingMs ?? 250;
  assertPositiveInteger("timeoutMs", timeoutMs);
  assertPositiveInteger("retryDelayMs", retryDelayMs);
  if (!Number.isSafeInteger(requestSpacingMs) || requestSpacingMs < 0) {
    throw new Error("requestSpacingMs must be a non-negative safe integer");
  }

  const captures: KrakenLifecycleDocumentCapture[] = [];
  let requestCount = 0;
  for (const [index, target] of selected.entries()) {
    if (index > 0 && requestSpacingMs > 0) await sleep(requestSpacingMs);
    for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt += 1) {
      const fetchedAtMs = nowMs();
      assertTime("document fetchedAtMs", fetchedAtMs);
      requestCount += 1;
      try {
        captures.push(
          await captureKrakenLifecycleDiscoveredTarget(
            target,
            discovery.discoverySha256,
            fetchedAtMs,
            { fetchImpl, timeoutMs },
          ),
        );
        break;
      } catch (error: unknown) {
        if (attempt >= MAXIMUM_ATTEMPTS || !retryableError(error)) throw error;
        await sleep(retryDelayMs * attempt);
      }
    }
  }
  const committedAtMs = nowMs();
  assertTime("document committedAtMs", committedAtMs);
  if (
    captures.length !== selected.length ||
    captures.some((capture) => capture.fetchedAtMs > committedAtMs)
  ) {
    throw new Error("Lifecycle document capture batch is incomplete");
  }
  await sink.persistDocumentCaptures(captures, committedAtMs);
  return {
    captures,
    selectedTargetCount: selected.length,
    remainingTargetCount: remaining.length - selected.length,
    requestCount,
  };
}
