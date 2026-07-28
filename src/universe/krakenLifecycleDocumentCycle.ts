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

export interface KrakenLifecycleDocumentCycleRepository
  extends KrakenLifecycleDocumentCaptureSink {
  loadCommittedSourceRefs(): Promise<ReadonlySet<string>>;
  loadLatestCommittedListingIndexPages(): Promise<
    readonly KrakenLifecycleListingIndexPageCapture[]
  >;
}

export interface ScheduledKrakenLifecycleDocumentCycleOptions {
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
  options: ScheduledKrakenLifecycleDocumentCycleOptions = {},
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
  const [committedPages, committedRefs] = await Promise.all([
    repository.loadLatestCommittedListingIndexPages(),
    repository.loadCommittedSourceRefs(),
  ]);
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
