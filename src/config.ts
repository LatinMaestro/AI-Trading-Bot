import type { TradingMode } from "./domain/types.ts";

export interface RuntimeConfig {
  readonly appEnv: string;
  readonly mode: TradingMode;
  readonly liveTradingEnabled: boolean;
  readonly approvedPairs: readonly string[];
  readonly maxGrossExposurePct: number;
  readonly dailyLossLimitPct: number;
  readonly weeklyLossLimitPct: number;
  readonly maxDrawdownPct: number;
  readonly liveActivationSha256: string;
}

const TRADING_MODES = new Set<TradingMode>([
  "research",
  "paper",
  "shadow",
  "validate",
  "live",
]);

function parsePercent(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${name} must be a number between 0 and 100`);
  }
  return parsed;
}

export function loadConfig(env: Env): RuntimeConfig {
  if (!TRADING_MODES.has(env.TRADING_MODE as TradingMode)) {
    throw new Error("TRADING_MODE is invalid");
  }

  const approvedPairs = env.APPROVED_PAIRS.split(",")
    .map((pair) => pair.trim().toUpperCase())
    .filter(Boolean);

  if (approvedPairs.length === 0) {
    throw new Error("APPROVED_PAIRS cannot be empty");
  }

  return {
    appEnv: env.APP_ENV,
    mode: env.TRADING_MODE as TradingMode,
    liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
    approvedPairs,
    maxGrossExposurePct: parsePercent(
      env.MAX_GROSS_EXPOSURE_PCT,
      "MAX_GROSS_EXPOSURE_PCT",
    ),
    dailyLossLimitPct: parsePercent(
      env.DAILY_LOSS_LIMIT_PCT,
      "DAILY_LOSS_LIMIT_PCT",
    ),
    weeklyLossLimitPct: parsePercent(
      env.WEEKLY_LOSS_LIMIT_PCT,
      "WEEKLY_LOSS_LIMIT_PCT",
    ),
    maxDrawdownPct: parsePercent(env.MAX_DRAWDOWN_PCT, "MAX_DRAWDOWN_PCT"),
    liveActivationSha256: env.LIVE_ACTIVATION_SHA256.trim().toLowerCase(),
  };
}
