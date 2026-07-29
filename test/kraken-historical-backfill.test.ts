import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  prepareKrakenHistoricalCsv,
  reconcileKrakenHistoricalCsv,
  type KrakenHistoricalCsvCapture,
} from "../src/marketData/krakenHistoricalBackfill.ts";
import {
  buildKrakenHistoricalOhlcvtSourceManifest,
  KRAKEN_HISTORICAL_OHLCVT_SOURCE,
} from "../src/marketData/krakenHistoricalOhlcvt.ts";
import { KrakenHistoricalBackfillRepository } from "../src/storage/krakenHistoricalBackfill.ts";
import { MarketCandleRepository } from "../src/storage/marketCandles.ts";
import { sha256Hex } from "../src/utils/crypto.ts";

const FIRST_OPEN_SECONDS = 1_704_067_200;
const CSV_TEXT = [
  `${FIRST_OPEN_SECONDS},100,105,95,102,101,10,4`,
  `${FIRST_OPEN_SECONDS + 7_200},102,108,100,107,105,12,5`,
  `${FIRST_OPEN_SECONDS + 10_800},107,110,104,106,107,9,3`,
].join("\n");
const ACQUIRED_AT = "2024-01-02T00:00:00.000Z";

async function capture(
  overrides: Partial<KrakenHistoricalCsvCapture> = {},
): Promise<KrakenHistoricalCsvCapture> {
  const manifest = await buildKrakenHistoricalOhlcvtSourceManifest();
  return {
    sourceContractSha256: manifest.contractSha256,
    archiveKind: "complete",
    archiveUrl: KRAKEN_HISTORICAL_OHLCVT_SOURCE.completeArchiveUrl,
    archiveSha256: "a".repeat(64),
    archiveByteLength: 1_000_000,
    acquiredAt: ACQUIRED_AT,
    csvMemberName: "XBTAUD_60.csv",
    csvSha256: await sha256Hex(CSV_TEXT),
    csvByteLength: new TextEncoder().encode(CSV_TEXT).length,
    csvText: CSV_TEXT,
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    ...overrides,
  };
}

test("validates sparse official CSV without fabricating empty intervals", async () => {
  const prepared = await prepareKrakenHistoricalCsv(await capture());
  const first = prepared.candles[0];
  const second = prepared.candles[1];
  assert.ok(first);
  assert.ok(second);

  assert.equal(prepared.rowCount, 3);
  assert.equal(second.timestampMs - first.timestampMs, 7_200_000);
  assert.equal(second.tradeCount, 5);
  assert.equal(second.vwap, 105);
  assert.match(prepared.csvManifestSha256, /^[0-9a-f]{64}$/u);
});

test("rejects digest, identity, chronology and row-shape conflicts", async () => {
  const invalidInputs: KrakenHistoricalCsvCapture[] = [
    await capture({ csvSha256: "b".repeat(64) }),
    await capture({ csvMemberName: "XBTAUD_1440.csv" }),
    await capture({ exchangePair: "ETHAUD" }),
    await capture({
      acquiredAt: "2024-01-01T01:00:00.000Z",
    }),
    await capture({
      csvText: CSV_TEXT.replace(",10,4", ",10"),
      csvSha256: await sha256Hex(CSV_TEXT.replace(",10,4", ",10")),
      csvByteLength: new TextEncoder().encode(
        CSV_TEXT.replace(",10,4", ",10"),
      ).length,
    }),
  ];
  for (const invalid of invalidInputs) {
    await assert.rejects(prepareKrakenHistoricalCsv(invalid));
  }
});

test("requires an exact committed REST overlap", async () => {
  const prepared = await prepareKrakenHistoricalCsv(await capture());
  const matching = [
    {
      timestampMs: (FIRST_OPEN_SECONDS + 7_200) * 1000,
      open: 102,
      high: 108,
      low: 100,
      close: 107,
      volume: 12,
    },
    {
      timestampMs: (FIRST_OPEN_SECONDS + 10_800) * 1000,
      open: 107,
      high: 110,
      low: 104,
      close: 106,
      volume: 9,
    },
  ];
  const reconciled = await reconcileKrakenHistoricalCsv(prepared, matching);

  assert.equal(reconciled.restOverlapCount, 2);
  assert.match(reconciled.restOverlapSha256, /^[0-9a-f]{64}$/u);
  assert.match(reconciled.backfillId, /^[0-9a-f]{64}$/u);
  await assert.rejects(reconcileKrakenHistoricalCsv(prepared, []));
  await assert.rejects(
    reconcileKrakenHistoricalCsv(prepared, [
      { ...matching[0]!, close: 106 },
    ]),
    /conflicts with committed REST/u,
  );
});

class SQLiteD1 {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(sql: string): D1PreparedStatement {
    const prepared = this.database.prepare(sql);
    let params: Array<string | number | null> = [];
    const statement = {
      bind: (...values: Array<string | number | null>) => {
        params = values;
        return statement;
      },
      run: () => prepared.run(...params),
      first: <T>() => (prepared.get(...params) as T | undefined) ?? null,
      all: <T>() =>
        Promise.resolve({
          success: true,
          meta: {},
          results: prepared.all(...params) as T[],
        }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  async batch(statements: readonly D1PreparedStatement[]): Promise<unknown[]> {
    this.database.exec("BEGIN");
    try {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase(): {
  readonly sqlite: DatabaseSync;
  readonly d1: D1Database;
} {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0003_market_candles.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL(
        "../migrations/0019_historical_candle_backfills.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return {
    sqlite,
    d1: new SQLiteD1(sqlite) as unknown as D1Database,
  };
}

test("persists sparse candles and a database-verified immutable commit", async () => {
  const { sqlite, d1 } = createDatabase();
  const recent = new MarketCandleRepository(d1);
  await recent.persistBatch({
    batchId: "rest-overlap",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    fetchedAt: ACQUIRED_AT,
    candles: [
      {
        timestampMs: (FIRST_OPEN_SECONDS + 7_200) * 1000,
        open: 102,
        high: 108,
        low: 100,
        close: 107,
        volume: 12,
      },
      {
        timestampMs: (FIRST_OPEN_SECONDS + 10_800) * 1000,
        open: 107,
        high: 110,
        low: 104,
        close: 106,
        volume: 9,
      },
    ],
  });

  const repository = new KrakenHistoricalBackfillRepository(d1, 4);
  const first = await repository.persistCapture(await capture());
  const retry = await repository.persistCapture(await capture());
  assert.deepEqual(retry, first);
  assert.equal(first.committedCount, 3);
  assert.equal(first.restOverlapCount, 2);
  assert.equal(
    (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM historical_market_candles",
        )
        .get() as { readonly count: number }
    ).count,
    3,
  );
  assert.equal(
    (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM historical_candle_backfill_commits",
        )
        .get() as { readonly count: number }
    ).count,
    1,
  );
  assert.throws(
    () =>
      sqlite.exec(
        "UPDATE historical_market_candles SET close = close + 1",
      ),
    /historical candles are immutable/u,
  );
  sqlite.close();
});

test("database rejects incomplete and conflicting overlap commits", async () => {
  const { sqlite } = createDatabase();
  const backfillId = "1".repeat(64);
  sqlite
    .prepare(
      `INSERT INTO historical_candle_backfills
       VALUES (?, ?, 'complete', ?, ?, 1, ?, 'XBTAUD_60.csv', ?, 1,
               'BTC/AUD', 'XBTAUD', 60, 1, ?, ?, ?, 1, ?)`,
    )
    .run(
      backfillId,
      "2".repeat(64),
      KRAKEN_HISTORICAL_OHLCVT_SOURCE.completeArchiveUrl,
      "3".repeat(64),
      ACQUIRED_AT,
      "4".repeat(64),
      FIRST_OPEN_SECONDS * 1000,
      FIRST_OPEN_SECONDS * 1000,
      "5".repeat(64),
      "6".repeat(64),
    );
  assert.throws(
    () =>
      sqlite
        .prepare(
          `INSERT INTO historical_candle_backfill_commits
           VALUES (?, ?, 1, 1, ?)`,
        )
        .run(backfillId, ACQUIRED_AT, backfillId),
    /membership is incomplete/u,
  );
  sqlite.close();
});
