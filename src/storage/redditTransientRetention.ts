import { sha256CanonicalIntelligence } from "../intelligence/canonical.ts";
import {
  REDDIT_MAXIMUM_RETENTION_MS,
} from "../intelligence/redditOAuthAdapter.ts";
import {
  createRedditOAuthListingTarget,
  type RedditRetentionSweep,
  type RedditTransientPostBatch,
  type RedditTransientPostObservation,
} from "../intelligence/redditPostLifecycle.ts";

type D1BindValue = string | number | null;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;

export interface RedditTransientRetentionStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export interface RedditTransientWatchState {
  readonly sourceId: string;
  readonly observedAtMs: number;
  readonly activeObservationCount: number;
  readonly validUntilMs: number | null;
  readonly status: "watch" | "empty" | "invalidated";
  readonly invalidatedAtMs: number | null;
  readonly invalidationReason:
    | "provider-unavailable"
    | "retention-expired"
    | "mixed"
    | null;
}

interface RedditTransientWatchStateRow {
  readonly source_id: string;
  readonly observed_at_ms: number;
  readonly active_observation_count: number;
  readonly valid_until_ms: number | null;
  readonly status: RedditTransientWatchState["status"];
  readonly invalidated_at_ms: number | null;
  readonly invalidation_reason: RedditTransientWatchState["invalidationReason"];
}

interface DueSourceRow {
  readonly source_id: string;
  readonly due_count: number;
}

export const INSERT_REDDIT_TRANSIENT_OBSERVATIONS_SQL =
  `INSERT INTO reddit_transient_post_observations
    (observation_id, source_id, source_contract_sha256, subreddit, fullname,
     published_at_ms, first_seen_at_ms, last_seen_at_ms, delete_by_ms,
     metadata_sha256, model_training_allowed)
   SELECT
     json_extract(value, '$.observationId'),
     json_extract(value, '$.sourceId'),
     json_extract(value, '$.sourceContractSha256'),
     json_extract(value, '$.subreddit'),
     json_extract(value, '$.fullname'),
     json_extract(value, '$.publishedAtMs'),
     json_extract(value, '$.availableAtMs'),
     json_extract(value, '$.availableAtMs'),
     json_extract(value, '$.deleteByMs'),
     json_extract(value, '$.metadataSha256'),
     0
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(observation_id) DO UPDATE SET
     last_seen_at_ms = MAX(
       reddit_transient_post_observations.last_seen_at_ms,
       excluded.last_seen_at_ms
     )`;

export const UPSERT_REDDIT_WATCH_REFRESH_SQL =
  `INSERT INTO reddit_transient_watch_state
    (source_id, observed_at_ms, active_observation_count, valid_until_ms,
     status, invalidated_at_ms, invalidation_reason)
   SELECT ?, ?, COUNT(*), MIN(delete_by_ms),
     CASE WHEN COUNT(*) = 0 THEN 'empty' ELSE 'watch' END,
     NULL, NULL
   FROM reddit_transient_post_observations
   WHERE source_id = ? AND delete_by_ms > ?
   ON CONFLICT(source_id) DO UPDATE SET
     observed_at_ms = excluded.observed_at_ms,
     active_observation_count = excluded.active_observation_count,
     valid_until_ms = excluded.valid_until_ms,
     status = excluded.status,
     invalidated_at_ms = NULL,
     invalidation_reason = NULL`;

export const INSERT_REDDIT_WATCH_REFRESH_EVENT_SQL =
  `INSERT INTO reddit_watch_state_events
    (operation_id, source_id, event_kind, observed_at_ms,
     active_observation_count, valid_until_ms, invalidation_reason,
     contains_reddit_post_data)
   SELECT ?, ?, 'watch-refreshed', ?, COUNT(*), MIN(delete_by_ms), NULL, 0
   FROM reddit_transient_post_observations
   WHERE source_id = ? AND delete_by_ms > ?
   ON CONFLICT(operation_id) DO NOTHING`;

export const INSERT_REDDIT_PURGE_AUTHORIZATION_SQL =
  `INSERT INTO reddit_transient_purge_authorizations
    (source_id, operation_id, executed_at_ms)
   VALUES (?, ?, ?)`;

export const DELETE_REDDIT_PURGE_AUTHORIZATION_SQL =
  `DELETE FROM reddit_transient_purge_authorizations
   WHERE source_id = ? AND operation_id = ?`;

export const DELETE_REDDIT_SWEEP_OBSERVATIONS_SQL =
  `DELETE FROM reddit_transient_post_observations
   WHERE source_id = ?
     AND observation_id IN (
       SELECT json_extract(value, '$.observationId') FROM json_each(?)
     )`;

export const DELETE_EXPIRED_REDDIT_OBSERVATIONS_SQL =
  `DELETE FROM reddit_transient_post_observations
   WHERE source_id = ? AND delete_by_ms <= ?`;

export const INSERT_REDDIT_RETENTION_AUDIT_SQL =
  `INSERT INTO reddit_retention_audits
    (audit_id, source_id, observed_at_ms, checked_count, present_count,
     provider_unavailable_count, retention_expired_count, retained_count,
     next_sweep_at_ms, contains_reddit_post_data)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
   ON CONFLICT(audit_id) DO NOTHING`;

export const UPSERT_REDDIT_WATCH_INVALIDATION_SQL =
  `INSERT INTO reddit_transient_watch_state
    (source_id, observed_at_ms, active_observation_count, valid_until_ms,
     status, invalidated_at_ms, invalidation_reason)
   SELECT ?, ?, COUNT(*), MIN(delete_by_ms), 'invalidated', ?, ?
   FROM reddit_transient_post_observations
   WHERE source_id = ? AND delete_by_ms > ?
   ON CONFLICT(source_id) DO UPDATE SET
     observed_at_ms = excluded.observed_at_ms,
     active_observation_count = excluded.active_observation_count,
     valid_until_ms = excluded.valid_until_ms,
     status = 'invalidated',
     invalidated_at_ms = excluded.invalidated_at_ms,
     invalidation_reason = excluded.invalidation_reason`;

export const INSERT_REDDIT_WATCH_INVALIDATION_EVENT_SQL =
  `INSERT INTO reddit_watch_state_events
    (operation_id, source_id, event_kind, observed_at_ms,
     active_observation_count, valid_until_ms, invalidation_reason,
     contains_reddit_post_data)
   SELECT ?, ?, 'watch-invalidated', ?, COUNT(*), MIN(delete_by_ms), ?, 0
   FROM reddit_transient_post_observations
   WHERE source_id = ? AND delete_by_ms > ?
   ON CONFLICT(operation_id) DO NOTHING`;

export const SELECT_DUE_REDDIT_SOURCES_SQL =
  `SELECT source_id, COUNT(*) AS due_count
   FROM reddit_transient_post_observations
   WHERE delete_by_ms <= ?
   GROUP BY source_id
   ORDER BY source_id`;

export const SELECT_REDDIT_WATCH_STATE_SQL =
  `SELECT source_id, observed_at_ms, active_observation_count, valid_until_ms,
     status, invalidated_at_ms, invalidation_reason
   FROM reddit_transient_watch_state
   WHERE source_id = ?`;

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertSourceId(sourceId: string): void {
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error("Reddit sourceId is not canonical");
  }
}

function assertOperationId(operationId: string): void {
  if (!UUID_V4_PATTERN.test(operationId)) {
    throw new Error("Reddit retention operationId must be UUID v4");
  }
}

async function assertObservation(
  observation: RedditTransientPostObservation,
  sourceId: string,
  recordedAtMs: number,
): Promise<void> {
  if (
    observation.sourceId !== sourceId ||
    !SHA256_PATTERN.test(observation.observationId) ||
    !SHA256_PATTERN.test(observation.sourceContractSha256) ||
    !SHA256_PATTERN.test(observation.captureId) ||
    !SHA256_PATTERN.test(observation.payloadSha256) ||
    !SHA256_PATTERN.test(observation.metadataSha256) ||
    observation.sourceRef !==
      createRedditOAuthListingTarget(sourceId, observation.subreddit).sourceRef ||
    observation.contentPolicy !== "metadata-only" ||
    observation.payloadRetention !== "transient-only" ||
    observation.modelTrainingAllowed !== false ||
    observation.publishedAtMs > observation.receivedAtMs ||
    observation.receivedAtMs > observation.availableAtMs ||
    observation.availableAtMs > recordedAtMs ||
    observation.deleteByMs <= observation.availableAtMs ||
    observation.deleteByMs - observation.receivedAtMs >
      REDDIT_MAXIMUM_RETENTION_MS ||
    recordedAtMs >= observation.deleteByMs
  ) {
    throw new Error("Reddit transient observation is not persistable");
  }
  const expectedMetadataSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-transient-post-metadata-v1",
    sourceId,
    subreddit: observation.subreddit,
    fullname: observation.fullname,
    publishedAtMs: observation.publishedAtMs,
  });
  const expectedObservationId = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-transient-post-observation-v1",
    sourceContractSha256: observation.sourceContractSha256,
    sourceId,
    subreddit: observation.subreddit,
    fullname: observation.fullname,
    publishedAtMs: observation.publishedAtMs,
    metadataSha256: expectedMetadataSha256,
  });
  if (
    observation.metadataSha256 !== expectedMetadataSha256 ||
    observation.observationId !== expectedObservationId
  ) {
    throw new Error("Reddit transient observation identity is invalid");
  }
}

function safeObservation(
  observation: RedditTransientPostObservation,
): Record<string, string | number> {
  return {
    observationId: observation.observationId,
    sourceId: observation.sourceId,
    sourceContractSha256: observation.sourceContractSha256,
    subreddit: observation.subreddit,
    fullname: observation.fullname,
    publishedAtMs: observation.publishedAtMs,
    availableAtMs: observation.availableAtMs,
    deleteByMs: observation.deleteByMs,
    metadataSha256: observation.metadataSha256,
  };
}

export async function prepareRedditTransientPostBatch(
  batch: RedditTransientPostBatch,
  recordedAtMs: number,
  operationId: string,
): Promise<readonly RedditTransientRetentionStatement[]> {
  assertTime("recordedAtMs", recordedAtMs);
  assertOperationId(operationId);
  assertSourceId(batch.sourceId);
  if (
    batch.durableQueueAllowed !== false ||
    !SHA256_PATTERN.test(batch.batchId) ||
    !SHA256_PATTERN.test(batch.sourceContractSha256) ||
    !SHA256_PATTERN.test(batch.captureId) ||
    !Number.isSafeInteger(batch.ignoredUnavailableCount) ||
    batch.ignoredUnavailableCount < 0 ||
    batch.observations.length > 100 ||
    batch.observations.length + batch.ignoredUnavailableCount > 100
  ) {
    throw new Error("Reddit transient batch is invalid");
  }
  const expectedBatchId = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-transient-post-batch-v1",
    sourceId: batch.sourceId,
    sourceContractSha256: batch.sourceContractSha256,
    captureId: batch.captureId,
    observationIds: batch.observations.map((entry) => entry.observationId),
    ignoredUnavailableCount: batch.ignoredUnavailableCount,
  });
  if (batch.batchId !== expectedBatchId) {
    throw new Error("Reddit transient batch identity is invalid");
  }
  const observations = [...batch.observations].sort((left, right) =>
    left.observationId.localeCompare(right.observationId),
  );
  if (
    new Set(observations.map((entry) => entry.observationId)).size !==
      observations.length ||
    new Set(observations.map((entry) => entry.fullname)).size !==
      observations.length
  ) {
    throw new Error("Reddit transient batch contains duplicate observations");
  }
  for (const observation of observations) {
    await assertObservation(observation, batch.sourceId, recordedAtMs);
    if (
      observation.sourceContractSha256 !== batch.sourceContractSha256
    ) {
      throw new Error("Reddit observation uses the wrong source contract");
    }
  }
  const observationsJson = JSON.stringify(observations.map(safeObservation));
  return [
    {
      sql: INSERT_REDDIT_TRANSIENT_OBSERVATIONS_SQL,
      params: [observationsJson],
    },
    {
      sql: UPSERT_REDDIT_WATCH_REFRESH_SQL,
      params: [batch.sourceId, recordedAtMs, batch.sourceId, recordedAtMs],
    },
    {
      sql: INSERT_REDDIT_WATCH_REFRESH_EVENT_SQL,
      params: [
        operationId,
        batch.sourceId,
        recordedAtMs,
        batch.sourceId,
        recordedAtMs,
      ],
    },
  ];
}

function invalidationReason(
  providerUnavailableCount: number,
  retentionExpiredCount: number,
): "provider-unavailable" | "retention-expired" | "mixed" {
  if (providerUnavailableCount > 0 && retentionExpiredCount > 0) return "mixed";
  if (providerUnavailableCount > 0) return "provider-unavailable";
  return "retention-expired";
}

async function auditStatement(
  audit: RedditRetentionSweep["audit"],
): Promise<RedditTransientRetentionStatement> {
  assertTime("Reddit audit observedAtMs", audit.observedAtMs);
  const counts = [
    audit.checkedCount,
    audit.presentCount,
    audit.providerUnavailableCount,
    audit.retentionExpiredCount,
    audit.retainedCount,
  ];
  if (
    audit.containsRedditPostData !== false ||
    !SHA256_PATTERN.test(audit.auditId) ||
    counts.some(
      (count) =>
        !Number.isSafeInteger(count) || count < 0 || count > 1_000_000,
    ) ||
    audit.presentCount > audit.checkedCount ||
    audit.providerUnavailableCount +
      audit.retentionExpiredCount +
      audit.retainedCount !==
      audit.checkedCount ||
    (audit.retainedCount === 0) !== (audit.nextSweepAtMs === null) ||
    (audit.nextSweepAtMs !== null &&
      (!Number.isSafeInteger(audit.nextSweepAtMs) ||
        audit.nextSweepAtMs <= audit.observedAtMs))
  ) {
    throw new Error("Reddit retention audit is invalid");
  }
  const expectedAuditId = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-retention-audit-v1",
    sourceId: audit.sourceId,
    observedAtMs: audit.observedAtMs,
    checkedCount: audit.checkedCount,
    presentCount: audit.presentCount,
    providerUnavailableCount: audit.providerUnavailableCount,
    retentionExpiredCount: audit.retentionExpiredCount,
    retainedCount: audit.retainedCount,
    nextSweepAtMs: audit.nextSweepAtMs,
    containsRedditPostData: false,
  });
  if (audit.auditId !== expectedAuditId) {
    throw new Error("Reddit retention audit identity is invalid");
  }
  return {
    sql: INSERT_REDDIT_RETENTION_AUDIT_SQL,
    params: [
      audit.auditId,
      audit.sourceId,
      audit.observedAtMs,
      audit.checkedCount,
      audit.presentCount,
      audit.providerUnavailableCount,
      audit.retentionExpiredCount,
      audit.retainedCount,
      audit.nextSweepAtMs,
    ],
  };
}

export async function prepareRedditRetentionSweep(
  sweep: RedditRetentionSweep,
  operationId: string,
): Promise<readonly RedditTransientRetentionStatement[]> {
  assertOperationId(operationId);
  assertSourceId(sweep.audit.sourceId);
  assertTime("Reddit sweep observedAtMs", sweep.audit.observedAtMs);
  const providerUnavailableCount = sweep.purges.filter(
    (entry) => entry.reason === "provider-unavailable",
  ).length;
  const retentionExpiredCount = sweep.purges.filter(
    (entry) => entry.reason === "retention-expired",
  ).length;
  const retainedIds = sweep.retained.map((entry) => entry.observationId);
  const purgeIds = sweep.purges.map((entry) => entry.observationId);
  if (
    sweep.durableQueueAllowed !== false ||
    sweep.purges.length !==
      sweep.audit.providerUnavailableCount + sweep.audit.retentionExpiredCount ||
    providerUnavailableCount !== sweep.audit.providerUnavailableCount ||
    retentionExpiredCount !== sweep.audit.retentionExpiredCount ||
    sweep.retained.length !== sweep.audit.retainedCount ||
    sweep.retained.length + sweep.purges.length !== sweep.audit.checkedCount ||
    new Set(purgeIds).size !== purgeIds.length ||
    new Set(retainedIds).size !== retainedIds.length ||
    retainedIds.some((observationId) => purgeIds.includes(observationId))
  ) {
    throw new Error("Reddit retention sweep is invalid");
  }
  for (const observation of sweep.retained) {
    await assertObservation(
      observation,
      sweep.audit.sourceId,
      sweep.audit.observedAtMs,
    );
  }
  if (
    sweep.audit.nextSweepAtMs !== null &&
    sweep.retained.some(
      (observation) => sweep.audit.nextSweepAtMs! > observation.deleteByMs,
    )
  ) {
    throw new Error("Reddit retention sweep is invalid");
  }
  for (const purge of sweep.purges) {
    if (
      !SHA256_PATTERN.test(purge.observationId) ||
      purge.purgeByMs !== sweep.audit.observedAtMs
    ) {
      throw new Error("Reddit purge action is invalid");
    }
  }
  const reason = invalidationReason(
    sweep.audit.providerUnavailableCount,
    sweep.audit.retentionExpiredCount,
  );
  const purgesJson = JSON.stringify(
    sweep.purges.map((entry) => ({ observationId: entry.observationId })),
  );
  const changed = sweep.purges.length > 0;
  return [
    {
      sql: INSERT_REDDIT_PURGE_AUTHORIZATION_SQL,
      params: [sweep.audit.sourceId, operationId, sweep.audit.observedAtMs],
    },
    {
      sql: DELETE_REDDIT_SWEEP_OBSERVATIONS_SQL,
      params: [sweep.audit.sourceId, purgesJson],
    },
    await auditStatement(sweep.audit),
    changed
      ? {
          sql: UPSERT_REDDIT_WATCH_INVALIDATION_SQL,
          params: [
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
            sweep.audit.observedAtMs,
            reason,
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
          ],
        }
      : {
          sql: UPSERT_REDDIT_WATCH_REFRESH_SQL,
          params: [
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
          ],
        },
    changed
      ? {
          sql: INSERT_REDDIT_WATCH_INVALIDATION_EVENT_SQL,
          params: [
            operationId,
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
            reason,
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
          ],
        }
      : {
          sql: INSERT_REDDIT_WATCH_REFRESH_EVENT_SQL.replace(
            "'watch-refreshed'",
            "'retention-checked'",
          ),
          params: [
            operationId,
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
            sweep.audit.sourceId,
            sweep.audit.observedAtMs,
          ],
        },
    {
      sql: DELETE_REDDIT_PURGE_AUTHORIZATION_SQL,
      params: [sweep.audit.sourceId, operationId],
    },
  ];
}

export async function prepareExpiredRedditPurge(
  sourceId: string,
  dueCount: number,
  observedAtMs: number,
  operationId: string,
): Promise<readonly RedditTransientRetentionStatement[]> {
  assertSourceId(sourceId);
  assertTime("Reddit expiry observedAtMs", observedAtMs);
  assertOperationId(operationId);
  if (!Number.isSafeInteger(dueCount) || dueCount < 1) {
    throw new Error("Reddit expiry purge requires a positive due count");
  }
  const auditId = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-retention-audit-v1",
    sourceId,
    observedAtMs,
    checkedCount: dueCount,
    presentCount: 0,
    providerUnavailableCount: 0,
    retentionExpiredCount: dueCount,
    retainedCount: 0,
    nextSweepAtMs: null,
    containsRedditPostData: false,
  });
  return [
    {
      sql: INSERT_REDDIT_PURGE_AUTHORIZATION_SQL,
      params: [sourceId, operationId, observedAtMs],
    },
    {
      sql: DELETE_EXPIRED_REDDIT_OBSERVATIONS_SQL,
      params: [sourceId, observedAtMs],
    },
    {
      sql: INSERT_REDDIT_RETENTION_AUDIT_SQL,
      params: [
        auditId,
        sourceId,
        observedAtMs,
        dueCount,
        0,
        0,
        dueCount,
        0,
        null,
      ],
    },
    {
      sql: UPSERT_REDDIT_WATCH_INVALIDATION_SQL,
      params: [
        sourceId,
        observedAtMs,
        observedAtMs,
        "retention-expired",
        sourceId,
        observedAtMs,
      ],
    },
    {
      sql: INSERT_REDDIT_WATCH_INVALIDATION_EVENT_SQL,
      params: [
        operationId,
        sourceId,
        observedAtMs,
        "retention-expired",
        sourceId,
        observedAtMs,
      ],
    },
    {
      sql: DELETE_REDDIT_PURGE_AUTHORIZATION_SQL,
      params: [sourceId, operationId],
    },
  ];
}

function stateOf(row: RedditTransientWatchStateRow): RedditTransientWatchState {
  assertSourceId(row.source_id);
  assertTime("Reddit watch observedAtMs", row.observed_at_ms);
  if (
    !Number.isSafeInteger(row.active_observation_count) ||
    row.active_observation_count < 0 ||
    (row.valid_until_ms !== null &&
      (!Number.isSafeInteger(row.valid_until_ms) ||
        row.valid_until_ms <= row.observed_at_ms)) ||
    !["watch", "empty", "invalidated"].includes(row.status) ||
    (row.status === "watch" &&
      (row.active_observation_count === 0 ||
        row.valid_until_ms === null ||
        row.invalidated_at_ms !== null ||
        row.invalidation_reason !== null)) ||
    (row.status === "empty" &&
      (row.active_observation_count !== 0 ||
        row.valid_until_ms !== null ||
        row.invalidated_at_ms !== null ||
        row.invalidation_reason !== null)) ||
    (row.status === "invalidated" &&
      (row.invalidated_at_ms !== row.observed_at_ms ||
        row.invalidation_reason === null))
  ) {
    throw new Error("Reddit transient watch state is invalid");
  }
  return {
    sourceId: row.source_id,
    observedAtMs: row.observed_at_ms,
    activeObservationCount: row.active_observation_count,
    validUntilMs: row.valid_until_ms,
    status: row.status,
    invalidatedAtMs: row.invalidated_at_ms,
    invalidationReason: row.invalidation_reason,
  };
}

export class RedditTransientRetentionRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private async execute(
    statements: readonly RedditTransientRetentionStatement[],
  ): Promise<void> {
    await this.db.batch(
      statements.map((entry) =>
        this.db.prepare(entry.sql).bind(...entry.params),
      ),
    );
  }

  async persist(
    batch: RedditTransientPostBatch,
    recordedAtMs: number,
    operationId = crypto.randomUUID(),
  ): Promise<RedditTransientWatchState> {
    await this.purgeExpired(recordedAtMs);
    await this.execute(
      await prepareRedditTransientPostBatch(batch, recordedAtMs, operationId),
    );
    const state = await this.load(batch.sourceId);
    if (state === null || state.observedAtMs !== recordedAtMs) {
      throw new Error("Reddit transient watch refresh was not persisted");
    }
    return state;
  }

  async applySweep(
    sweep: RedditRetentionSweep,
    operationId = crypto.randomUUID(),
  ): Promise<RedditTransientWatchState> {
    await this.purgeExpired(sweep.audit.observedAtMs);
    await this.execute(await prepareRedditRetentionSweep(sweep, operationId));
    const state = await this.load(sweep.audit.sourceId);
    if (state === null || state.observedAtMs !== sweep.audit.observedAtMs) {
      throw new Error("Reddit retention sweep was not persisted");
    }
    return state;
  }

  async purgeExpired(observedAtMs: number): Promise<void> {
    assertTime("Reddit expiry observedAtMs", observedAtMs);
    const due = await this.db
      .prepare(SELECT_DUE_REDDIT_SOURCES_SQL)
      .bind(observedAtMs)
      .all<DueSourceRow>();
    for (const row of due.results) {
      assertSourceId(row.source_id);
      if (!Number.isSafeInteger(row.due_count) || row.due_count < 1) {
        throw new Error("Reddit due-source count is invalid");
      }
      await this.execute(
        await prepareExpiredRedditPurge(
          row.source_id,
          row.due_count,
          observedAtMs,
          crypto.randomUUID(),
        ),
      );
    }
  }

  async load(sourceId: string): Promise<RedditTransientWatchState | null> {
    assertSourceId(sourceId);
    const row = await this.db
      .prepare(SELECT_REDDIT_WATCH_STATE_SQL)
      .bind(sourceId)
      .first<RedditTransientWatchStateRow>();
    return row === null ? null : stateOf(row);
  }
}
