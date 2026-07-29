import {
  verifyUniverseSignalTimeMembership,
  type UniverseSignalTimeMembership,
} from "../universe/signalTimeMembership.ts";
import type { BacktestStep } from "./types.ts";

const MAXIMUM_BACKTEST_STEPS = 100_000;

export async function bindUniverseMembershipToBacktestSteps(
  steps: readonly BacktestStep[],
  memberships: readonly UniverseSignalTimeMembership[],
): Promise<readonly BacktestStep[]> {
  if (
    steps.length < 1 ||
    steps.length > MAXIMUM_BACKTEST_STEPS ||
    memberships.length !== steps.length
  ) {
    throw new Error(
      "universe membership must cover every bounded backtest step",
    );
  }
  await Promise.all(memberships.map(verifyUniverseSignalTimeMembership));
  const byDecisionAtMs = new Map<number, UniverseSignalTimeMembership>();
  for (const membership of memberships) {
    if (byDecisionAtMs.has(membership.decisionAtMs)) {
      throw new Error("duplicate universe membership decision time");
    }
    byDecisionAtMs.set(membership.decisionAtMs, membership);
  }
  return steps.map((step) => {
    if (step.universeMembership !== undefined) {
      throw new Error("backtest step already has universe membership");
    }
    const membership = byDecisionAtMs.get(step.signalTimestampMs);
    if (membership === undefined) {
      throw new Error(
        "backtest step lacks exact signal-time universe membership",
      );
    }
    return { ...step, universeMembership: membership };
  });
}
