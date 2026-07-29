import {
  verifyHourlyTrendBreakoutResearchRun,
  type HourlyTrendBreakoutBacktestPlan,
  type HourlyTrendBreakoutResearchRun,
} from "../backtest/hourlyTrendBreakout.ts";

type D1BindValue = string | number | null;

export interface HourlyTrendBreakoutResearchRunPersistenceInput {
  readonly plan: HourlyTrendBreakoutBacktestPlan;
  readonly run: HourlyTrendBreakoutResearchRun;
  readonly persistedAtMs: number;
}

export interface HourlyTrendBreakoutResearchRunStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export const INSERT_HOURLY_TREND_BREAKOUT_RESEARCH_RUN_SQL =
  `INSERT INTO hourly_trend_breakout_research_runs
    (run_sha256, plan_sha256, config_sha256, result_sha256,
     strategy_version, first_decision_at_ms, last_decision_at_ms,
     decision_count, initial_equity_aud, final_equity_aud,
     total_return_pct, maximum_drawdown_pct, turnover_multiple,
     execution_count, membership_count, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(run_sha256) DO NOTHING`;

export async function prepareHourlyTrendBreakoutResearchRunPersistence(
  input: HourlyTrendBreakoutResearchRunPersistenceInput,
): Promise<HourlyTrendBreakoutResearchRunStatement> {
  if (
    !Number.isSafeInteger(input.persistedAtMs) ||
    input.persistedAtMs < 0
  ) {
    throw new Error("persistedAtMs must be a non-negative safe integer");
  }
  await verifyHourlyTrendBreakoutResearchRun(input.plan, input.run);
  const firstDecisionAtMs = input.plan.boundDecisions[0]?.decisionAtMs;
  const lastDecisionAtMs = input.plan.boundDecisions.at(-1)?.decisionAtMs;
  if (
    firstDecisionAtMs === undefined ||
    lastDecisionAtMs === undefined ||
    input.persistedAtMs < lastDecisionAtMs
  ) {
    throw new Error(
      "hourly trend/breakout research run persistence chronology is invalid",
    );
  }
  const result = input.run.result;
  return {
    sql: INSERT_HOURLY_TREND_BREAKOUT_RESEARCH_RUN_SQL,
    params: [
      input.run.runSha256,
      input.run.planSha256,
      input.run.configSha256,
      input.run.resultSha256,
      input.run.strategyVersion,
      firstDecisionAtMs,
      lastDecisionAtMs,
      input.plan.boundDecisions.length,
      result.initialEquityAud,
      result.finalEquityAud,
      result.totalReturnPct,
      result.maximumDrawdownPct,
      result.turnoverMultiple,
      result.executions.length,
      result.universeMembershipSha256s.length,
      input.persistedAtMs,
    ],
  };
}

export class HourlyTrendBreakoutResearchRunRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: HourlyTrendBreakoutResearchRunPersistenceInput,
  ): Promise<HourlyTrendBreakoutResearchRun> {
    const statement =
      await prepareHourlyTrendBreakoutResearchRunPersistence(input);
    await this.db.prepare(statement.sql).bind(...statement.params).run();
    return input.run;
  }
}
