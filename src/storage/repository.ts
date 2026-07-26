export interface CycleAudit {
  readonly cycleId: string;
  readonly mode: string;
  readonly outcome: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export class TradingRepository {
  constructor(private readonly db: D1Database) {}

  async appendCycleAudit(audit: CycleAudit): Promise<void> {
    const eventId = crypto.randomUUID();
    const detailJson = JSON.stringify({
      mode: audit.mode,
      outcome: audit.outcome,
      ...audit.detail,
    });
    const hashInput = `${eventId}|${audit.cycleId}|cycle.completed|${detailJson}|${audit.createdAt}`;
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(hashInput),
    );
    const eventHash = [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    await this.db
      .prepare(
        `INSERT INTO audit_events
         (event_id, cycle_id, event_type, actor, detail_json, previous_hash, event_hash, created_at)
         VALUES (?, ?, 'cycle.completed', 'system', ?, NULL, ?, ?)`,
      )
      .bind(eventId, audit.cycleId, detailJson, eventHash, audit.createdAt)
      .run();
  }
}
