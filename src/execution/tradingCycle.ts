import type { RuntimeConfig } from "../config.ts";
import { KrakenSpotAdapter } from "../exchanges/kraken.ts";
import { TradingRepository } from "../storage/repository.ts";
import {
  decideUniverseBoundMomentumRotation,
  requireUniverseSnapshotSha256,
} from "../strategies/universeBoundDecision.ts";
import { assertDailyCandlesUsable } from "../marketData/candleQuality.ts";
import { selectApprovedAudPairs } from "../marketData/pairs.ts";
import {
  CycleControlRepository,
  scheduleKeyFromTimestamp,
} from "../storage/cycleControl.ts";
import { UniverseIngestionRepository } from "../storage/universeIngestion.ts";
import { MarketCandleHistoryRepository } from "../marketData/historyEvidence.ts";
import { MarketCandleRepository } from "../storage/marketCandles.ts";
import { runScheduledKrakenCandleCycle } from "../marketData/scheduledKrakenCandles.ts";
import { runScheduledKrakenUniverseCycle } from "../universe/krakenPublicCycle.ts";
import { KrakenLifecycleCaptureRepository } from "../storage/krakenLifecycleCapture.ts";
import { runScheduledKrakenLifecycleCapture } from "../universe/krakenLifecycleCapture.ts";
import { KrakenLifecycleDocumentCaptureRepository } from "../storage/krakenLifecycleDocumentCapture.ts";
import { runScheduledKrakenLifecycleDocumentCycle } from "../universe/krakenLifecycleDocumentCycle.ts";
import {
  ExternalIntelligencePaperRiskRepository,
  PAPER_INTELLIGENCE_PAUSE_MAXIMUM_AGE_MS,
} from "../risk/externalIntelligencePaperRisk.ts";
import { UniversePolicySnapshotRepository } from "../storage/universePolicySnapshot.ts";
import { UniverseBoundStrategyDecisionRepository } from "../storage/universeBoundStrategyDecision.ts";

export interface CycleResult {
  readonly cycleId: string;
  readonly mode: string;
  readonly outcome: "no-order" | "proposed" | "skipped";
  readonly reason: string;
}

export interface CycleInvocation {
  readonly scheduledAtMs: number;
  readonly nowMs?: () => number;
}

export async function runTradingCycle(
  env: Env,
  config: RuntimeConfig,
  invocation: CycleInvocation,
): Promise<CycleResult> {
  const clock = invocation.nowMs ?? Date.now;
  const cycleId = crypto.randomUUID();
  const holderId = crypto.randomUUID();
  const scheduleKey = scheduleKeyFromTimestamp(invocation.scheduledAtMs);
  const control = new CycleControlRepository(env.DB);
  const repository = new TradingRepository(env.DB);
  const candleHistory = new MarketCandleHistoryRepository(env.DB);
  const lifecycleCaptures = new KrakenLifecycleCaptureRepository(env.DB);
  const lifecycleDocuments = new KrakenLifecycleDocumentCaptureRepository(env.DB);

  const globalLeaseAcquired = await control.acquireGlobalLease(holderId, clock());
  if (!globalLeaseAcquired) {
    return {
      cycleId,
      mode: config.mode,
      outcome: "skipped",
      reason: "Another scheduled trading cycle currently owns the global lease",
    };
  }

  let scheduledCycleClaimed = false;
  try {
    scheduledCycleClaimed = await control.claimScheduledCycle(
      scheduleKey,
      cycleId,
      holderId,
      clock(),
    );
    if (!scheduledCycleClaimed) {
      return {
        cycleId,
        mode: config.mode,
        outcome: "skipped",
        reason: "This scheduled trading cycle is already running or completed",
      };
    }

    const universeMembership =
      await new UniversePolicySnapshotRepository(env.DB)
        .loadSignalTimeMembership(
          requireUniverseSnapshotSha256(env.UNIVERSE_SNAPSHOT_SHA256),
          invocation.scheduledAtMs,
        );

    const lifecycleCapture = await runScheduledKrakenLifecycleCapture(
      lifecycleCaptures,
      {
        scheduledAtMs: invocation.scheduledAtMs,
        nowMs: clock,
      },
    );
    const lifecycleDocumentCapture =
      await runScheduledKrakenLifecycleDocumentCycle(
        lifecycleCapture,
        lifecycleDocuments,
        { scheduledAtMs: invocation.scheduledAtMs, nowMs: clock },
      );
    const exchange = new KrakenSpotAdapter();
    const availablePairs = await exchange.getSpotPairs("AU");
    const scheduledCandlePairs = selectApprovedAudPairs(
      availablePairs,
      config.approvedPairs,
    );
    const scheduledCandles = await runScheduledKrakenCandleCycle({
      scheduledAtMs: invocation.scheduledAtMs,
      pairs: scheduledCandlePairs,
      store: new MarketCandleRepository(env.DB),
      historyProvider: (pairs, asOfMs) =>
        candleHistory.loadKrakenHistoryByPair(pairs, asOfMs),
      nowMs: clock,
    });
    const universe = await runScheduledKrakenUniverseCycle(
      new UniverseIngestionRepository(env.DB),
      {
        scheduledAtMs: invocation.scheduledAtMs,
        nowMs: clock,
        maximumDepthPairs: Math.max(1, 9 - config.approvedPairs.length),
        historyProvider: (pairs, asOfMs) =>
          candleHistory.loadKrakenHistoryByPair(pairs, asOfMs),
      },
    );
    const configuredEligiblePairs = config.approvedPairs
      .filter((pair) => universeMembership.eligiblePairs.includes(pair))
      .sort((left, right) => left.localeCompare(right));
    const approvedPairs =
      configuredEligiblePairs.length === 0
        ? []
        : selectApprovedAudPairs(availablePairs, configuredEligiblePairs);
    const candlesEntries: Array<
      readonly [string, Awaited<ReturnType<typeof exchange.getDailyCandles>>]
    > = [];
    for (const pair of approvedPairs) {
      const candles = await exchange.getDailyCandles(pair.exchangeSymbol);
      assertDailyCandlesUsable(pair.canonicalSymbol, candles);
      candlesEntries.push([pair.canonicalSymbol, candles]);
    }
    const boundDecision = await decideUniverseBoundMomentumRotation(
      universeMembership,
      Object.fromEntries(candlesEntries),
    );
    const decision = boundDecision.decision;
    await new UniverseBoundStrategyDecisionRepository(env.DB).persist({
      cycleId,
      membership: universeMembership,
      artifact: boundDecision,
      persistedAtMs: clock(),
    });
    const intelligenceRisk =
      await new ExternalIntelligencePaperRiskRepository(env.DB).apply({
        cycleId,
        mode: config.mode,
        decision,
        evaluatedAtMs: invocation.scheduledAtMs,
        maximumAssessmentAgeMs:
          PAPER_INTELLIGENCE_PAUSE_MAXIMUM_AGE_MS,
      });
    const gatedDecision = intelligenceRisk.decision;

    if (config.mode === "live") {
      if (!config.liveTradingEnabled) {
        throw new Error("Live mode is configured but LIVE_TRADING_ENABLED is not true");
      }
      if (config.liveActivationSha256.length !== 64) {
        throw new Error("Live activation digest is missing or malformed");
      }
      throw new Error("Phase 0 intentionally contains no executable live-order path");
    }

    const result: CycleResult = {
      cycleId,
      mode: config.mode,
      outcome: gatedDecision.action === "hold" ? "no-order" : "proposed",
      reason: gatedDecision.reason,
    };
    await repository.appendCycleAudit({
      cycleId,
      eventType: "cycle.completed",
      mode: config.mode,
      outcome: result.outcome,
      detail: {
        scheduleKey,
        strategyVersion: gatedDecision.strategyVersion,
        proposedAction: decision.action,
        action: gatedDecision.action,
        targetPair: gatedDecision.targetPair ?? null,
        targetExposurePct: gatedDecision.targetExposurePct,
        externalIntelligenceRiskEvaluated: intelligenceRisk.evaluated,
        externalIntelligencePausedNewRisk: intelligenceRisk.pausedNewRisk,
        externalIntelligenceAssessmentSha256s:
          intelligenceRisk.assessmentSha256s,
        externalIntelligenceIntegrationSha256s:
          intelligenceRisk.integrationSha256s,
        externalIntelligenceRiskReason: intelligenceRisk.reason,
        universeMembershipSha256: universeMembership.membershipSha256,
        universeSnapshotSha256: universeMembership.snapshotSha256,
        universeSignedPolicySha256: universeMembership.signedPolicySha256,
        universeMembershipEligiblePairCount:
          universeMembership.eligiblePairs.length,
        universeConfiguredEligiblePairCount: configuredEligiblePairs.length,
        universeBoundDecisionSha256: boundDecision.bindingSha256,
        lifecycleCaptureDue: lifecycleCapture.due,
        lifecycleCaptureCount: lifecycleCapture.captures.length,
        lifecycleCaptureRequestCount: lifecycleCapture.requestCount,
        lifecycleCaptureIds: lifecycleCapture.captures.map(
          (capture) => capture.captureId,
        ),
        lifecycleDocumentDiscoverySha256:
          lifecycleDocumentCapture.discoverySha256,
        lifecycleDocumentCommittedIndexPageCount:
          lifecycleDocumentCapture.committedListingIndexPageCount,
        lifecycleDocumentDiscoveredTargetCount:
          lifecycleDocumentCapture.discoveredTargetCount,
        lifecycleDocumentCaptureCount:
          lifecycleDocumentCapture.captures.length,
        lifecycleDocumentSelectedTargetCount:
          lifecycleDocumentCapture.selectedTargetCount,
        lifecycleDocumentRemainingTargetCount:
          lifecycleDocumentCapture.remainingTargetCount,
        lifecycleDocumentRequestCount: lifecycleDocumentCapture.requestCount,
        lifecycleDocumentCaptureIds: lifecycleDocumentCapture.captures.map(
          (capture) => capture.captureId,
        ),
        universeBatchSha256: universe.batch.batchSha256,
        universeSelectedPairCount: universe.selectedPairs.length,
        universeSkippedPairCount: universe.skippedPairs.length,
        universePublicRequestCount: universe.requestCount,
        scheduledCandleCaptureCount: scheduledCandles.captures.length,
        scheduledCandleRequestCount: scheduledCandles.requestCount,
        scheduledCandleHistoryAsOfMs: scheduledCandles.historyAsOfMs,
        scheduledCandleDetectedRepairableGapCount:
          scheduledCandles.detectedRepairableGapCount,
        scheduledCandleDetectedMissingCandleCount:
          scheduledCandles.detectedMissingCandleCount,
        scheduledCandleRepairCaptureCount:
          scheduledCandles.repairCaptureCount,
        scheduledCandleBatchSha256s: scheduledCandles.captures.map(
          (capture) => capture.batch.payloadSha256,
        ),
        scheduledCandleResponseSha256s: scheduledCandles.captures.map(
          (capture) => capture.responseSha256,
        ),
      },
      createdAt: new Date(clock()).toISOString(),
    });
    await control.completeScheduledCycle(scheduleKey, holderId, clock(), {
      outcome: result.outcome,
      reason: result.reason,
    });
    return result;
  } catch (error: unknown) {
    if (scheduledCycleClaimed) {
      const message = error instanceof Error ? error.message : "Unknown error";
      try {
        await repository.appendCycleAudit({
          cycleId,
          eventType: "cycle.failed",
          mode: config.mode,
          outcome: "failed",
          detail: { scheduleKey, message },
          createdAt: new Date(clock()).toISOString(),
        });
      } catch (auditError: unknown) {
        console.error(
          JSON.stringify({
            event: "cycle-failure-audit-write-failed",
            cycleId,
            message:
              auditError instanceof Error ? auditError.message : "Unknown error",
          }),
        );
      }
      try {
        await control.failScheduledCycle(scheduleKey, holderId, clock(), {
          message,
        });
      } catch (statusError: unknown) {
        console.error(
          JSON.stringify({
            event: "cycle-failure-status-update-failed",
            cycleId,
            message:
              statusError instanceof Error ? statusError.message : "Unknown error",
          }),
        );
      }
    }
    throw error;
  } finally {
    try {
      const released = await control.releaseGlobalLease(holderId);
      if (!released) {
        console.error(
          JSON.stringify({
            event: "cycle-global-lease-release-missed",
            cycleId,
            holderId,
          }),
        );
      }
    } catch (releaseError: unknown) {
      console.error(
        JSON.stringify({
          event: "cycle-global-lease-release-failed",
          cycleId,
          message:
            releaseError instanceof Error ? releaseError.message : "Unknown error",
        }),
      );
    }
  }
}