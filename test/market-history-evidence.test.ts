import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketCandleHistoryRepository,
  summariseStoredCandleHistory,
  type StoredCandleHistorySummaryRow,
  type StoredDailyCloseRow,
} from "../src/marketData/historyEvidence.ts";
import { DAY_MS, HOUR_MS } from "../src/marketData/candleIntervals.ts";

const asOfMs = Date.UTC(2026, 6, 27, 0);

function summaries(pair = "BTC/AUD"): StoredCandleHistorySummaryRow[] {
  return [
    {
      canonicalPair: pair,
      intervalMinutes: 60,
      committedCount: 2,
      firstOpenTimeMs: asOfMs - 2 * HOUR_MS,
      lastOpenTimeMs: asOfMs - HOUR_MS,
      latestCloseTimeMs: asOfMs,
    },
    {
      canonicalPair: pair,
      intervalMinutes: 1440,
      committedCount: 3,
      firstOpenTimeMs: asOfMs - 3 * DAY_MS,
      lastOpenTimeMs: asOfMs - DAY_MS,
      latestCloseTimeMs: asOfMs,
    },
  ];
}

function dailyCloses(pair = "BTC/AUD"): StoredDailyCloseRow[] {
  return [100, 110, 99].map((close, index) => {
    const openTimeMs = asOfMs - (3 - index) * DAY_MS;
    return {
      canonicalPair: pair,
      openTimeMs,
      closeTimeMs: openTimeMs + DAY_MS,
      close,
      fetchedAt: new Date(asOfMs - 1).toISOString(),
    };
  });
}

test("derives committed counts and annualised daily log-return volatility", () => {
  const result = summariseStoredCandleHistory(
    ["BTC/AUD"],
    summaries(),
    dailyCloses(),
    asOfMs,
  )["BTC/AUD"];
  assert.equal(result?.dailyCommittedCandles, 3);
  assert.equal(result?.hourlyCommittedCandles, 2);
  assert.equal(result?.dataQualityState, "complete");
  assert.ok((result?.annualisedVolatility ?? 0) > 0);
});

test("marks aggregate gaps and missing intervals as incomplete", () => {
  const gapped = summaries().map((item) =>
    item.intervalMinutes === 60
      ? { ...item, committedCount: 1 }
      : item,
  );
  assert.equal(
    summariseStoredCandleHistory(
      ["BTC/AUD"],
      gapped,
      dailyCloses(),
      asOfMs,
    )["BTC/AUD"]?.dataQualityState,
    "gap",
  );
  assert.deepEqual(
    summariseStoredCandleHistory(["ETH/AUD"], [], [], asOfMs)["ETH/AUD"],
    {
      dailyCommittedCandles: 0,
      hourlyCommittedCandles: 0,
      annualisedVolatility: 0,
      dataQualityState: "gap",
    },
  );
});

test("stale summaries take precedence and look-ahead evidence is rejected", () => {
  const oldAsOf = asOfMs + 3 * DAY_MS;
  assert.equal(
    summariseStoredCandleHistory(
      ["BTC/AUD"],
      summaries(),
      dailyCloses(),
      oldAsOf,
    )["BTC/AUD"]?.dataQualityState,
    "stale",
  );
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        summaries(),
        [
          {
            ...dailyCloses()[0],
            closeTimeMs: asOfMs + DAY_MS,
          } as StoredDailyCloseRow,
        ],
        asOfMs,
      ),
    /invalid daily chronology/,
  );
});

test("rejects incomplete volatility samples and impossible counts", () => {
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        summaries(),
        dailyCloses().slice(1),
        asOfMs,
      ),
    /sample is incomplete/,
  );
  const impossible = summaries().map((item) =>
    item.intervalMinutes === 60
      ? { ...item, committedCount: 3 }
      : item,
  );
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        impossible,
        dailyCloses(),
        asOfMs,
      ),
    /impossible committed count/,
  );
});

test("repository batches bounded aggregate and trailing-volatility reads", async () => {
  const prepared: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const item = { sql, params: [] as unknown[] };
      prepared.push(item);
      return {
        bind(...params: unknown[]) {
          item.params = params;
          return item;
        },
      };
    },
    async batch() {
      return [
        { results: summaries() },
        { results: dailyCloses() },
      ];
    },
  } as unknown as D1Database;

  const repository = new MarketCandleHistoryRepository(db);
  const result = await repository.loadKrakenHistoryByPair(
    ["BTC/AUD"],
    asOfMs,
  );
  assert.equal(result["BTC/AUD"]?.dataQualityState, "complete");
  assert.equal(prepared.length, 2);
  assert.match(prepared[0]?.sql ?? "", /COUNT\(\*\)/);
  assert.match(prepared[1]?.sql ?? "", /ROW_NUMBER\(\)/);
  assert.deepEqual(prepared[0]?.params, [
    "kraken",
    "BTC/AUD",
    asOfMs,
    new Date(asOfMs).toISOString(),
  ]);
  assert.equal(prepared[1]?.params.at(-1), 366);
});

test("rejects duplicate requests, unexpected rows and malformed values", () => {
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD", "BTC/AUD"],
        [],
        [],
        asOfMs,
      ),
    /Duplicate history pair/,
  );
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        summaries("ETH/AUD"),
        [],
        asOfMs,
      ),
    /Unexpected candle pair/,
  );
  assert.throws(
    () =>
      summariseStoredCandleHistory(
        ["BTC/AUD"],
        summaries(),
        [{ ...dailyCloses()[0], close: 0 } as StoredDailyCloseRow],
        asOfMs,
      ),
    /invalid daily close/,
  );
});
