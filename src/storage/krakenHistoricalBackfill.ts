import type { Candle } from "../domain/types.ts";
import {
  prepareKrakenHistoricalCsv,
  reconcileKrakenHistoricalCsv,
  type KrakenHistoricalCsvCapture,
  type ReconciledKrakenHistoricalBackfill,
} from "../marketData/krakenHistoricalBackfill.ts";

const INSERT_BACKFILL_SQL = `INSERT INTO historical_candle_backfills
  (backfill_id, source_contract_sha256, archive_kind, archive_url,
   archive_sha256, archive_byte_length, acquired_at, csv_member_name,
   csv_sha256, csv_byte_length, canonical_pair, exchange_pair,
   interval_minutes, row_count, first_open_time_ms, last_open_time_ms,
   csv_manifest_sha256, rest_overlap_count, rest_overlap_sha256)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(backfill_id) DO NOTHING`;

const INSERT_CANDLE_SQL = `INSERT INTO historical_market_candles
  (canonical_pair, exchange_pair, interval_minutes, open_time_ms,
   close_time_ms, open, high, low, close, vwap, volume, trade_count,
   candle_sha256)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(canonical_pair, interval_minutes, open_time_ms) DO NOTHING`;

const INSERT_MEMBERSHIP_SQL = `INSERT INTO historical_candle_backfill_memberships
  (backfill_id, canonical_pair, interval_minutes, open_time_ms,
   candle_sha256)
 VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(backfill_id, canonical_pair, interval_minutes, open_time_ms)
 DO NOTHING`;

const INSERT_COMMIT_SQL = `INSERT INTO historical_candle_backfill_commits
  (backfill_id, committed_at, committed_count, rest_overlap_count,
   commit_sha256)
 VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(backfill_id) DO NOTHING`;

export interface PersistedKrakenHistoricalBackfill {
  readonly backfillId: string;
  readonly committedAt: string;
  readonly committedCount: number;
  readonly restOverlapCount: number;
  readonly commitSha256: string;
}

function isPersistedCommit(
  row: PersistedKrakenHistoricalBackfill | null,
  prepared: ReconciledKrakenHistoricalBackfill,
): row is PersistedKrakenHistoricalBackfill {
  return (
    row !== null &&
    row.backfillId === prepared.backfillId &&
    row.committedAt === prepared.acquiredAt &&
    row.committedCount === prepared.rowCount &&
    row.restOverlapCount === prepared.restOverlapCount &&
    row.commitSha256 === prepared.backfillId
  );
}

export class KrakenHistoricalBackfillRepository {
  private readonly db: D1Database;
  private readonly maximumStatementsPerBatch: number;

  constructor(db: D1Database, maximumStatementsPerBatch = 80) {
    if (
      !Number.isSafeInteger(maximumStatementsPerBatch) ||
      maximumStatementsPerBatch < 3 ||
      maximumStatementsPerBatch > 100
    ) {
      throw new Error("Historical backfill statement limit is invalid");
    }
    this.db = db;
    this.maximumStatementsPerBatch = maximumStatementsPerBatch;
  }

  private async loadRestCandles(
    prepared: Awaited<ReturnType<typeof prepareKrakenHistoricalCsv>>,
  ): Promise<readonly Candle[]> {
    const rows = await this.db
      .prepare(
        `SELECT open_time_ms AS timestampMs, open, high, low, close, volume
         FROM market_candles
         WHERE venue = 'kraken'
           AND canonical_pair = ?
           AND interval_minutes = ?
           AND open_time_ms BETWEEN ? AND ?
         ORDER BY open_time_ms`,
      )
      .bind(
        prepared.canonicalPair,
        prepared.intervalMinutes,
        prepared.firstOpenTimeMs,
        prepared.lastOpenTimeMs,
      )
      .all<Candle>();
    return rows.results;
  }

  private async loadCommit(
    backfillId: string,
  ): Promise<PersistedKrakenHistoricalBackfill | null> {
    return this.db
      .prepare(
        `SELECT backfill_id AS backfillId,
                committed_at AS committedAt,
                committed_count AS committedCount,
                rest_overlap_count AS restOverlapCount,
                commit_sha256 AS commitSha256
         FROM historical_candle_backfill_commits
         WHERE backfill_id = ?`,
      )
      .bind(backfillId)
      .first<PersistedKrakenHistoricalBackfill>();
  }

  async persistCapture(
    input: KrakenHistoricalCsvCapture,
  ): Promise<PersistedKrakenHistoricalBackfill> {
    const parsed = await prepareKrakenHistoricalCsv(input);
    const restCandles = await this.loadRestCandles(parsed);
    const prepared = await reconcileKrakenHistoricalCsv(parsed, restCandles);

    await this.db.batch([
      this.db.prepare(INSERT_BACKFILL_SQL).bind(
        prepared.backfillId,
        prepared.sourceContractSha256,
        prepared.archiveKind,
        prepared.archiveUrl,
        prepared.archiveSha256,
        prepared.archiveByteLength,
        prepared.acquiredAt,
        prepared.csvMemberName,
        prepared.csvSha256,
        prepared.csvByteLength,
        prepared.canonicalPair,
        prepared.exchangePair,
        prepared.intervalMinutes,
        prepared.rowCount,
        prepared.firstOpenTimeMs,
        prepared.lastOpenTimeMs,
        prepared.csvManifestSha256,
        prepared.restOverlapCount,
        prepared.restOverlapSha256,
      ),
    ]);

    const statementsPerCandle = 2;
    const candlesPerBatch = Math.floor(
      this.maximumStatementsPerBatch / statementsPerCandle,
    );
    for (
      let start = 0;
      start < prepared.candles.length;
      start += candlesPerBatch
    ) {
      const statements: D1PreparedStatement[] = [];
      for (const candle of prepared.candles.slice(
        start,
        start + candlesPerBatch,
      )) {
        statements.push(
          this.db.prepare(INSERT_CANDLE_SQL).bind(
            prepared.canonicalPair,
            prepared.exchangePair,
            prepared.intervalMinutes,
            candle.timestampMs,
            candle.timestampMs + prepared.intervalMinutes * 60_000,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.vwap,
            candle.volume,
            candle.tradeCount,
            candle.candleSha256,
          ),
          this.db.prepare(INSERT_MEMBERSHIP_SQL).bind(
            prepared.backfillId,
            prepared.canonicalPair,
            prepared.intervalMinutes,
            candle.timestampMs,
            candle.candleSha256,
          ),
        );
      }
      await this.db.batch(statements);
    }

    await this.db.batch([
      this.db.prepare(INSERT_COMMIT_SQL).bind(
        prepared.backfillId,
        prepared.acquiredAt,
        prepared.rowCount,
        prepared.restOverlapCount,
        prepared.backfillId,
      ),
    ]);
    const persisted = await this.loadCommit(prepared.backfillId);
    if (!isPersistedCommit(persisted, prepared)) {
      throw new Error("Historical backfill commit verification failed");
    }
    return persisted;
  }
}
