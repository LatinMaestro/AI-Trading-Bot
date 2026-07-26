import { bytesToHex } from "../utils/encoding.ts";
import { sha256Hex } from "../utils/crypto.ts";
import type { KrakenLifecycleSourceClass } from "./krakenLifecycle.ts";

const MAXIMUM_TARGETS = 100;
const MAXIMUM_CONCURRENCY = 8;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 2_000_000;
const DEFAULT_MAXIMUM_TOTAL_BYTES = 10_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_MEDIA_TYPES = new Set([
  "application/json",
  "application/problem+json",
  "application/xml",
  "text/html",
  "text/plain",
  "text/xml",
]);

type PublicFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface KrakenLifecycleCaptureTarget {
  readonly sourceClass: KrakenLifecycleSourceClass;
  readonly sourceRef: string;
}

export interface KrakenRawLifecycleDocument {
  readonly documentSha256: string;
  readonly sourceClass: KrakenLifecycleSourceClass;
  readonly sourceRef: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
  readonly contentType: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly byteLength: number;
  readonly payloadText: string;
}

export interface KrakenLifecycleCaptureRun {
  readonly runSha256: string;
  readonly recordedAtMs: number;
  readonly targetCount: number;
  readonly documents: readonly KrakenRawLifecycleDocument[];
}

export interface KrakenLifecycleCaptureOptions {
  readonly fetchImpl?: PublicFetch;
  readonly clock?: () => number;
  readonly maximumConcurrentRequests?: number;
  readonly maximumResponseBytes?: number;
  readonly maximumTotalBytes?: number;
  readonly requestTimeoutMs?: number;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot hash non-finite data");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Cannot hash unsupported data");
}

function assertSafeTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
}

function assertOfficialSource(
  sourceClass: KrakenLifecycleSourceClass,
  sourceRef: string,
): URL {
  let url: URL;
  try {
    url = new URL(sourceRef);
  } catch {
    throw new Error("Lifecycle capture sourceRef must be an absolute URL");
  }
  if (
    url.toString() !== sourceRef ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Lifecycle capture sourceRef must be canonical HTTPS");
  }
  const allowed =
    sourceClass === "asset-listing"
      ? url.hostname === "blog.kraken.com" &&
        url.pathname.startsWith("/product/asset-listings/")
      : sourceClass === "status-incident"
        ? url.hostname === "status.kraken.com" &&
          (url.pathname.startsWith("/api/v2/incidents") ||
            url.pathname.startsWith("/incidents/"))
        : url.hostname === "support.kraken.com" &&
          url.pathname.startsWith("/articles/");
  if (!allowed) {
    throw new Error(`Lifecycle capture sourceRef is not official for ${sourceClass}`);
  }
  return url;
}

function canonicalHeader(value: string | null, name: string): string | undefined {
  if (value === null) return undefined;
  const canonical = value.trim();
  if (
    canonical.length === 0 ||
    canonical.length > 1_000 ||
    canonical.includes("\r") ||
    canonical.includes("\n")
  ) {
    throw new Error(`${name} header is invalid`);
  }
  return canonical;
}

function canonicalContentType(value: string | null): string {
  if (value === null) throw new Error("Lifecycle source omitted Content-Type");
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new Error(`Lifecycle source returned unsupported Content-Type ${value}`);
  }
  return mediaType;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        const value = values[index];
        if (value === undefined) throw new Error("Lifecycle capture index is invalid");
        results[index] = await task(value);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function captureDocument(
  target: KrakenLifecycleCaptureTarget,
  fetchImpl: PublicFetch,
  clock: () => number,
  requestTimeoutMs: number,
  maximumResponseBytes: number,
): Promise<KrakenRawLifecycleDocument> {
  const url = assertOfficialSource(target.sourceClass, target.sourceRef);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "text/html, application/json;q=0.9, text/plain;q=0.8",
    },
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Lifecycle source returned HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > maximumResponseBytes) {
    throw new Error(
      `Lifecycle source payload must contain 1 to ${maximumResponseBytes} bytes`,
    );
  }
  let payloadText: string;
  try {
    payloadText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Lifecycle source payload must be valid UTF-8");
  }
  if (payloadText.includes("\u0000")) {
    throw new Error("Lifecycle source payload contains a NUL character");
  }
  const fetchedAtMs = clock();
  assertSafeTime("lifecycle document fetchedAtMs", fetchedAtMs);
  const payloadSha256 = await sha256Bytes(bytes);
  const contentType = canonicalContentType(response.headers.get("content-type"));
  const etag = canonicalHeader(response.headers.get("etag"), "ETag");
  const lastModified = canonicalHeader(
    response.headers.get("last-modified"),
    "Last-Modified",
  );
  const canonical = {
    sourceClass: target.sourceClass,
    sourceRef: target.sourceRef,
    fetchedAtMs,
    payloadSha256,
    contentType,
    etag,
    lastModified,
    byteLength: bytes.byteLength,
  };
  return {
    documentSha256: await sha256Hex(canonicalJson(canonical)),
    ...canonical,
    payloadText,
  };
}

export async function captureKrakenLifecycleSources(
  targets: readonly KrakenLifecycleCaptureTarget[],
  options: KrakenLifecycleCaptureOptions = {},
): Promise<KrakenLifecycleCaptureRun> {
  if (targets.length < 1 || targets.length > MAXIMUM_TARGETS) {
    throw new Error(`Lifecycle capture requires 1 to ${MAXIMUM_TARGETS} targets`);
  }
  const maximumConcurrentRequests = options.maximumConcurrentRequests ?? 3;
  const maximumResponseBytes =
    options.maximumResponseBytes ?? DEFAULT_MAXIMUM_RESPONSE_BYTES;
  const maximumTotalBytes = options.maximumTotalBytes ?? DEFAULT_MAXIMUM_TOTAL_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertPositiveInteger(
    "maximumConcurrentRequests",
    maximumConcurrentRequests,
    MAXIMUM_CONCURRENCY,
  );
  assertPositiveInteger(
    "maximumResponseBytes",
    maximumResponseBytes,
    10_000_000,
  );
  assertPositiveInteger("maximumTotalBytes", maximumTotalBytes, 50_000_000);
  assertPositiveInteger("requestTimeoutMs", requestTimeoutMs, 60_000);

  const identities = new Set<string>();
  const sortedTargets = [...targets].sort((left, right) =>
    `${left.sourceClass}:${left.sourceRef}`.localeCompare(
      `${right.sourceClass}:${right.sourceRef}`,
    ),
  );
  for (const target of sortedTargets) {
    assertOfficialSource(target.sourceClass, target.sourceRef);
    const identity = `${target.sourceClass}:${target.sourceRef}`;
    if (identities.has(identity)) throw new Error(`Duplicate lifecycle target ${identity}`);
    identities.add(identity);
  }

  const clock = options.clock ?? Date.now;
  const documents = await mapBounded(
    sortedTargets,
    maximumConcurrentRequests,
    (target) =>
      captureDocument(
        target,
        options.fetchImpl ?? fetch,
        clock,
        requestTimeoutMs,
        maximumResponseBytes,
      ),
  );
  const totalBytes = documents.reduce(
    (total, document) => total + document.byteLength,
    0,
  );
  if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumTotalBytes) {
    throw new Error(`Lifecycle capture exceeded ${maximumTotalBytes} total bytes`);
  }
  const recordedAtMs = clock();
  assertSafeTime("lifecycle capture recordedAtMs", recordedAtMs);
  if (documents.some((document) => document.fetchedAtMs > recordedAtMs)) {
    throw new Error("Lifecycle capture recordedAtMs precedes a document fetch");
  }
  const sortedDocuments = [...documents].sort((left, right) =>
    `${left.sourceRef}:${left.documentSha256}`.localeCompare(
      `${right.sourceRef}:${right.documentSha256}`,
    ),
  );
  const runContent = {
    recordedAtMs,
    targetCount: sortedTargets.length,
    documentSha256Values: sortedDocuments.map(
      (document) => document.documentSha256,
    ),
  };
  return {
    runSha256: await sha256Hex(canonicalJson(runContent)),
    recordedAtMs,
    targetCount: sortedTargets.length,
    documents: sortedDocuments,
  };
}
