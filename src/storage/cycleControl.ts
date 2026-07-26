export const GLOBAL_CYCLE_LEASE_NAME = "trading-cycle";
export const DEFAULT_CYCLE_LEASE_MS = 14 * 60 * 1_000;

export const ACQUIRE_GLOBAL_LEASE_SQL = `
  INSERT INTO cycle_leases
    (lease_name, holder_id, expires_at, acquired_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(lease_name) DO UPDATE SET
    holder_id = excluded.holder_id,
    expires_at = excluded.expires_at,
    acquired_at = excluded.acquired_at
  WHERE cycle_leases.expires_at <= excluded.acquired_at
`;

export const RELEASE_GLOBAL_LEASE_SQL = `
  DELETE FROM cycle_leases
  WHERE lease_name = ? AND holder_id = ?
`;

export const CLAIM_SCHEDULED_CYCLE_SQL = `
  INSERT INTO cycle_runs
    (schedule_key, cycle_id, holder_id, status, lease_expires_at, started_at, completed_at, detail_json)
  VALUES (?, ?, ?, 'running', ?, ?, NULL, '{}')
  ON CONFLICT(schedule_key) DO UPDATE SET
    cycle_id = excluded.cycle_id,
    holder_id = excluded.holder_id,
    status = 'running',
    lease_expires_at = excluded.lease_expires_at,
    started_at = excluded.started_at,
    completed_at = NULL,
    detail_json = '{}',
    attempt_count = cycle_runs.attempt_count + 1
  WHERE cycle_runs.status = 'failed'
     OR (cycle_runs.status = 'running' AND cycle_runs.lease_expires_at <= excluded.started_at)
`;

export const COMPLETE_SCHEDULED_CYCLE_SQL = `
  UPDATE cycle_runs
  SET status = 'completed', completed_at = ?, detail_json = ?
  WHERE schedule_key = ? AND holder_id = ? AND status = 'running'
`;

export const FAIL_SCHEDULED_CYCLE_SQL = `
  UPDATE cycle_runs
  SET status = 'failed', completed_at = ?, detail_json = ?
  WHERE schedule_key = ? AND holder_id = ? AND status = 'running'
`;

export function scheduleKeyFromTimestamp(scheduledAtMs: number): string {
  if (!Number.isFinite(scheduledAtMs) || scheduledAtMs < 0) {
    throw new Error("Scheduled timestamp must be a non-negative finite number");
  }
  return `scheduled:${new Date(scheduledAtMs).toISOString()}`;
}

function isoAt(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error("Timestamp must be a non-negative finite number");
  }
  return new Date(timestampMs).toISOString();
}

function changed(result: D1Result): boolean {
  return result.meta.changes === 1;
}

export class CycleControlRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async acquireGlobalLease(
    holderId: string,
    nowMs: number,
    leaseDurationMs = DEFAULT_CYCLE_LEASE_MS,
  ): Promise<boolean> {
    if (
      holderId.trim() === "" ||
      !Number.isFinite(leaseDurationMs) ||
      leaseDurationMs <= 0
    ) {
      throw new Error("Lease holder and duration must be valid");
    }
    const acquiredAt = isoAt(nowMs);
    const expiresAt = isoAt(nowMs + leaseDurationMs);
    const result = await this.db
      .prepare(ACQUIRE_GLOBAL_LEASE_SQL)
      .bind(GLOBAL_CYCLE_LEASE_NAME, holderId, expiresAt, acquiredAt)
      .run();
    return changed(result);
  }

  async releaseGlobalLease(holderId: string): Promise<boolean> {
    const result = await this.db
      .prepare(RELEASE_GLOBAL_LEASE_SQL)
      .bind(GLOBAL_CYCLE_LEASE_NAME, holderId)
      .run();
    return changed(result);
  }

  async claimScheduledCycle(
    scheduleKey: string,
    cycleId: string,
    holderId: string,
    nowMs: number,
    leaseDurationMs = DEFAULT_CYCLE_LEASE_MS,
  ): Promise<boolean> {
    if ([scheduleKey, cycleId, holderId].some((value) => value.trim() === "")) {
      throw new Error("Cycle claim identifiers cannot be empty");
    }
    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new Error("Cycle claim lease duration must be positive and finite");
    }
    const startedAt = isoAt(nowMs);
    const expiresAt = isoAt(nowMs + leaseDurationMs);
    const result = await this.db
      .prepare(CLAIM_SCHEDULED_CYCLE_SQL)
      .bind(scheduleKey, cycleId, holderId, expiresAt, startedAt)
      .run();
    return changed(result);
  }

  async completeScheduledCycle(
    scheduleKey: string,
    holderId: string,
    completedAtMs: number,
    detail: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const result = await this.db
      .prepare(COMPLETE_SCHEDULED_CYCLE_SQL)
      .bind(
        isoAt(completedAtMs),
        JSON.stringify(detail),
        scheduleKey,
        holderId,
      )
      .run();
    if (!changed(result)) {
      throw new Error("Scheduled cycle completion lost lease ownership");
    }
  }

  async failScheduledCycle(
    scheduleKey: string,
    holderId: string,
    failedAtMs: number,
    detail: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const result = await this.db
      .prepare(FAIL_SCHEDULED_CYCLE_SQL)
      .bind(isoAt(failedAtMs), JSON.stringify(detail), scheduleKey, holderId)
      .run();
    if (!changed(result)) {
      throw new Error("Scheduled cycle failure update lost lease ownership");
    }
  }
}
