import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketCandleHistoryRepository,
  summariseStoredCandleHistory,
  type StoredCandleHistoryRow,
} from "../src/marketData/historyEvidence.ts";
import { DAY_MS, HOUR_MS } from "../src/marketData/candleIntervals.ts";

const asOfMs = Date.UTC(2026, 6, 27, 0);

function row(
  pair: string,
  intervalMinutes: 60 | 1440,
  openTimeMs: number,
  close: number,
  fetchedAtMs = asOfMs - 1,
): StoredCandleHistoryRow {
  return {
    canonicalPair: pair,
    intervalMinutes,
    openTimeMs,
    closeTimeMs: openTimeMs + intervalMinutes * 60_000,
    close,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
  };
}

function completeRows(pair = "BTC/AUD"): StoredCandleHistoryRow[] {
  return [
    row(pair, 1440, asOfMs - 3 * DAY_MS, 100),
    row(pair, 1440, asOfMs - 2 * DAY_MS, 110),
    row(pair, 1440, asOfMs - DAY_MS, 99),
    row(pair, 60, asOfMs - 2 * HOUR_MS, 100),
    row(pair, 60, asOfMs - HOUR_MS, 101),
  ];
}

test("derives committed counts and annualised daily log-return volatility", () => {
  const result = summariseStoredCandleHistory(
    ["BTC/AUD"],
    completeRows(),
    asOfMs,
  )["BTC/AUD"];
  assert.equal(result?.dailyCommittedCandles, 3);
  assert.equal(result?.hourlyCommittedCandles, 2);
  assert.equal(result?.dataQualityState, "complete");
  assert.ok((result?.annualisedVolatility ?? 0) > 0);
});

test("marks internal gaps and missing intervals as incomplete", () => {
  const rows = completeRows().filter(
    (item) => !(item.intervalMinutes === 60 && item.openTimeMs === asOfMs - HOUR_MS),
  );
  const result = summariseStoredCandleHistory(
    ["BTC/AUD", "ETH/AUD"],
    rows,
    asOfMs,
  );
  assert.equal(result["BTC/AUD"]?.dataQualityState, "complete");
  assert.deepEqual(result["ETH/AUD"], {
    dailyCommittedCandles: 0,
    hourlyCommittedCandles: 0,
    annualisedVolatility: 0,
    dataQualityState: "gap",
  });

  const gappedDaily = completeRows().filter(
    (item) => !(item.intervalMinutes === 1440 && item.openTimeMs === asOfMs - 2 * DAY_MS),
  );
  assert.equal(
    summariseStoredCandleHistory(["BTC/AUD"], gappedDaily, asOfMs)["BTC/AUD"]
      ?.dataQualityState,
    "gap",
  );
});

test("stale history takes precedence and look-ahead evidence is rejected", () => {
  const oldAsOf = asOfMs + 3 * DAY_MS;
  assert.equal(
    summariseStoredCandleHistory(["BTC/AUD"], completeRows(), oldAsOf)[
      "BTC/AUD"
    ]?.dataQualityState,
    "stale",
  );
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        [row("BTC/AUD", 60, asOfMs, 100, asOfMs + HOUR_MS)],
        asOfMs,
      ),
    /invalid candle chronology|invalid availability time/,
  );
});

test("repository binds venue, pairs and as-of availability before summarising", async () => {
  let sql = "";
  let params: unknown[] = [];
  const rows = completeRows();
  const db = {
    prepare(statement: string) {
      sql = statement;
      return {
        bind(...values: unknown[]) {
          params = values;
          return {
            async all<T>() {
              return { results: rows as T[] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  const repository = new MarketCandleHistoryRepository(db);
  const result = await repository.loadKrakenHistoryByPair(
    ["BTC/AUD"],
    asOfMs,
  );
  assert.equal(result["BTC/AUD"]?.dataQualityState, "complete");
  assert.match(sql, /batch\.fetched_at <= \?/);
  assert.deepEqual(params, [
    "kraken",
    "BTC/AUD",
    asOfMs,
    new Date(asOfMs).toISOString(),
  ]);
});

test("rejects duplicate requests, unexpected rows and malformed values", () => {
  assert.throws(
    () => summariseStoredCandleHistory(["BTC/AUD", "BTC/AUD"], [], asOfMs),
    /Duplicate history pair/,
  );
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        [row("ETH/AUD", 60, asOfMs - HOUR_MS, 1)],
        asOfMs,
      ),
    /Unexpected candle pair/,
  );
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        [{ ...row("BTC/AUD", 60, asOfMs - HOUR_MS, 1), close: 0 }],
        asOfMs,
      ),
    /invalid close/,
  );
});
