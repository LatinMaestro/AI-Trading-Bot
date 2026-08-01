import {
  prepareUniverseIngestionBatch,
  type UniverseIngestionBatch,
  type UniverseIngestionInput,
} from "../universe/ingestion.ts";

type D1BindValue = string | number | null;

export interface UniversePersistenceStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export interface PreparedUniversePersistence {
  readonly batch: UniverseIngestionBatch;
  readonly statements: readonly UniversePersistenceStatement[];
}

export const INSERT_UNIVERSE_INGESTION_BATCH_SQL = `INSERT INTO universe_ingestion_batches
  (batch_sha256, venue, recorded_at_ms, definition_count, event_count,
   observation_count, source_count)
 VALUES (?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(batch_sha256) DO NOTHING`;

export const INSERT_UNIVERSE_INGESTION_SOURCES_JSON_SQL = `INSERT INTO universe_ingestion_batch_sources
  (batch_sha256, source_digest)
 SELECT ?, value
 FROM json_each(?)
 WHERE 1
 ON CONFLICT(batch_sha256, source_digest) DO NOTHING`;

export const INSERT_UNIVERSE_DEFINITIONS_JSON_SQL = `INSERT INTO market_universe_definitions
  (definition_id, venue, canonical_pair, exchange_pair, base_asset, quote_asset,
   instrument_kind, available_at_ms, source_ref, payload_sha256)
 SELECT
   json_extract(value, '$.definitionId'),
   json_extract(value, '$.venue'),
   json_extract(value, '$.canonicalPair'),
   json_extract(value, '$.exchangePair'),
   json_extract(value, '$.baseAsset'),
   json_extract(value, '$.quoteAsset'),
   json_extract(value, '$.instrumentKind'),
   json_extract(value, '$.availableAtMs'),
   json_extract(value, '$.sourceRef'),
   json_extract(value, '$.payloadSha256')
 FROM json_each(?)
 WHERE 1
 ON CONFLICT DO NOTHING`;

export const INSERT_UNIVERSE_DEFINITION_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO universe_ingestion_batch_definitions
    (batch_sha256, definition_id)
   SELECT ?, json_extract(value, '$.definitionId')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(batch_sha256, definition_id) DO NOTHING`;

export const INSERT_UNIVERSE_EVENTS_JSON_SQL = `INSERT INTO market_universe_events
  (event_id, venue, canonical_pair, event_type, effective_at_ms,
   published_at_ms, recorded_at_ms, source_ref, payload_sha256)
 SELECT
   json_extract(value, '$.eventId'),
   json_extract(value, '$.venue'),
   json_extract(value, '$.canonicalPair'),
   json_extract(value, '$.eventType'),
   json_extract(value, '$.effectiveAtMs'),
   json_extract(value, '$.publishedAtMs'),
   json_extract(value, '$.recordedAtMs'),
   json_extract(value, '$.sourceRef'),
   json_extract(value, '$.payloadSha256')
 FROM json_each(?)
 WHERE 1
 ON CONFLICT DO NOTHING`;

export const INSERT_UNIVERSE_EVENT_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO universe_ingestion_batch_events
    (batch_sha256, event_id)
   SELECT ?, json_extract(value, '$.eventId')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(batch_sha256, event_id) DO NOTHING`;

export const INSERT_UNIVERSE_OBSERVATIONS_JSON_SQL = `INSERT INTO market_quality_observations
  (observation_id, venue, canonical_pair, observed_at_ms, available_at_ms,
   spread_bps, quote_turnover_aud_24h, available_quote_volume_aud,
   estimated_impact_bps, minimum_order_aud, aud_valuation_complete,
   daily_committed_candles, hourly_committed_candles,
   annualised_volatility, data_quality_state, payload_sha256)
 SELECT
   json_extract(value, '$.observationId'),
   json_extract(value, '$.venue'),
   json_extract(value, '$.canonicalPair'),
   json_extract(value, '$.observedAtMs'),
   json_extract(value, '$.availableAtMs'),
   json_extract(value, '$.spreadBps'),
   json_extract(value, '$.quoteTurnoverAud24h'),
   json_extract(value, '$.availableQuoteVolumeAud'),
   json_extract(value, '$.estimatedImpactBps'),
   json_extract(value, '$.minimumOrderAud'),
   CASE json_extract(value, '$.audValuationComplete') WHEN 1 THEN 1 ELSE 0 END,
   json_extract(value, '$.dailyCommittedCandles'),
   json_extract(value, '$.hourlyCommittedCandles'),
   json_extract(value, '$.annualisedVolatility'),
   json_extract(value, '$.dataQualityState'),
   json_extract(value, '$.payloadSha256')
 FROM json_each(?)
 WHERE 1
 ON CONFLICT DO NOTHING`;

export const INSERT_UNIVERSE_OBSERVATION_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO universe_ingestion_batch_observations
    (batch_sha256, observation_id)
   SELECT ?, json_extract(value, '$.observationId')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(batch_sha256, observation_id) DO NOTHING`;

export const INSERT_UNIVERSE_INGESTION_COMMIT_SQL =
  `INSERT INTO universe_ingestion_batch_commits
    (batch_sha256)
   VALUES (?)
   ON CONFLICT(batch_sha256) DO NOTHING`;

export async function prepareUniversePersistence(
  input: UniverseIngestionInput,
): Promise<PreparedUniversePersistence> {
  const batch = await prepareUniverseIngestionBatch(input);
  const definitionsJson = JSON.stringify(batch.definitions);
  const eventsJson = JSON.stringify(batch.lifecycleEvents);
  const observationsJson = JSON.stringify(batch.observations);
  const statements: UniversePersistenceStatement[] = [
    {
      sql: INSERT_UNIVERSE_INGESTION_BATCH_SQL,
      params: [
        batch.batchSha256,
        batch.venue,
        batch.recordedAtMs,
        batch.definitions.length,
        batch.lifecycleEvents.length,
        batch.observations.length,
        batch.sourceDigests.length,
      ],
    },
    {
      sql: INSERT_UNIVERSE_INGESTION_SOURCES_JSON_SQL,
      params: [batch.batchSha256, JSON.stringify(batch.sourceDigests)],
    },
    { sql: INSERT_UNIVERSE_DEFINITIONS_JSON_SQL, params: [definitionsJson] },
    {
      sql: INSERT_UNIVERSE_DEFINITION_MEMBERSHIPS_JSON_SQL,
      params: [batch.batchSha256, definitionsJson],
    },
    { sql: INSERT_UNIVERSE_EVENTS_JSON_SQL, params: [eventsJson] },
    {
      sql: INSERT_UNIVERSE_EVENT_MEMBERSHIPS_JSON_SQL,
      params: [batch.batchSha256, eventsJson],
    },
    { sql: INSERT_UNIVERSE_OBSERVATIONS_JSON_SQL, params: [observationsJson] },
    {
      sql: INSERT_UNIVERSE_OBSERVATION_MEMBERSHIPS_JSON_SQL,
      params: [batch.batchSha256, observationsJson],
    },
    {
      sql: INSERT_UNIVERSE_INGESTION_COMMIT_SQL,
      params: [batch.batchSha256],
    },
  ];
  return { batch, statements };
}

export class UniverseIngestionRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistBatch(
    input: UniverseIngestionInput,
  ): Promise<UniverseIngestionBatch> {
    const prepared = await prepareUniversePersistence(input);
    const statements = prepared.statements.map((statement) =>
      this.db.prepare(statement.sql).bind(...statement.params),
    );
    await this.db.batch(statements);
    return prepared.batch;
  }
}
