import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  INSERT_MARKET_CANDLE_SQL,
  INSERT_MARKET_DATA_BATCH_SQL,
  prepareMarketDataBatch,
} from "../src/storage/marketCandles.ts";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_init.sql", "utf8"));
  db.exec(readFileSync("migrations/0002_cycle_and_order_idempotency.sql", "utf8"));
  db.exec(readFileSync("migrations/0003_market_candles.sql", "utf8"));
  return db;
}

function insertPrepared(
  db: DatabaseSync,
  prepared: Awaited<ReturnType<typeof prepareMarketDataBatch>>,
): void {
  db.exec("BEGIN");
  try {
    db.prepare(INSERT_MARKET_DATA_BATCH_SQL).run(
      prepared.batchId,
      prepared.venue,
      prepared.canonicalPair,
      prepared.exchangePair,
      prepared.intervalMinutes,
      prepared.requestedSinceSeconds,
      prepared.sourceCursor,
      prepared.fetchedAt,
      prepared.committedCount,
      prepared.firstOpenTimeMs,
      prepared.lastOpenTimeMs,
      prepared.payloadSha256,
    );
    for (const candle of prepared.candles) {
      db.prepare(INSERT_MARKET_CANDLE_SQL).run(
        candle.venue,
        candle.canonicalPair,
        candle.exchangePair,
        candle.intervalMinutes,
        candle.openTimeMs,
        candle.closeTimeMs,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.sourceBatchId,
        candle.candleSha256,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const candles = [
  {
    timestampMs: Date.UTC(2026, 6, 26, 10),
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 5,
  },
  {
    timestampMs: Date.UTC(2026, 6, 26, 11),
    open: 105,
    high: 115,
    low: 100,
    close: 112,
    volume: 6,
  },
] as const;

test("market batches and candles are idempotent and immutable", async () => {
  const db = database();
  const prepared = await prepareMarketDataBatch({
    batchId: "cycle-1:BTC/AUD:60",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    requestedSinceSeconds: 123,
    sourceCursor: "456",
    fetchedAt: "2026-07-26T12:05:00.000Z",
    candles,
  });
  insertPrepared(db, prepared);
  insertPrepared(db, prepared);

  const batchCount = db
    .prepare("SELECT COUNT(*) AS count FROM market_data_batches")
    .get() as { count: number };
  const candleCount = db
    .prepare("SELECT COUNT(*) AS count FROM market_candles")
    .get() as { count: number };
  assert.equal(batchCount.count, 1);
  assert.equal(candleCount.count, 2);
  assert.throws(
    () => db.prepare("UPDATE market_candles SET close = 1").run(),
    /market candles are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM market_data_batches").run(),
    /market data batches are immutable/,
  );
});

test("same candle identity with different values fails closed atomically", async () => {
  const db = database();
  const original = await prepareMarketDataBatch({
    batchId: "cycle-1:BTC/AUD:60",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    fetchedAt: "2026-07-26T12:05:00.000Z",
    candles,
  });
  insertPrepared(db, original);
  const conflicting = await prepareMarketDataBatch({
    batchId: "cycle-2:BTC/AUD:60",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    fetchedAt: "2026-07-26T13:05:00.000Z",
    candles: [{ ...candles[0], close: 106 }],
  });
  assert.throws(() => insertPrepared(db, conflicting), /market candle payload conflict/);
  const batchCount = db
    .prepare("SELECT COUNT(*) AS count FROM market_data_batches")
    .get() as { count: number };
  assert.equal(batchCount.count, 1);
});

test("same batch identity with changed provenance fails closed", async () => {
  const db = database();
  const original = await prepareMarketDataBatch({
    batchId: "cycle-1:BTC/AUD:60",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    fetchedAt: "2026-07-26T12:05:00.000Z",
    candles,
  });
  insertPrepared(db, original);
  const changed = await prepareMarketDataBatch({
    batchId: "cycle-1:BTC/AUD:60",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    sourceCursor: "different-cursor",
    fetchedAt: "2026-07-26T12:05:00.000Z",
    candles,
  });
  assert.throws(() => insertPrepared(db, changed), /market data batch payload conflict/);
  const batchCount = db
    .prepare("SELECT COUNT(*) AS count FROM market_data_batches")
    .get() as { count: number };
  assert.equal(batchCount.count, 1);
});

test("batch preparation rejects non-contiguous data and produces stable hashes", async () => {
  const input = {
    batchId: "cycle-1:BTC/AUD:60",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60 as const,
    fetchedAt: "2026-07-26T12:05:00.000Z",
    candles,
  };
  const first = await prepareMarketDataBatch(input);
  const second = await prepareMarketDataBatch(input);
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.equal(first.candles[0]?.candleSha256, second.candles[0]?.candleSha256);
  await assert.rejects(
    prepareMarketDataBatch({
      ...input,
      candles: [
        candles[0],
        { ...candles[1], timestampMs: candles[1].timestampMs + 3_600_000 },
      ],
    }),
    /contiguous and strictly ordered/,
  );
});

test("a candle must match its source batch metadata and range", async () => {
  const db = database();
  const prepared = await prepareMarketDataBatch({
    batchId: "cycle-1:BTC/AUD:60",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    fetchedAt: "2026-07-26T12:05:00.000Z",
    candles,
  });
  insertPrepared(db, prepared);

  const outsideBatchOpenTimeMs = candles[1].timestampMs + 3_600_000;
  assert.throws(
    () =>
      db.prepare(INSERT_MARKET_CANDLE_SQL).run(
        prepared.venue,
        prepared.canonicalPair,
        prepared.exchangePair,
        prepared.intervalMinutes,
        outsideBatchOpenTimeMs,
        outsideBatchOpenTimeMs + 3_600_000,
        112,
        116,
        110,
        114,
        4,
        prepared.batchId,
        "a".repeat(64),
      ),
    /market candle source batch mismatch/,
  );
});
