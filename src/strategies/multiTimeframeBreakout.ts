import {
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";

const HOUR_MS = 3_600_000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CANONICAL_AUD_PAIR = /^[A-Z0-9]{2,20}\/AUD$/u;
const MAX_PAIRS = 500;
const MAX_HISTORY_HOURS = 24 * 366;

export const MULTI_TIMEFRAME_BREAKOUT_STRATEGY_VERSION =
  "multi-timeframe-breakout-v0.1.0";

export interface MultiTimeframeBreakoutPolicy {
  readonly fastBreakoutHours: number;
  readonly mediumBreakoutHours: number;
  readonly longTrendHours: number;
  readonly exitChannelHours: number;
  readonly shortVolatilityHours: number;
  readonly longVolatilityHours: number;
  readonly mediumHighProximity: number;
  readonly minimumVolatilityRatio: number;
  readonly minimumHoldHours: number;
  readonly rotationScoreLead: number;
  readonly targetExposurePct: number;
}

export const MULTI_TIMEFRAME_BREAKOUT_BASELINE_POLICY:
  MultiTimeframeBreakoutPolicy = Object.freeze({
    fastBreakoutHours: 24,
    mediumBreakoutHours: 168,
    longTrendHours: 720,
    exitChannelHours: 72,
    shortVolatilityHours: 24,
    longVolatilityHours: 168,
    mediumHighProximity: 0.01,
    minimumVolatilityRatio: 1.05,
    minimumHoldHours: 24,
    rotationScoreLead: 0.05,
    targetExposurePct: 95,
  });

export interface MultiTimeframeHourlyClose {
  readonly timestampMs: number;
  readonly close: number;
}

export interface MultiTimeframeBreakoutPosition {
  readonly pair: string;
  readonly enteredAtMs: number;
}

export interface MultiTimeframeBreakoutInput {
  readonly universeSnapshotSha256: string;
  readonly eligiblePairs: readonly string[];
  readonly hourlyClosesByPair:
    Readonly<Record<string, readonly MultiTimeframeHourlyClose[]>>;
  readonly currentPosition: MultiTimeframeBreakoutPosition | null;
}

export interface MultiTimeframeBreakoutSignal {
  readonly pair: string;
  readonly signalTimestampMs: number;
  readonly latestClose: number;
  readonly fastPriorHigh: number;
  readonly mediumPriorHigh: number;
  readonly exitPriorLow: number;
  readonly longEma: number;
  readonly mediumReturn: number;
  readonly longReturn: number;
  readonly fastBreakoutDistance: number;
  readonly mediumHighDistance: number;
  readonly shortAnnualisedVolatility: number;
  readonly longAnnualisedVolatility: number;
  readonly volatilityRatio: number;
  readonly breakoutScore: number;
  readonly entryEligible: boolean;
  readonly exitTriggered: boolean;
  readonly rank: number;
}

export interface MultiTimeframeBreakoutDecision {
  readonly schemaVersion: "multi-timeframe-breakout-decision-v1";
  readonly strategyVersion:
    typeof MULTI_TIMEFRAME_BREAKOUT_STRATEGY_VERSION;
  readonly policy: MultiTimeframeBreakoutPolicy;
  readonly universeSnapshotSha256: string;
  readonly eligiblePairs: readonly string[];
  readonly signalTimestampMs: number;
  readonly targetPair: string | null;
  readonly targetExposurePct: number;
  readonly reason:
    | "enter-strongest-multi-timeframe-breakout"
    | "rotate-to-stronger-breakout"
    | "retain-open-trend"
    | "retain-during-minimum-hold"
    | "exit-ineligible-position-to-aud"
    | "exit-channel-or-trend-to-aud"
    | "no-breakout-hold-aud";
  readonly signals: readonly MultiTimeframeBreakoutSignal[];
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly decisionSha256: string;
}

function assertPolicy(policy: MultiTimeframeBreakoutPolicy): void {
  const windows = [
    policy.fastBreakoutHours,
    policy.mediumBreakoutHours,
    policy.longTrendHours,
    policy.exitChannelHours,
    policy.shortVolatilityHours,
    policy.longVolatilityHours,
  ];
  if (
    windows.some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < 2 ||
        value > MAX_HISTORY_HOURS,
    ) ||
    !(
      policy.fastBreakoutHours < policy.mediumBreakoutHours &&
      policy.mediumBreakoutHours < policy.longTrendHours
    ) ||
    !(
      policy.shortVolatilityHours < policy.longVolatilityHours &&
      policy.longVolatilityHours <= policy.longTrendHours
    ) ||
    policy.exitChannelHours > policy.longTrendHours ||
    !Number.isFinite(policy.mediumHighProximity) ||
    policy.mediumHighProximity < 0 ||
    policy.mediumHighProximity >= 1 ||
    !Number.isFinite(policy.minimumVolatilityRatio) ||
    policy.minimumVolatilityRatio < 1 ||
    policy.minimumVolatilityRatio > 10 ||
    !Number.isSafeInteger(policy.minimumHoldHours) ||
    policy.minimumHoldHours < 0 ||
    policy.minimumHoldHours > policy.longTrendHours ||
    !Number.isFinite(policy.rotationScoreLead) ||
    policy.rotationScoreLead < 0 ||
    policy.rotationScoreLead > 1 ||
    !Number.isFinite(policy.targetExposurePct) ||
    policy.targetExposurePct <= 0 ||
    policy.targetExposurePct > 100
  ) {
    throw new Error("Multi-timeframe breakout policy is invalid");
  }
}

function assertEligiblePairs(pairs: readonly string[]): void {
  if (pairs.length === 0 || pairs.length > MAX_PAIRS) {
    throw new Error("Multi-timeframe breakout universe is empty or unbounded");
  }
  const sorted = [...pairs].sort();
  if (
    pairs.some((pair) => !CANONICAL_AUD_PAIR.test(pair)) ||
    new Set(pairs).size !== pairs.length ||
    pairs.some((pair, index) => pair !== sorted[index])
  ) {
    throw new Error(
      "Multi-timeframe breakout eligible pairs are not canonical and sorted",
    );
  }
}

function assertHistory(
  pair: string,
  history: readonly MultiTimeframeHourlyClose[],
  requiredHours: number,
): void {
  if (
    history.length < requiredHours + 1 ||
    history.length > MAX_HISTORY_HOURS + 1
  ) {
    throw new Error(`${pair} breakout history is insufficient or unbounded`);
  }
  let previousTimestampMs: number | undefined;
  for (const observation of history) {
    if (
      !Number.isSafeInteger(observation.timestampMs) ||
      observation.timestampMs < 0 ||
      observation.timestampMs % HOUR_MS !== 0 ||
      (previousTimestampMs !== undefined &&
        observation.timestampMs - previousTimestampMs !== HOUR_MS) ||
      !Number.isFinite(observation.close) ||
      observation.close <= 0
    ) {
      throw new Error(`${pair} breakout history is invalid or non-contiguous`);
    }
    previousTimestampMs = observation.timestampMs;
  }
}

function returnOver(
  closes: readonly number[],
  lookbackHours: number,
): number {
  const reference = closes.at(-(lookbackHours + 1));
  const latest = closes.at(-1);
  if (reference === undefined || latest === undefined) {
    throw new Error("Breakout return history is insufficient");
  }
  return latest / reference - 1;
}

function annualisedVolatility(
  closes: readonly number[],
  lookbackHours: number,
): number {
  const window = closes.slice(-(lookbackHours + 1));
  const returns = window.slice(1).map(
    (close, index) => Math.log(close / window[index]!),
  );
  const mean =
    returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(24 * 365);
}

function exponentialMovingAverage(
  closes: readonly number[],
  lookbackHours: number,
): number {
  const window = closes.slice(-lookbackHours);
  const alpha = 2 / (lookbackHours + 1);
  return window.slice(1).reduce(
    (ema, close) => alpha * close + (1 - alpha) * ema,
    window[0]!,
  );
}

function priorWindow(
  closes: readonly number[],
  lookbackHours: number,
): readonly number[] {
  return closes.slice(-(lookbackHours + 1), -1);
}

function buildUnrankedSignal(
  pair: string,
  history: readonly MultiTimeframeHourlyClose[],
  policy: MultiTimeframeBreakoutPolicy,
): Omit<MultiTimeframeBreakoutSignal, "rank"> {
  assertHistory(pair, history, policy.longTrendHours);
  const closes = history.map((observation) => observation.close);
  const latest = history.at(-1)!;
  const fastPriorHigh = Math.max(
    ...priorWindow(closes, policy.fastBreakoutHours),
  );
  const mediumPriorHigh = Math.max(
    ...priorWindow(closes, policy.mediumBreakoutHours),
  );
  const exitPriorLow = Math.min(
    ...priorWindow(closes, policy.exitChannelHours),
  );
  const longEma = exponentialMovingAverage(closes, policy.longTrendHours);
  const mediumReturn = returnOver(closes, policy.mediumBreakoutHours);
  const longReturn = returnOver(closes, policy.longTrendHours);
  const fastBreakoutDistance = latest.close / fastPriorHigh - 1;
  const mediumHighDistance = latest.close / mediumPriorHigh - 1;
  const shortAnnualisedVolatility = annualisedVolatility(
    closes,
    policy.shortVolatilityHours,
  );
  const longAnnualisedVolatility = annualisedVolatility(
    closes,
    policy.longVolatilityHours,
  );
  const volatilityRatio =
    longAnnualisedVolatility === 0
      ? shortAnnualisedVolatility === 0 ? 1 : Number.POSITIVE_INFINITY
      : shortAnnualisedVolatility / longAnnualisedVolatility;
  const breakoutScore =
    fastBreakoutDistance +
    Math.max(0, mediumHighDistance) +
    mediumReturn * 0.3 +
    longReturn * 0.2 +
    Math.min(Math.max(volatilityRatio - 1, 0), 2) * 0.05;
  const signalTimestampMs = latest.timestampMs + HOUR_MS;
  if (
    !Number.isSafeInteger(signalTimestampMs) ||
    ![
      fastPriorHigh,
      mediumPriorHigh,
      exitPriorLow,
      longEma,
      mediumReturn,
      longReturn,
      fastBreakoutDistance,
      mediumHighDistance,
      shortAnnualisedVolatility,
      longAnnualisedVolatility,
      volatilityRatio,
      breakoutScore,
    ].every(Number.isFinite)
  ) {
    throw new Error(`${pair} produced invalid breakout metrics`);
  }
  return {
    pair,
    signalTimestampMs,
    latestClose: latest.close,
    fastPriorHigh,
    mediumPriorHigh,
    exitPriorLow,
    longEma,
    mediumReturn,
    longReturn,
    fastBreakoutDistance,
    mediumHighDistance,
    shortAnnualisedVolatility,
    longAnnualisedVolatility,
    volatilityRatio,
    breakoutScore,
    entryEligible:
      latest.close > fastPriorHigh &&
      latest.close >= mediumPriorHigh * (1 - policy.mediumHighProximity) &&
      latest.close > longEma &&
      mediumReturn > 0 &&
      longReturn > 0 &&
      volatilityRatio >= policy.minimumVolatilityRatio,
    exitTriggered:
      latest.close < exitPriorLow || latest.close < longEma,
  };
}

function decisionContent(
  policy: MultiTimeframeBreakoutPolicy,
  input: MultiTimeframeBreakoutInput,
  signals: readonly MultiTimeframeBreakoutSignal[],
  targetPair: string | null,
  targetExposurePct: number,
  reason: MultiTimeframeBreakoutDecision["reason"],
) {
  return {
    schemaVersion: "multi-timeframe-breakout-decision-v1",
    strategyVersion: MULTI_TIMEFRAME_BREAKOUT_STRATEGY_VERSION,
    policy: Object.freeze({ ...policy }),
    universeSnapshotSha256: input.universeSnapshotSha256,
    eligiblePairs: Object.freeze([...input.eligiblePairs]),
    signalTimestampMs: signals[0]!.signalTimestampMs,
    targetPair,
    targetExposurePct,
    reason,
    signals,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
  } as const;
}

export async function decideMultiTimeframeBreakout(
  input: MultiTimeframeBreakoutInput,
  policy: MultiTimeframeBreakoutPolicy =
    MULTI_TIMEFRAME_BREAKOUT_BASELINE_POLICY,
): Promise<MultiTimeframeBreakoutDecision> {
  assertPolicy(policy);
  if (!SHA256_HEX.test(input.universeSnapshotSha256)) {
    throw new Error("Multi-timeframe breakout snapshot identity is invalid");
  }
  assertEligiblePairs(input.eligiblePairs);
  const historyPairs = Object.keys(input.hourlyClosesByPair).sort();
  if (
    historyPairs.length !== input.eligiblePairs.length ||
    historyPairs.some((pair, index) => pair !== input.eligiblePairs[index])
  ) {
    throw new Error(
      "Multi-timeframe breakout histories do not match eligible membership",
    );
  }
  if (
    input.currentPosition !== null &&
    (!CANONICAL_AUD_PAIR.test(input.currentPosition.pair) ||
      !Number.isSafeInteger(input.currentPosition.enteredAtMs) ||
      input.currentPosition.enteredAtMs < 0)
  ) {
    throw new Error("Multi-timeframe breakout current position is invalid");
  }

  const unranked = input.eligiblePairs.map((pair) =>
    buildUnrankedSignal(
      pair,
      input.hourlyClosesByPair[pair]!,
      policy,
    ),
  );
  const signalTimestampMs = unranked[0]!.signalTimestampMs;
  if (
    unranked.some(
      (signal) => signal.signalTimestampMs !== signalTimestampMs,
    )
  ) {
    throw new Error(
      "Multi-timeframe breakout evidence has mismatched signal times",
    );
  }
  const ranked = [...unranked].sort(
    (left, right) =>
      right.breakoutScore - left.breakoutScore ||
      left.pair.localeCompare(right.pair),
  );
  const rankByPair = new Map(
    ranked.map((signal, index) => [signal.pair, index + 1]),
  );
  const signals = Object.freeze(
    unranked.map((signal) => ({
      ...signal,
      rank: rankByPair.get(signal.pair)!,
    })),
  );
  const winner = [...signals]
    .filter((signal) => signal.entryEligible)
    .sort(
      (left, right) =>
        left.rank - right.rank || left.pair.localeCompare(right.pair),
    )[0];
  const heldHours = input.currentPosition === null
    ? null
    : (signalTimestampMs - input.currentPosition.enteredAtMs) / HOUR_MS;
  if (
    heldHours !== null &&
    (!Number.isSafeInteger(heldHours) || heldHours < 0)
  ) {
    throw new Error("Multi-timeframe breakout position chronology is invalid");
  }

  let targetPair: string | null;
  let targetExposurePct: number;
  let reason: MultiTimeframeBreakoutDecision["reason"];
  if (input.currentPosition === null) {
    targetPair = winner?.pair ?? null;
    targetExposurePct = winner === undefined ? 0 : policy.targetExposurePct;
    reason = winner === undefined
      ? "no-breakout-hold-aud"
      : "enter-strongest-multi-timeframe-breakout";
  } else if (!input.eligiblePairs.includes(input.currentPosition.pair)) {
    targetPair = null;
    targetExposurePct = 0;
    reason = "exit-ineligible-position-to-aud";
  } else {
    const current = signals.find(
      (signal) => signal.pair === input.currentPosition!.pair,
    )!;
    if (current.exitTriggered) {
      targetPair = null;
      targetExposurePct = 0;
      reason = "exit-channel-or-trend-to-aud";
    } else {
      const materiallyStronger =
        winner !== undefined &&
        winner.pair !== current.pair &&
        winner.breakoutScore - current.breakoutScore >=
          policy.rotationScoreLead;
      if (heldHours! < policy.minimumHoldHours) {
        targetPair = current.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "retain-during-minimum-hold";
      } else if (materiallyStronger) {
        targetPair = winner.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "rotate-to-stronger-breakout";
      } else {
        targetPair = current.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "retain-open-trend";
      }
    }
  }

  const content = decisionContent(
    policy,
    input,
    signals,
    targetPair,
    targetExposurePct,
    reason,
  );
  return {
    ...content,
    decisionSha256: await sha256CanonicalIntelligence(content),
  };
}
