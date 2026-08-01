import { sha256Hex } from "../utils/crypto.ts";
import type {
  KrakenLifecycleCaptureSourceKind,
  KrakenLifecycleSourceCapture,
} from "./krakenLifecycleCapture.ts";

const ASSET_LISTINGS_INDEX =
  "https://blog.kraken.com/category/product/asset-listings";
const DELISTINGS_INDEX = "https://support.kraken.com/sections/delistings";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_ANCHOR_TAGS = 5_000;
const MAXIMUM_ANCHOR_TAG_LENGTH = 2_000;
const MAXIMUM_DISCOVERED_TARGETS = 2_000;
const MAXIMUM_LISTING_INDEX_PAGE = 500;
const MAXIMUM_RECURSIVE_INDEX_SOURCES = 32;
const ANCHOR_START_PATTERN = /<a\b/giu;
const IGNORED_REGION_START_PATTERN = /<!--|<(script|style|template)\b/giu;
const HREF_ATTRIBUTE_PATTERN =
  /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;

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

export interface KrakenLifecycleListingIndexPageCapture {
  readonly captureId: string;
  readonly sourceKind: "asset-listings-index-page";
  readonly sourceRef: string;
  readonly payloadSha256: string;
  readonly payloadByteLength: number;
  readonly payloadText: string;
  readonly contentType: "text/html";
}

type DiscoverySource =
  | KrakenLifecycleSourceCapture
  | KrakenLifecycleListingIndexPageCapture;

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertPayload(source: DiscoverySource): void {
  assertDigest("captureId", source.captureId);
  assertDigest("payloadSha256", source.payloadSha256);
  if (
    source.contentType !== "text/html" ||
    source.payloadText.length === 0 ||
    !Number.isSafeInteger(source.payloadByteLength) ||
    source.payloadByteLength < 1 ||
    source.payloadByteLength > 1_048_576 ||
    new TextEncoder().encode(source.payloadText).byteLength !==
      source.payloadByteLength
  ) {
    throw new Error(`${source.sourceKind} capture is not canonical`);
  }
}

function assertIndexCapture(
  capture: KrakenLifecycleSourceCapture,
  expectedKind: KrakenLifecycleCaptureSourceKind,
  expectedRef: string,
): void {
  if (
    capture.sourceKind !== expectedKind ||
    capture.sourceRef !== expectedRef
  ) {
    throw new Error(`${expectedKind} capture is not canonical`);
  }
  assertPayload(capture);
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

function listingPageNumber(sourceRef: string): number | null {
  const match =
    /^https:\/\/blog\.kraken\.com\/category\/product\/asset-listings\/page\/([1-9][0-9]{0,2})$/u.exec(
      sourceRef,
    );
  if (match === null) return null;
  const page = Number(match[1]);
  return page >= 2 && page <= MAXIMUM_LISTING_INDEX_PAGE ? page : null;
}

function assertListingIndexPage(
  capture: KrakenLifecycleListingIndexPageCapture,
): void {
  if (listingPageNumber(capture.sourceRef) === null) {
    throw new Error("asset-listings-index-page capture is not canonical");
  }
  assertPayload(capture);
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
  source: DiscoverySource,
): KrakenLifecycleDiscoveredTarget | null {
  const pathname = stripTrailingSlash(url.pathname);
  let sourceKind: KrakenLifecycleDiscoveredTargetKind;
  if (
    source.sourceKind === "asset-listings-index" ||
    source.sourceKind === "asset-listings-index-page"
  ) {
    if (url.hostname !== "blog.kraken.com") return null;
    if (
      /^\/product\/asset-listings\/[a-z0-9][a-z0-9-]{0,199}$/u.test(pathname)
    ) {
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
    source.sourceKind === "delistings-index" &&
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
    discoveredFromCaptureId: source.captureId,
    discoveredFromPayloadSha256: source.payloadSha256,
  };
}

function anchorTagAt(html: string, start: number): string {
  let quote: '"' | "'" | null = null;
  const limit = Math.min(html.length, start + MAXIMUM_ANCHOR_TAG_LENGTH);
  for (let index = start + 2; index < limit; index += 1) {
    const character = html[index];
    if (character === undefined) break;
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return html.slice(start, index + 1);
  }
  throw new Error("Lifecycle index contains an invalid anchor tag");
}

function htmlWithIgnoredRegionsMasked(html: string): string {
  const masked = html.split("");
  let ignoredThrough = 0;
  for (const match of html.matchAll(IGNORED_REGION_START_PATTERN)) {
    const start = match.index;
    if (start === undefined || start < ignoredThrough) continue;
    let end: number;
    if (match[0] === "<!--") {
      const commentEnd = html.indexOf("-->", start + 4);
      if (commentEnd < 0) {
        throw new Error("Lifecycle index contains an unterminated comment");
      }
      end = commentEnd + 3;
    } else {
      const tagName = match[1]?.toLowerCase();
      if (tagName === undefined) {
        throw new Error("Lifecycle index raw-text element is malformed");
      }
      const openingTag = anchorTagAt(html, start);
      const contentStart = start + openingTag.length;
      const closingPattern = new RegExp(`</${tagName}\\s*>`, "giu");
      closingPattern.lastIndex = contentStart;
      const closing = closingPattern.exec(html);
      if (closing === null) {
        throw new Error("Lifecycle index contains an unterminated raw-text element");
      }
      end = closing.index + closing[0].length;
    }
    for (let index = start; index < end; index += 1) masked[index] = " ";
    ignoredThrough = end;
  }
  return masked.join("");
}

function discoverFromHtml(
  source: DiscoverySource,
): readonly KrakenLifecycleDiscoveredTarget[] {
  const targets: KrakenLifecycleDiscoveredTarget[] = [];
  const scanHtml = htmlWithIgnoredRegionsMasked(source.payloadText);
  let anchorCount = 0;
  for (const match of scanHtml.matchAll(ANCHOR_START_PATTERN)) {
    anchorCount += 1;
    if (anchorCount > MAXIMUM_ANCHOR_TAGS) {
      throw new Error("Lifecycle index contains too many anchor tags");
    }
    const start = match.index;
    if (start === undefined) {
      throw new Error("Lifecycle index anchor has no position");
    }
    const anchorTag = anchorTagAt(scanHtml, start);
    const hrefs = [...anchorTag.matchAll(HREF_ATTRIBUTE_PATTERN)];
    if (hrefs.length > 1) {
      throw new Error("Lifecycle index anchor contains multiple href attributes");
    }
    const href = hrefs[0];
    const rawHref = href?.[1] ?? href?.[2];
    if (rawHref === undefined) continue;
    const candidate = canonicalCandidate(rawHref, source.sourceRef);
    if (candidate === null) continue;
    const target = targetFromUrl(candidate, source);
    if (target !== null) targets.push(target);
  }
  return targets;
}

function targetIdentity(target: KrakenLifecycleDiscoveredTarget): string {
  return `${target.sourceKind}\u0000${target.sourceRef}`;
}

function sourceRank(source: DiscoverySource): number {
  if (source.sourceKind === "asset-listings-index") return 0;
  if (source.sourceKind === "asset-listings-index-page") {
    return listingPageNumber(source.sourceRef) ?? MAXIMUM_LISTING_INDEX_PAGE + 1;
  }
  return 0;
}

export async function discoverKrakenLifecycleDocumentTargets(
  captures: readonly KrakenLifecycleSourceCapture[],
  committedListingIndexPages: readonly KrakenLifecycleListingIndexPageCapture[] = [],
): Promise<KrakenLifecycleDiscoveryResult> {
  if (
    captures.length < 2 ||
    captures.length > 4 ||
    committedListingIndexPages.length > MAXIMUM_RECURSIVE_INDEX_SOURCES
  ) {
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
  const pageRefs = new Set<string>();
  for (const page of committedListingIndexPages) {
    assertListingIndexPage(page);
    if (pageRefs.has(page.sourceRef)) {
      throw new Error("Lifecycle discovery contains duplicate index pages");
    }
    pageRefs.add(page.sourceRef);
  }
  const sources: DiscoverySource[] = [
    listings,
    ...committedListingIndexPages,
    delistings,
  ];
  for (const source of sources) {
    if ((await sha256Hex(source.payloadText)) !== source.payloadSha256) {
      throw new Error(`${source.sourceKind} payload digest does not match`);
    }
  }
  const byIdentity = new Map<
    string,
    { readonly target: KrakenLifecycleDiscoveredTarget; readonly rank: number }
  >();
  for (const source of sources) {
    for (const target of discoverFromHtml(source)) {
      const identity = targetIdentity(target);
      const candidate = { target, rank: sourceRank(source) };
      const existing = byIdentity.get(identity);
      if (
        existing === undefined ||
        candidate.rank < existing.rank ||
        (candidate.rank === existing.rank &&
          candidate.target.discoveredFromCaptureId <
            existing.target.discoveredFromCaptureId)
      ) {
        byIdentity.set(identity, candidate);
      }
      if (byIdentity.size > MAXIMUM_DISCOVERED_TARGETS) {
        throw new Error("Lifecycle index discovered too many targets");
      }
    }
  }
  const targets = [...byIdentity.values()]
    .map(({ target }) => target)
    .sort(
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
      schemaVersion: "kraken-lifecycle-document-discovery-v2",
      sources: sources
        .map((source) => ({
          sourceKind: source.sourceKind,
          sourceRef: source.sourceRef,
          captureId: source.captureId,
          payloadSha256: source.payloadSha256,
        }))
        .sort(
          (left, right) =>
            left.sourceKind.localeCompare(right.sourceKind) ||
            left.sourceRef.localeCompare(right.sourceRef),
        ),
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
