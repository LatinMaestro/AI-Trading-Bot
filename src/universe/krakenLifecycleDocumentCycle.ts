import type { ScheduledKrakenLifecycleCaptureResult } from "./krakenLifecycleCapture.ts";
import {
  captureKrakenLifecycleDiscoveryBatch,
  type KrakenLifecycleDocumentCapture,
  type KrakenLifecycleDocumentCaptureSink,
} from "./krakenLifecycleDocumentCapture.ts";
import {
  discoverKrakenLifecycleDocumentTargets,
  type KrakenLifecycleListingIndexPageCapture,
} from "./krakenLifecycleDiscovery.ts";

const DAY_MS = 86_400_000;
const LISTING_PAGE_COUNT = 499;
const LISTING_PAGE_ROTATION_STEP = 32;
const MAXIMUM_RECURSIVE_PAGE_BYTES = 8_388_608;

export interface KrakenLifecycleDocumentCycleRepository
  extends KrakenLifecycleDocumentCaptureSink {
  loadCommittedSourceRefs(): Promise<ReadonlySet<string>>;
  loadLatestCommittedListingIndexPages(
    rotationStartPage: number,
  ): Promise<
    readonly KrakenLifecycleListingIndexPageCapture[]
  >;
}

export interface ScheduledKrakenLifecycleDocumentCycleOptions {
  readonly scheduledAtMs: number;
  readonly maximumTargets?: number;
  readonly nowMs?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly requestSpacingMs?: number;
}

export interface ScheduledKrakenLifecycleDocumentCycleResult {
  readonly due: boolean;
  readonly discoverySha256: string | null;
  readonly committedListingIndexPageCount: number;
  readonly discoveredTargetCount: number;
  readonly captures: readonly KrakenLifecycleDocumentCapture[];
  readonly selectedTargetCount: number;
  readonly remainingTargetCount: number;
  readonly requestCount: number;
}

export async function runScheduledKrakenLifecycleDocumentCycle(
  lifecycleCapture: ScheduledKrakenLifecycleCaptureResult,
  repository: KrakenLifecycleDocumentCycleRepository,
  options: ScheduledKrakenLifecycleDocumentCycleOptions,
): Promise<ScheduledKrakenLifecycleDocumentCycleResult> {
  if (!lifecycleCapture.due) {
    if (
      lifecycleCapture.captures.length !== 0 ||
      lifecycleCapture.requestCount !== 0
    ) {
      throw new Error("Non-due lifecycle capture contains unexpected work");
    }
    return {
      due: false,
      discoverySha256: null,
      committedListingIndexPageCount: 0,
      discoveredTargetCount: 0,
      captures: [],
      selectedTargetCount: 0,
      remainingTargetCount: 0,
      requestCount: 0,
    };
  }
  if (
    !Number.isSafeInteger(options.scheduledAtMs) ||
    options.scheduledAtMs < 0
  ) {
    throw new Error("scheduledAtMs must be a non-negative safe integer");
  }
  const scheduledDay = Math.floor(options.scheduledAtMs / DAY_MS);
  const rotationStartPage =
    ((scheduledDay * LISTING_PAGE_ROTATION_STEP) % LISTING_PAGE_COUNT) + 2;
  const [committedPages, committedRefs] = await Promise.all([
    repository.loadLatestCommittedListingIndexPages(rotationStartPage),
    repository.loadCommittedSourceRefs(),
  ]);
  let committedPageBytes = 0;
  if (committedPages.length > LISTING_PAGE_ROTATION_STEP) {
    throw new Error("Lifecycle document page window exceeds resource bounds");
  }
  for (const page of committedPages) {
    if (
      !Number.isSafeInteger(page.payloadByteLength) ||
      page.payloadByteLength < 1 ||
      page.payloadByteLength > 1_048_576
    ) {
      throw new Error("Lifecycle document page window is malformed");
    }
    committedPageBytes += page.payloadByteLength;
    if (
      !Number.isSafeInteger(committedPageBytes) ||
      committedPageBytes > MAXIMUM_RECURSIVE_PAGE_BYTES
    ) {
      throw new Error("Lifecycle document page window exceeds resource bounds");
    }
  }
  const discovery = await discoverKrakenLifecycleDocumentTargets(
    lifecycleCapture.captures,
    committedPages,
  );
  const batch = await captureKrakenLifecycleDiscoveryBatch(
    discovery,
    repository,
    {
      alreadyCapturedSourceRefs: committedRefs,
      ...(options.maximumTargets === undefined
        ? {}
        : { maximumTargets: options.maximumTargets }),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.retryDelayMs === undefined
        ? {}
        : { retryDelayMs: options.retryDelayMs }),
      ...(options.requestSpacingMs === undefined
        ? {}
        : { requestSpacingMs: options.requestSpacingMs }),
    },
  );
  return {
    due: true,
    discoverySha256: discovery.discoverySha256,
    committedListingIndexPageCount: committedPages.length,
    discoveredTargetCount: discovery.targets.length,
    ...batch,
  };
}
