import type { RuntimeConfig } from "../config.ts";
import { KrakenSpotAdapter } from "../exchanges/kraken.ts";
import { TradingRepository } from "../storage/repository.ts";
import { decideMomentumRotation } from "../strategies/momentumRotation.ts";

export interface CycleResult {
  readonly cycleId: string;
  readonly mode: string;
  readonly outcome: "no-order" | "proposed";
  readonly reason: string;
}

export async function runTradingCycle(
  env: Env,
  config: RuntimeConfig,
): Promise<CycleResult> {
  const cycleId = crypto.randomUUID();
  const exchange = new KrakenSpotAdapter();
  const repository = new TradingRepository(env.DB);
  const candlesEntries = await Promise.all(
    config.approvedPairs.map(async (pair) => [pair, await exchange.getDailyCandles(pair)] as const),
  );
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
    mode: config.mode,
    outcome: result.outcome,
    detail: {
      strategyVersion: decision.strategyVersion,
      action: decision.action,
      targetPair: decision.targetPair ?? null,
      targetExposurePct: decision.targetExposurePct,
    },
    createdAt: new Date().toISOString(),
  });
  return result;
}
