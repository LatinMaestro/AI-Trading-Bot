export interface ObjectiveConfig {
  readonly initialEquity: number;
  readonly targetEquity: number;
  readonly horizonMonths: number;
}

export interface ObjectiveProgress {
  readonly elapsedMonths: number;
  readonly remainingMonths: number;
  readonly referenceEquity: number;
  readonly progressVsReference: number;
  readonly remainingMultiple: number | null;
  readonly requiredMonthlyCompoundReturn: number | null;
  readonly requiredAnnualCompoundReturn: number | null;
  readonly targetReached: boolean;
  readonly horizonExpired: boolean;
  readonly onOrAheadOfReference: boolean;
}

export interface WealthPercentiles {
  readonly p05: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
}

export interface DrawdownPercentiles {
  readonly p50: number;
  readonly p95: number;
}

export interface ScenarioRiskSummary {
  readonly scenarioCount: number;
  readonly targetHitProbability: number;
  readonly terminalTargetProbability: number;
  readonly loss50BreachProbability: number;
  readonly loss75BreachProbability: number;
  readonly substantialLossBreachProbability: number;
  readonly substantialLossPct: number;
  readonly terminalWealth: WealthPercentiles;
  readonly maximumDrawdown: DrawdownPercentiles;
  readonly medianTerminalMultiple: number;
}

export interface BlockBootstrapConfig {
  readonly initialEquity: number;
  readonly scenarioCount: number;
  readonly periodsPerScenario: number;
  readonly blockLength: number;
  readonly seed: number;
}
