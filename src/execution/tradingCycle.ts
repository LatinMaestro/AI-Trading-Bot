import type { RuntimeConfig } from "../config.ts";
import { KrakenSpotAdapter } from "../exchanges/kraken.ts";
import { TradingRepository } from "../storage/repository.ts";
import { decideMomentumRotation } from "../strategies/momentumRotation.ts";
import { assertDailyCandlesUsable } from "../marketData/candleQuality.ts";
import { selectApprovedAudPairs } from "../marketData/pairs.ts";
import {
  CycleControlRepository,
  scheduleKeyFromTimestamp,
} from "../storage/cycleControl.ts";
import { UniverseIngestionRepository } from "../storage/universeIngestion.ts";
import { runScheduledKrakenUniverseCycle } from "../universe/krakenPublicCycle.ts";

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

    const universe = await runScheduledKrakenUniverseCycle(
      new UniverseIngestionRepository(env.DB),
      {
        scheduledAtMs: invocation.scheduledAtMs,
        nowMs: clock,
        maximumDepthPairs: Math.max(1, 8 - config.approvedPairs.length),
      },
    );

    const exchange = new KrakenSpotAdapter();
    const availablePairs = await exchange.getSpotPairs("AU");
    const approvedPairs = selectApprovedAudPairs(
      availablePairs,
      config.approvedPairs,
    );
    const candlesEntries: Array<
      readonly [string, Awaited<ReturnType<typeof exchange.getDailyCandles>>]
    > = [];
    for (const pair of approvedPairs) {
      const candles = await exchange.getDailyCandles(pair.exchangeSymbol);
      assertDailyCandlesUsable(pair.canonicalSymbol, candles);
      candlesEntries.push([pair.canonicalSymbol, candles]);
    }
    const decision = decideMomentumRotation(Object.fromEntries(candlesEntries));

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
      outcome: decision.action === "hold" ? "no-order" : "proposed",
      reason: decision.reason,
    };
    await repository.appendCycleAudit({
      cycleId,
      eventType: "cycle.completed",
      mode: config.mode,
      outcome: result.outcome,
      detail: {
        scheduleKey,
        strategyVersion: decision.strategyVersion,
        action: decision.action,
        targetPair: decision.targetPair ?? null,
        targetExposurePct: decision.targetExposurePct,
        universeBatchSha256: universe.batch.batchSha256,
        universeSelectedPairCount: universe.selectedPairs.length,
        universeSkippedPairCount: universe.skippedPairs.length,
        universePublicRequestCount: universe.requestCount,
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
