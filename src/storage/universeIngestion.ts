import {
  prepareUniverseIngestionBatch,
  type UniverseIngestionBatch,
  type UniverseIngestionInput,
} from "../universe/ingestion.ts";

export const INSERT_UNIVERSE_INGESTION_BATCH_SQL = `INSERT INTO universe_ingestion_batches
  (batch_sha256, venue, recorded_at_ms, definition_count, event_count,
   observation_count, source_count)
 VALUES (?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(batch_sha256) DO NOTHING`;

export const INSERT_UNIVERSE_INGESTION_SOURCE_SQL = `INSERT INTO universe_ingestion_batch_sources
  (batch_sha256, source_digest)
 VALUES (?, ?)
 ON CONFLICT(batch_sha256, source_digest) DO NOTHING`;

export const INSERT_UNIVERSE_DEFINITION_SQL = `INSERT INTO market_universe_definitions
  (definition_id, venue, canonical_pair, exchange_pair, base_asset, quote_asset,
   instrument_kind, available_at_ms, source_ref, payload_sha256)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(definition_id) DO NOTHING`;

export const INSERT_UNIVERSE_EVENT_SQL = `INSERT INTO market_universe_events
  (event_id, venue, canonical_pair, event_type, effective_at_ms,
   published_at_ms, recorded_at_ms, source_ref, payload_sha256)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(event_id) DO NOTHING`;

export const INSERT_UNIVERSE_OBSERVATION_SQL = `INSERT INTO market_quality_observations
  (observation_id, venue, canonical_pair, observed_at_ms, available_at_ms,
   spread_bps, quote_turnover_aud_24h, available_quote_volume_aud,
   estimated_impact_bps, minimum_order_aud, aud_valuation_complete,
   daily_committed_candles, hourly_committed_candles,
   annualised_volatility, data_quality_state, payload_sha256)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(observation_id) DO NOTHING`;

export const INSERT_UNIVERSE_DEFINITION_MEMBERSHIP_SQL =
  `INSERT INTO universe_ingestion_batch_definitions
    (batch_sha256, definition_id)
   VALUES (?, ?)
   ON CONFLICT(batch_sha256, definition_id) DO NOTHING`;

export const INSERT_UNIVERSE_EVENT_MEMBERSHIP_SQL =
  `INSERT INTO universe_ingestion_batch_events
    (batch_sha256, event_id)
   VALUES (?, ?)
   ON CONFLICT(batch_sha256, event_id) DO NOTHING`;

export const INSERT_UNIVERSE_OBSERVATION_MEMBERSHIP_SQL =
  `INSERT INTO universe_ingestion_batch_observations
    (batch_sha256, observation_id)
   VALUES (?, ?)
   ON CONFLICT(batch_sha256, observation_id) DO NOTHING`;

export class UniverseIngestionRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistBatch(
    input: UniverseIngestionInput,
  ): Promise<UniverseIngestionBatch> {
    const batch = await prepareUniverseIngestionBatch(input);
    const statements: D1PreparedStatement[] = [
      this.db.prepare(INSERT_UNIVERSE_INGESTION_BATCH_SQL).bind(
        batch.batchSha256,
        batch.venue,
        batch.recordedAtMs,
        batch.definitions.length,
        batch.lifecycleEvents.length,
        batch.observations.length,
        batch.sourceDigests.length,
      ),
    ];

    for (const digest of batch.sourceDigests) {
      statements.push(
        this.db.prepare(INSERT_UNIVERSE_INGESTION_SOURCE_SQL).bind(
          batch.batchSha256,
          digest,
        ),
      );
    }

    for (const definition of batch.definitions) {
      statements.push(
        this.db.prepare(INSERT_UNIVERSE_DEFINITION_SQL).bind(
          definition.definitionId,
          definition.venue,
          definition.canonicalPair,
          definition.exchangePair,
          definition.baseAsset,
          definition.quoteAsset,
          definition.instrumentKind,
          definition.availableAtMs,
          definition.sourceRef,
          definition.payloadSha256,
        ),
        this.db.prepare(INSERT_UNIVERSE_DEFINITION_MEMBERSHIP_SQL).bind(
          batch.batchSha256,
          definition.definitionId,
        ),
      );
    }

    for (const event of batch.lifecycleEvents) {
      statements.push(
        this.db.prepare(INSERT_UNIVERSE_EVENT_SQL).bind(
          event.eventId,
          event.venue,
          event.canonicalPair,
          event.eventType,
          event.effectiveAtMs,
          event.publishedAtMs,
          event.recordedAtMs,
          event.sourceRef,
          event.payloadSha256,
        ),
        this.db.prepare(INSERT_UNIVERSE_EVENT_MEMBERSHIP_SQL).bind(
          batch.batchSha256,
          event.eventId,
        ),
      );
    }

    for (const observation of batch.observations) {
      statements.push(
        this.db.prepare(INSERT_UNIVERSE_OBSERVATION_SQL).bind(
          observation.observationId,
          observation.venue,
          observation.canonicalPair,
          observation.observedAtMs,
          observation.availableAtMs,
          observation.spreadBps,
          observation.quoteTurnoverAud24h,
          observation.availableQuoteVolumeAud,
          observation.estimatedImpactBps,
          observation.minimumOrderAud,
          observation.audValuationComplete ? 1 : 0,
          observation.dailyCommittedCandles,
          observation.hourlyCommittedCandles,
          observation.annualisedVolatility,
          observation.dataQualityState,
          observation.payloadSha256,
        ),
        this.db.prepare(INSERT_UNIVERSE_OBSERVATION_MEMBERSHIP_SQL).bind(
          batch.batchSha256,
          observation.observationId,
        ),
      );
    }

    await this.db.batch(statements);
    return batch;
  }
}
