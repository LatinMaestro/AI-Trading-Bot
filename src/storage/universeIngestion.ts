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

export const INSERT_UNIVERSE_INGESTION_BATCH_SQL = `INSERT INTO market_universe_ingestion_batches (
    batch_sha256, venue, recorded_at_ms, source_digests_json,
    definition_count, event_count, observation_count
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT DO NOTHING`;

export const INSERT_UNIVERSE_DEFINITIONS_JSON_SQL = `INSERT INTO market_universe_definitions (
    definition_id, venue, canonical_pair, exchange_pair, base_asset,
    quote_asset, instrument_kind, available_at_ms, source_ref, payload_sha256
  )
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

export const INSERT_UNIVERSE_EVENTS_JSON_SQL = `INSERT INTO market_universe_events (
    event_id, venue, canonical_pair, event_type, effective_at_ms,
    published_at_ms, recorded_at_ms, source_ref, payload_sha256
  )
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

export const INSERT_UNIVERSE_OBSERVATIONS_JSON_SQL = `INSERT INTO market_quality_observations (
    observation_id, venue, canonical_pair, observed_at_ms, available_at_ms,
    spread_bps, quote_turnover_aud_24h, available_quote_volume_aud,
    estimated_impact_bps, minimum_order_aud, aud_valuation_complete,
    daily_committed_candles, hourly_committed_candles,
    annualised_volatility, data_quality_state, payload_sha256
  )
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

export const INSERT_UNIVERSE_BATCH_ITEMS_JSON_SQL = `INSERT INTO market_universe_ingestion_batch_items (
    batch_sha256, item_kind, item_id, item_position, payload_sha256
  )
  SELECT
    json_extract(value, '$.batchSha256'),
    json_extract(value, '$.itemKind'),
    json_extract(value, '$.itemId'),
    json_extract(value, '$.itemPosition'),
    json_extract(value, '$.payloadSha256')
  FROM json_each(?)
  WHERE 1
  ON CONFLICT DO NOTHING`;

interface BatchItem {
  readonly batchSha256: string;
  readonly itemKind: "definition" | "event" | "observation";
  readonly itemId: string;
  readonly itemPosition: number;
  readonly payloadSha256: string;
}

function batchItems(batch: UniverseIngestionBatch): readonly BatchItem[] {
  return [
    ...batch.definitions.map((item, itemPosition) => ({
      batchSha256: batch.batchSha256,
      itemKind: "definition" as const,
      itemId: item.definitionId,
      itemPosition,
      payloadSha256: item.payloadSha256,
    })),
    ...batch.lifecycleEvents.map((item, itemPosition) => ({
      batchSha256: batch.batchSha256,
      itemKind: "event" as const,
      itemId: item.eventId,
      itemPosition,
      payloadSha256: item.payloadSha256,
    })),
    ...batch.observations.map((item, itemPosition) => ({
      batchSha256: batch.batchSha256,
      itemKind: "observation" as const,
      itemId: item.observationId,
      itemPosition,
      payloadSha256: item.payloadSha256,
    })),
  ];
}

export async function prepareUniversePersistence(
  input: UniverseIngestionInput,
): Promise<PreparedUniversePersistence> {
  const batch = await prepareUniverseIngestionBatch(input);
  const statements: UniversePersistenceStatement[] = [
    {
      sql: INSERT_UNIVERSE_INGESTION_BATCH_SQL,
      params: [
        batch.batchSha256,
        batch.venue,
        batch.recordedAtMs,
        JSON.stringify(batch.sourceDigests),
        batch.definitions.length,
        batch.lifecycleEvents.length,
        batch.observations.length,
      ],
    },
    {
      sql: INSERT_UNIVERSE_DEFINITIONS_JSON_SQL,
      params: [JSON.stringify(batch.definitions)],
    },
    {
      sql: INSERT_UNIVERSE_EVENTS_JSON_SQL,
      params: [JSON.stringify(batch.lifecycleEvents)],
    },
    {
      sql: INSERT_UNIVERSE_OBSERVATIONS_JSON_SQL,
      params: [JSON.stringify(batch.observations)],
    },
    {
      sql: INSERT_UNIVERSE_BATCH_ITEMS_JSON_SQL,
      params: [JSON.stringify(batchItems(batch))],
    },
  ];
  return { batch, statements };
}

export class UniverseIngestionRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistBatch(input: UniverseIngestionInput): Promise<UniverseIngestionBatch> {
    const prepared = await prepareUniversePersistence(input);
    const statements = prepared.statements.map((statement) =>
      this.db.prepare(statement.sql).bind(...statement.params),
    );
    await this.db.batch(statements);
    return prepared.batch;
  }
}
