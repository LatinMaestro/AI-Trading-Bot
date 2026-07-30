import {
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";

const HOUR_MS = 3_600_000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CANONICAL_AUD_PAIR = /^[A-Z0-9]{2,20}\/AUD$/u;
const MAX_PAIRS = 500;
const MAX_HISTORY_HOURS = 24 * 366;

export const VOLATILITY_EXPANSION_STRATEGY_VERSION =
  "volatility-expansion-v0.1.0";

export interface VolatilityExpansionPolicy {
  readonly recentVolatilityHours: number;
  readonly baselineVolatilityHours: number;
  readonly compressionHours: number;
  readonly breakoutHours: number;
  readonly exitChannelHours: number;
  readonly trendEmaHours: number;
  readonly maximumCompressionRatio: number;
  readonly minimumExpansionRatio: number;
  readonly minimumImpulseReturn: number;
  readonly minimumHoldHours: number;
  readonly rotationScoreLead: number;
  readonly targetExposurePct: number;
}

export const VOLATILITY_EXPANSION_BASELINE_POLICY:
  VolatilityExpansionPolicy = Object.freeze({
    recentVolatilityHours: 12,
    baselineVolatilityHours: 168,
    compressionHours: 48,
    breakoutHours: 48,
    exitChannelHours: 24,
    trendEmaHours: 168,
    maximumCompressionRatio: 0.75,
    minimumExpansionRatio: 1.5,
    minimumImpulseReturn: 0.01,
    minimumHoldHours: 12,
    rotationScoreLead: 0.05,
    targetExposurePct: 95,
  });

export interface VolatilityExpansionHourlyClose {
  readonly timestampMs: number;
  readonly close: number;
}

export interface VolatilityExpansionPosition {
  readonly pair: string;
  readonly enteredAtMs: number;
}

export interface VolatilityExpansionInput {
  readonly universeSnapshotSha256: string;
  readonly eligiblePairs: readonly string[];
  readonly hourlyClosesByPair:
    Readonly<Record<string, readonly VolatilityExpansionHourlyClose[]>>;
  readonly currentPosition: VolatilityExpansionPosition | null;
}

export interface VolatilityExpansionSignal {
  readonly pair: string;
  readonly signalTimestampMs: number;
  readonly latestClose: number;
  readonly priorBreakoutHigh: number;
  readonly priorExitLow: number;
  readonly trendEma: number;
  readonly recentReturn: number;
  readonly breakoutDistance: number;
  readonly baselineAnnualisedVolatility: number;
  readonly compressionAnnualisedVolatility: number;
  readonly recentAnnualisedVolatility: number;
  readonly compressionRatio: number;
  readonly expansionRatio: number;
  readonly expansionScore: number;
  readonly entryEligible: boolean;
  readonly exitTriggered: boolean;
  readonly rank: number;
}

export interface VolatilityExpansionDecision {
  readonly schemaVersion: "volatility-expansion-decision-v1";
  readonly strategyVersion: typeof VOLATILITY_EXPANSION_STRATEGY_VERSION;
  readonly policy: VolatilityExpansionPolicy;
  readonly universeSnapshotSha256: string;
  readonly eligiblePairs: readonly string[];
  readonly signalTimestampMs: number;
  readonly targetPair: string | null;
  readonly targetExposurePct: number;
  readonly reason:
    | "enter-strongest-volatility-expansion"
    | "rotate-to-stronger-volatility-expansion"
    | "retain-active-expansion"
    | "retain-during-minimum-hold"
    | "exit-ineligible-position-to-aud"
    | "exit-channel-or-trend-to-aud"
    | "no-volatility-expansion-hold-aud";
  readonly signals: readonly VolatilityExpansionSignal[];
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly decisionSha256: string;
}

function requiredHistoryHours(policy: VolatilityExpansionPolicy): number {
  return Math.max(
    policy.baselineVolatilityHours + policy.recentVolatilityHours,
    policy.compressionHours + policy.recentVolatilityHours,
    policy.breakoutHours,
    policy.exitChannelHours,
    policy.trendEmaHours,
  );
}

function assertPolicy(policy: VolatilityExpansionPolicy): void {
  const windows = [
    policy.recentVolatilityHours,
    policy.baselineVolatilityHours,
    policy.compressionHours,
    policy.breakoutHours,
    policy.exitChannelHours,
    policy.trendEmaHours,
  ];
  if (
    windows.some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < 2 ||
        value > MAX_HISTORY_HOURS,
    ) ||
    policy.recentVolatilityHours >= policy.baselineVolatilityHours ||
    policy.compressionHours > policy.baselineVolatilityHours ||
    requiredHistoryHours(policy) > MAX_HISTORY_HOURS ||
    !Number.isFinite(policy.maximumCompressionRatio) ||
    policy.maximumCompressionRatio <= 0 ||
    policy.maximumCompressionRatio >= 1 ||
    !Number.isFinite(policy.minimumExpansionRatio) ||
    policy.minimumExpansionRatio <= 1 ||
    policy.minimumExpansionRatio > 10 ||
    !Number.isFinite(policy.minimumImpulseReturn) ||
    policy.minimumImpulseReturn < 0 ||
    policy.minimumImpulseReturn > 1 ||
    !Number.isSafeInteger(policy.minimumHoldHours) ||
    policy.minimumHoldHours < 0 ||
    policy.minimumHoldHours > policy.baselineVolatilityHours ||
    !Number.isFinite(policy.rotationScoreLead) ||
    policy.rotationScoreLead < 0 ||
    policy.rotationScoreLead > 1 ||
    !Number.isFinite(policy.targetExposurePct) ||
    policy.targetExposurePct <= 0 ||
    policy.targetExposurePct > 100
  ) {
    throw new Error("Volatility-expansion policy is invalid");
  }
}

function assertEligiblePairs(pairs: readonly string[]): void {
  if (pairs.length === 0 || pairs.length > MAX_PAIRS) {
    throw new Error("Volatility-expansion universe is empty or unbounded");
  }
  const sorted = [...pairs].sort();
  if (
    pairs.some((pair) => !CANONICAL_AUD_PAIR.test(pair)) ||
    new Set(pairs).size !== pairs.length ||
    pairs.some((pair, index) => pair !== sorted[index])
  ) {
    throw new Error(
      "Volatility-expansion eligible pairs are not canonical and sorted",
    );
  }
}

function assertHistory(
  pair: string,
  history: readonly VolatilityExpansionHourlyClose[],
  requiredHours: number,
): void {
  if (
    history.length < requiredHours + 1 ||
    history.length > MAX_HISTORY_HOURS + 1
  ) {
    throw new Error(
      `${pair} volatility-expansion history is insufficient or unbounded`,
    );
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
      throw new Error(
        `${pair} volatility-expansion history is invalid or non-contiguous`,
      );
    }
    previousTimestampMs = observation.timestampMs;
  }
}

function annualisedVolatility(window: readonly number[]): number {
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
  history: readonly VolatilityExpansionHourlyClose[],
  policy: VolatilityExpansionPolicy,
): Omit<VolatilityExpansionSignal, "rank"> {
  assertHistory(pair, history, requiredHistoryHours(policy));
  const closes = history.map(({ close }) => close);
  const latest = history.at(-1)!;
  const recentStartIndex = closes.length - policy.recentVolatilityHours - 1;
  const baselineStartIndex =
    recentStartIndex - policy.baselineVolatilityHours;
  const compressionStartIndex =
    recentStartIndex - policy.compressionHours;
  const baselineWindow = closes.slice(
    baselineStartIndex,
    recentStartIndex + 1,
  );
  const compressionWindow = closes.slice(
    compressionStartIndex,
    recentStartIndex + 1,
  );
  const recentWindow = closes.slice(recentStartIndex);
  if (
    baselineWindow.length !== policy.baselineVolatilityHours + 1 ||
    compressionWindow.length !== policy.compressionHours + 1 ||
    recentWindow.length !== policy.recentVolatilityHours + 1
  ) {
    throw new Error(`${pair} volatility windows are incomplete`);
  }

  const priorBreakoutHigh = Math.max(
    ...priorWindow(closes, policy.breakoutHours),
  );
  const priorExitLow = Math.min(
    ...priorWindow(closes, policy.exitChannelHours),
  );
  const trendEma = exponentialMovingAverage(closes, policy.trendEmaHours);
  const recentReference = recentWindow[0]!;
  const recentReturn = latest.close / recentReference - 1;
  const breakoutDistance = latest.close / priorBreakoutHigh - 1;
  const baselineAnnualisedVolatility =
    annualisedVolatility(baselineWindow);
  const compressionAnnualisedVolatility =
    annualisedVolatility(compressionWindow);
  const recentAnnualisedVolatility =
    annualisedVolatility(recentWindow);
  const compressionRatio =
    baselineAnnualisedVolatility === 0
      ? compressionAnnualisedVolatility === 0 ? 1 : Number.POSITIVE_INFINITY
      : compressionAnnualisedVolatility / baselineAnnualisedVolatility;
  const expansionRatio =
    baselineAnnualisedVolatility === 0
      ? recentAnnualisedVolatility === 0 ? 1 : Number.POSITIVE_INFINITY
      : recentAnnualisedVolatility / baselineAnnualisedVolatility;
  const expansionScore =
    recentReturn +
    Math.max(0, breakoutDistance) +
    Math.min(Math.max(expansionRatio - 1, 0), 4) * 0.05 +
    Math.max(0, 1 - compressionRatio) * 0.05;
  const signalTimestampMs = latest.timestampMs + HOUR_MS;
  if (
    !Number.isSafeInteger(signalTimestampMs) ||
    ![
      priorBreakoutHigh,
      priorExitLow,
      trendEma,
      recentReturn,
      breakoutDistance,
      baselineAnnualisedVolatility,
      compressionAnnualisedVolatility,
      recentAnnualisedVolatility,
      compressionRatio,
      expansionRatio,
      expansionScore,
    ].every(Number.isFinite)
  ) {
    throw new Error(`${pair} produced invalid volatility-expansion metrics`);
  }
  return {
    pair,
    signalTimestampMs,
    latestClose: latest.close,
    priorBreakoutHigh,
    priorExitLow,
    trendEma,
    recentReturn,
    breakoutDistance,
    baselineAnnualisedVolatility,
    compressionAnnualisedVolatility,
    recentAnnualisedVolatility,
    compressionRatio,
    expansionRatio,
    expansionScore,
    entryEligible:
      compressionRatio <= policy.maximumCompressionRatio &&
      expansionRatio >= policy.minimumExpansionRatio &&
      recentReturn >= policy.minimumImpulseReturn &&
      latest.close > priorBreakoutHigh &&
      latest.close > trendEma,
    exitTriggered:
      latest.close < priorExitLow || latest.close < trendEma,
  };
}

function decisionContent(
  policy: VolatilityExpansionPolicy,
  input: VolatilityExpansionInput,
  signals: readonly VolatilityExpansionSignal[],
  targetPair: string | null,
  targetExposurePct: number,
  reason: VolatilityExpansionDecision["reason"],
) {
  return {
    schemaVersion: "volatility-expansion-decision-v1",
    strategyVersion: VOLATILITY_EXPANSION_STRATEGY_VERSION,
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

export async function decideVolatilityExpansion(
  input: VolatilityExpansionInput,
  policy: VolatilityExpansionPolicy =
    VOLATILITY_EXPANSION_BASELINE_POLICY,
): Promise<VolatilityExpansionDecision> {
  assertPolicy(policy);
  if (!SHA256_HEX.test(input.universeSnapshotSha256)) {
    throw new Error("Volatility-expansion snapshot identity is invalid");
  }
  assertEligiblePairs(input.eligiblePairs);
  const historyPairs = Object.keys(input.hourlyClosesByPair).sort();
  if (
    historyPairs.length !== input.eligiblePairs.length ||
    historyPairs.some((pair, index) => pair !== input.eligiblePairs[index])
  ) {
    throw new Error(
      "Volatility-expansion histories do not match eligible membership",
    );
  }
  if (
    input.currentPosition !== null &&
    (!CANONICAL_AUD_PAIR.test(input.currentPosition.pair) ||
      !Number.isSafeInteger(input.currentPosition.enteredAtMs) ||
      input.currentPosition.enteredAtMs < 0)
  ) {
    throw new Error("Volatility-expansion current position is invalid");
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
    throw new Error("Volatility-expansion evidence has mismatched signal times");
  }
  const ranked = [...unranked].sort(
    (left, right) =>
      right.expansionScore - left.expansionScore ||
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
    throw new Error("Volatility-expansion position chronology is invalid");
  }

  let targetPair: string | null;
  let targetExposurePct: number;
  let reason: VolatilityExpansionDecision["reason"];
  if (input.currentPosition === null) {
    targetPair = winner?.pair ?? null;
    targetExposurePct = winner === undefined ? 0 : policy.targetExposurePct;
    reason = winner === undefined
      ? "no-volatility-expansion-hold-aud"
      : "enter-strongest-volatility-expansion";
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
        winner.expansionScore - current.expansionScore >=
          policy.rotationScoreLead;
      if (heldHours! < policy.minimumHoldHours) {
        targetPair = current.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "retain-during-minimum-hold";
      } else if (materiallyStronger) {
        targetPair = winner.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "rotate-to-stronger-volatility-expansion";
      } else {
        targetPair = current.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "retain-active-expansion";
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
