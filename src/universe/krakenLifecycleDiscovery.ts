import { sha256Hex } from "../utils/crypto.ts";
import type {
  KrakenLifecycleCaptureSourceKind,
  KrakenLifecycleSourceCapture,
} from "./krakenLifecycleCapture.ts";

const ASSET_LISTINGS_INDEX =
  "https://blog.kraken.com/category/product/asset-listings";
const DELISTINGS_INDEX = "https://support.kraken.com/sections/delistings";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_LINK_ATTRIBUTES = 5_000;
const MAXIMUM_DISCOVERED_TARGETS = 2_000;
const MAXIMUM_LISTING_INDEX_PAGE = 500;
const HREF_PATTERN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;

export type KrakenLifecycleDiscoveredTargetKind =
  | "asset-listing-document"
  | "asset-listings-index-page"
  | "support-lifecycle-document";

export interface KrakenLifecycleDiscoveredTarget {
  readonly sourceKind: KrakenLifecycleDiscoveredTargetKind;
  readonly sourceRef: string;
  readonly discoveredFromCaptureId: string;
  readonly discoveredFromPayloadSha256: string;
}

export interface KrakenLifecycleDiscoveryResult {
  readonly targets: readonly KrakenLifecycleDiscoveredTarget[];
  readonly assetListingDocuments: readonly KrakenLifecycleDiscoveredTarget[];
  readonly assetListingIndexPages: readonly KrakenLifecycleDiscoveredTarget[];
  readonly supportLifecycleDocuments: readonly KrakenLifecycleDiscoveredTarget[];
  readonly discoverySha256: string;
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertIndexCapture(
  capture: KrakenLifecycleSourceCapture,
  expectedKind: KrakenLifecycleCaptureSourceKind,
  expectedRef: string,
): void {
  if (
    capture.sourceKind !== expectedKind ||
    capture.sourceRef !== expectedRef ||
    capture.contentType !== "text/html" ||
    capture.payloadText.length === 0 ||
    !Number.isSafeInteger(capture.payloadByteLength) ||
    capture.payloadByteLength < 1 ||
    capture.payloadByteLength > 1_048_576 ||
    new TextEncoder().encode(capture.payloadText).byteLength !==
      capture.payloadByteLength
  ) {
    throw new Error(`${expectedKind} capture is not canonical`);
  }
  assertDigest("captureId", capture.captureId);
  assertDigest("payloadSha256", capture.payloadSha256);
}

function indexCapture(
  captures: readonly KrakenLifecycleSourceCapture[],
  sourceKind: KrakenLifecycleCaptureSourceKind,
  sourceRef: string,
): KrakenLifecycleSourceCapture {
  const matched = captures.filter((capture) => capture.sourceKind === sourceKind);
  if (matched.length !== 1) {
    throw new Error(`Lifecycle discovery requires exactly one ${sourceKind}`);
  }
  const capture = matched[0];
  if (capture === undefined) {
    throw new Error(`Lifecycle discovery is missing ${sourceKind}`);
  }
  assertIndexCapture(capture, sourceKind, sourceRef);
  return capture;
}

function canonicalCandidate(rawHref: string, baseRef: string): URL | null {
  if (
    rawHref.length === 0 ||
    rawHref.length > 500 ||
    rawHref.trim() !== rawHref ||
    /[\u0000-\u001f\u007f\\]/u.test(rawHref) ||
    rawHref.includes("&")
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(rawHref, baseRef);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return url;
}

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function targetFromUrl(
  url: URL,
  capture: KrakenLifecycleSourceCapture,
): KrakenLifecycleDiscoveredTarget | null {
  const pathname = stripTrailingSlash(url.pathname);
  let sourceKind: KrakenLifecycleDiscoveredTargetKind;
  if (capture.sourceKind === "asset-listings-index") {
    if (url.hostname !== "blog.kraken.com") return null;
    if (/^\/product\/asset-listings\/[a-z0-9][a-z0-9-]{0,199}$/u.test(pathname)) {
      sourceKind = "asset-listing-document";
    } else {
      const pageMatch =
        /^\/category\/product\/asset-listings\/page\/([1-9][0-9]{0,2})$/u.exec(
          pathname,
        );
      if (pageMatch === null) return null;
      const page = Number(pageMatch[1]);
      if (page < 2 || page > MAXIMUM_LISTING_INDEX_PAGE) return null;
      sourceKind = "asset-listings-index-page";
    }
  } else if (
    capture.sourceKind === "delistings-index" &&
    url.hostname === "support.kraken.com" &&
    /^\/articles\/[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u.test(pathname)
  ) {
    sourceKind = "support-lifecycle-document";
  } else {
    return null;
  }
  return {
    sourceKind,
    sourceRef: `https://${url.hostname}${pathname}`,
    discoveredFromCaptureId: capture.captureId,
    discoveredFromPayloadSha256: capture.payloadSha256,
  };
}

function discoverFromHtml(
  capture: KrakenLifecycleSourceCapture,
): readonly KrakenLifecycleDiscoveredTarget[] {
  const targets: KrakenLifecycleDiscoveredTarget[] = [];
  let attributeCount = 0;
  for (const match of capture.payloadText.matchAll(HREF_PATTERN)) {
    attributeCount += 1;
    if (attributeCount > MAXIMUM_LINK_ATTRIBUTES) {
      throw new Error("Lifecycle index contains too many link attributes");
    }
    const rawHref = match[1] ?? match[2];
    if (rawHref === undefined) continue;
    const candidate = canonicalCandidate(rawHref, capture.sourceRef);
    if (candidate === null) continue;
    const target = targetFromUrl(candidate, capture);
    if (target !== null) targets.push(target);
  }
  return targets;
}

function targetIdentity(target: KrakenLifecycleDiscoveredTarget): string {
  return `${target.sourceKind}\u0000${target.sourceRef}`;
}

export async function discoverKrakenLifecycleDocumentTargets(
  captures: readonly KrakenLifecycleSourceCapture[],
): Promise<KrakenLifecycleDiscoveryResult> {
  if (captures.length < 2 || captures.length > 4) {
    throw new Error("Lifecycle discovery requires the bounded capture set");
  }
  const listings = indexCapture(
    captures,
    "asset-listings-index",
    ASSET_LISTINGS_INDEX,
  );
  const delistings = indexCapture(
    captures,
    "delistings-index",
    DELISTINGS_INDEX,
  );
  for (const capture of [listings, delistings]) {
    if ((await sha256Hex(capture.payloadText)) !== capture.payloadSha256) {
      throw new Error(`${capture.sourceKind} payload digest does not match`);
    }
  }
  const byIdentity = new Map<string, KrakenLifecycleDiscoveredTarget>();
  for (const target of [
    ...discoverFromHtml(listings),
    ...discoverFromHtml(delistings),
  ]) {
    const identity = targetIdentity(target);
    const existing = byIdentity.get(identity);
    if (
      existing !== undefined &&
      (existing.discoveredFromCaptureId !== target.discoveredFromCaptureId ||
        existing.discoveredFromPayloadSha256 !==
          target.discoveredFromPayloadSha256)
    ) {
      throw new Error("Lifecycle target has conflicting discovery provenance");
    }
    byIdentity.set(identity, target);
    if (byIdentity.size > MAXIMUM_DISCOVERED_TARGETS) {
      throw new Error("Lifecycle index discovered too many targets");
    }
  }
  const targets = [...byIdentity.values()].sort(
    (left, right) =>
      left.sourceKind.localeCompare(right.sourceKind) ||
      left.sourceRef.localeCompare(right.sourceRef),
  );
  const assetListingDocuments = targets.filter(
    (target) => target.sourceKind === "asset-listing-document",
  );
  const assetListingIndexPages = targets.filter(
    (target) => target.sourceKind === "asset-listings-index-page",
  );
  const supportLifecycleDocuments = targets.filter(
    (target) => target.sourceKind === "support-lifecycle-document",
  );
  const discoverySha256 = await sha256Hex(
    JSON.stringify({
      schemaVersion: "kraken-lifecycle-document-discovery-v1",
      sources: [listings, delistings]
        .map((capture) => ({
          sourceKind: capture.sourceKind,
          sourceRef: capture.sourceRef,
          captureId: capture.captureId,
          payloadSha256: capture.payloadSha256,
        }))
        .sort((left, right) => left.sourceKind.localeCompare(right.sourceKind)),
      targets,
    }),
  );
  return {
    targets,
    assetListingDocuments,
    assetListingIndexPages,
    supportLifecycleDocuments,
    discoverySha256,
  };
}
