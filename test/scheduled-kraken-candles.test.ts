import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { SpotPairDefinition } from "../src/marketData/pairs.ts";
import {
  runScheduledKrakenCandleCycle,
  type ScheduledCandleHistoryEvidence,
} from "../src/marketData/scheduledKrakenCandles.ts";
import {
  prepareMarketDataBatch,
  MarketCandleRepository,
  type MarketCandleBatchSink,
  type MarketDataBatchInput,
  type PreparedMarketDataBatch,
} from "../src/storage/marketCandles.ts";

const SCHEDULED_AT_MS = Date.parse("2026-07-29T06:00:00.000Z");
const pair: SpotPairDefinition = {
  canonicalSymbol: "BTC/AUD",
  exchangeSymbol: "XBTAUD",
  baseAsset: "BTC",
  quoteAsset: "AUD",
  status: "online",
  priceDecimals: 1,
  volumeDecimals: 8,
  minimumOrderVolume: 0.0001,
  minimumOrderCostQuote: 10,
  tickSizeQuote: 0.1,
};

class MemoryStore implements MarketCandleBatchSink {
  readonly inputs: MarketDataBatchInput[] = [];
  readonly latest = new Map<number, number | null>([
    [60, SCHEDULED_AT_MS - 7_200_000],
    [1440, null],
  ]);
  gapInterval: 60 | 1440 | null = null;
  gapOpenTimeMs: number | null = null;
  repairApplied = false;
  ignoreRepair = false;

  loadLatestOpenTimeMs(
    _canonicalPair: string,
    intervalMinutes: 60 | 1440,
  ): Promise<number | null> {
    return Promise.resolve(this.latest.get(intervalMinutes) ?? null);
  }

  loadOpenTimesMs(
    _canonicalPair: string,
    intervalMinutes: 60 | 1440,
    startOpenTimeMs: number,
    endOpenTimeMs: number,
  ): Promise<readonly number[]> {
    const stepMs = intervalMinutes * 60_000;
    const result: number[] = [];
    for (
      let openTimeMs = startOpenTimeMs;
      openTimeMs <= endOpenTimeMs;
      openTimeMs += stepMs
    ) {
      if (
        this.gapInterval === intervalMinutes &&
        this.gapOpenTimeMs === openTimeMs &&
        !this.repairApplied
      ) {
        continue;
      }
      result.push(openTimeMs);
    }
    return Promise.resolve(result);
  }

  async persistBatch(
    input: MarketDataBatchInput,
  ): Promise<PreparedMarketDataBatch> {
    this.inputs.push(input);
    if (
      this.gapOpenTimeMs !== null &&
      !this.ignoreRepair &&
      input.intervalMinutes === this.gapInterval &&
      input.candles.some(
        (candle) => candle.timestampMs === this.gapOpenTimeMs,
      )
    ) {
      this.repairApplied = true;
    }
    return prepareMarketDataBatch(input);
  }
}

function rows(intervalMinutes: 60 | 1440, gap = false): unknown[][] {
  const stepSeconds = intervalMinutes * 60;
  const currentOpenSeconds =
    Math.floor(SCHEDULED_AT_MS / (stepSeconds * 1000)) * stepSeconds;
  return [-2, gap ? 0 : -1, 0].map((offset) => {
    const value = 100 + offset;
    return [
      currentOpenSeconds + offset * stepSeconds,
      String(value),
      String(value + 2),
      String(value - 2),
      String(value + 1),
      String(value + 0.5),
      "12.5",
      10,
    ];
  });
}

function rowsFromRequest(requestUrl: URL, gap = false): unknown[][] {
  const intervalMinutes = Number(requestUrl.searchParams.get("interval")) as
    | 60
    | 1440;
  const stepSeconds = intervalMinutes * 60;
  const currentOpenSeconds =
    Math.floor(SCHEDULED_AT_MS / (stepSeconds * 1000)) * stepSeconds;
  if (gap) return rows(intervalMinutes, true);
  const since = requestUrl.searchParams.get("since");
  if (since === null) return rows(intervalMinutes, gap);
  const firstOpenSeconds = Math.max(
    currentOpenSeconds - 719 * stepSeconds,
    Number(since),
  );
  const result: unknown[][] = [];
  for (
    let timestampSeconds = firstOpenSeconds;
    timestampSeconds <= currentOpenSeconds;
    timestampSeconds += stepSeconds
  ) {
    if (
      gap &&
      timestampSeconds === firstOpenSeconds + 2 * stepSeconds
    ) {
      continue;
    }
    const value =
      100 + (timestampSeconds - currentOpenSeconds) / stepSeconds;
    result.push([
      timestampSeconds,
      String(value),
      String(value + 2),
      String(value - 2),
      String(value + 1),
      String(value + 0.5),
      "12.5",
      10,
    ]);
  }
  return result;
}

function payload(
  requestUrl: URL,
  options: { readonly gap?: boolean; readonly resultKey?: string } = {},
): string {
  return JSON.stringify({
    error: [],
    result: {
      [options.resultKey ?? "BTC/AUD"]: rowsFromRequest(
        requestUrl,
        options.gap,
      ),
      last: Math.floor(SCHEDULED_AT_MS / 1000),
    },
  });
}

function history(
  overrides: Partial<ScheduledCandleHistoryEvidence> = {},
): Readonly<Record<string, ScheduledCandleHistoryEvidence>> {
  return {
    "BTC/AUD": {
      dailyCommittedCandles: 220,
      hourlyCommittedCandles: 220,
      dataQualityState: "complete",
      ...overrides,
    },
  };
}

function monotonicClock(): () => number {
  let current = SCHEDULED_AT_MS;
  return () => {
    current += 1;
    return current;
  };
}

test("fetches both approved intervals incrementally and persists exact response provenance", async () => {
  const store = new MemoryStore();
  const urls: URL[] = [];
  const result = await runScheduledKrakenCandleCycle({
    scheduledAtMs: SCHEDULED_AT_MS,
    pairs: [pair],
    store,
    historyProvider: () => Promise.resolve(history()),
    fetchImpl: (input) => {
      const url = new URL(String(input));
      urls.push(url);
      const body = payload(url);
      return Promise.resolve(
        new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(new TextEncoder().encode(body).byteLength),
          },
        }),
      );
    },
    nowMs: monotonicClock(),
    sleep: () => Promise.resolve(),
    requestSpacingMs: 0,
  });

  assert.equal(result.requestCount, 2);
  assert.equal(result.captures.length, 2);
  assert.equal(result.repairCaptureCount, 0);
  assert.equal(result.detectedMissingCandleCount, 0);
  assert.equal(store.inputs.length, 2);
  assert.deepEqual(
    urls.map((url) => url.searchParams.get("interval")),
    ["60", "1440"],
  );
  assert.equal(urls[0]?.searchParams.get("assetVersion"), "1");
  assert.equal(
    urls[0]?.searchParams.get("since"),
    String((SCHEDULED_AT_MS - 7_200_000) / 1000),
  );
  assert.equal(urls[1]?.searchParams.has("since"), false);
  for (const capture of result.captures) {
    assert.match(capture.batch.batchId, /^[0-9a-f]{64}$/u);
    assert.match(capture.responseSha256, /^[0-9a-f]{64}$/u);
    assert.match(
      capture.sourceCursor,
      /^last=\d+;response-sha256=[0-9a-f]{64}$/u,
    );
    assert.equal(capture.batch.committedCount, 2);
  }
});

test("retries one transient response and records every HTTP attempt", async () => {
  const store = new MemoryStore();
  let calls = 0;
  const result = await runScheduledKrakenCandleCycle({
    scheduledAtMs: SCHEDULED_AT_MS,
    pairs: [pair],
    store,
    historyProvider: () => Promise.resolve(history()),
    fetchImpl: (input) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response("temporarily unavailable", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          }),
        );
      }
      const body = payload(new URL(String(input)));
      return Promise.resolve(
        new Response(body, {
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    nowMs: monotonicClock(),
    sleep: () => Promise.resolve(),
    requestSpacingMs: 0,
  });
  assert.equal(result.requestCount, 3);
});

test("repairs a bounded internal REST-horizon gap before history validation", async () => {
  const store = new MemoryStore();
  store.gapInterval = 60;
  store.gapOpenTimeMs = SCHEDULED_AT_MS - 10 * 60 * 60_000;
  const urls: URL[] = [];
  const result = await runScheduledKrakenCandleCycle({
    scheduledAtMs: SCHEDULED_AT_MS,
    pairs: [pair],
    store,
    historyProvider: () => Promise.resolve(history()),
    fetchImpl: (input) => {
      const url = new URL(String(input));
      urls.push(url);
      const body = payload(url);
      return Promise.resolve(
        new Response(body, {
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    nowMs: monotonicClock(),
    sleep: () => Promise.resolve(),
    requestSpacingMs: 0,
  });

  assert.equal(result.requestCount, 3);
  assert.equal(result.captures.length, 3);
  assert.equal(result.detectedRepairableGapCount, 1);
  assert.equal(result.detectedMissingCandleCount, 1);
  assert.equal(result.repairCaptureCount, 1);
  assert.equal(store.repairApplied, true);
  assert.equal(
    urls[2]?.searchParams.get("since"),
    String((store.gapOpenTimeMs - 60 * 60_000) / 1000),
  );
});

test("fails closed when one bounded repair capture leaves a gap", async () => {
  const store = new MemoryStore();
  store.gapInterval = 60;
  store.gapOpenTimeMs = SCHEDULED_AT_MS - 10 * 60 * 60_000;
  store.ignoreRepair = true;
  await assert.rejects(
    runScheduledKrakenCandleCycle({
      scheduledAtMs: SCHEDULED_AT_MS,
      pairs: [pair],
      store,
      historyProvider: () => Promise.resolve(history()),
      fetchImpl: (input) => {
        const body = payload(new URL(String(input)));
        return Promise.resolve(
          new Response(body, {
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
      nowMs: monotonicClock(),
      sleep: () => Promise.resolve(),
      requestSpacingMs: 0,
    }),
    /REST gap repair is incomplete/u,
  );
  assert.equal(store.inputs.length, 3);
});

test("rejects gaps and changed canonical response identity before persistence", async () => {
  for (const mode of ["gap", "identity"] as const) {
    const store = new MemoryStore();
    await assert.rejects(
      runScheduledKrakenCandleCycle({
        scheduledAtMs: SCHEDULED_AT_MS,
        pairs: [pair],
        store,
        historyProvider: () => Promise.resolve(history()),
        fetchImpl: (input) => {
          const url = new URL(String(input));
          const body = payload(
            url,
            mode === "gap"
              ? { gap: true }
              : { resultKey: "ETH/AUD" },
          );
          return Promise.resolve(
            new Response(body, {
              headers: { "Content-Type": "application/json" },
            }),
          );
        },
        nowMs: monotonicClock(),
        sleep: () => Promise.resolve(),
        requestSpacingMs: 0,
      }),
      mode === "gap" ? /missing, duplicate or unordered/u : /identity/u,
    );
    assert.equal(store.inputs.length, 0);
  }
});

test("rejects oversized and unsupported responses before parsing", async () => {
  const store = new MemoryStore();
  await assert.rejects(
    runScheduledKrakenCandleCycle({
      scheduledAtMs: SCHEDULED_AT_MS,
      pairs: [pair],
      store,
      historyProvider: () => Promise.resolve(history()),
      fetchImpl: () =>
        Promise.resolve(
          new Response("{}", {
            headers: {
              "Content-Type": "application/json",
              "Content-Length": "1048577",
            },
          }),
        ),
      nowMs: monotonicClock(),
      sleep: () => Promise.resolve(),
      requestSpacingMs: 0,
    }),
    /declared length is invalid or oversized/u,
  );
  assert.equal(store.inputs.length, 0);
});

test("enforces the response limit while streaming and rejects invalid UTF-8", async () => {
  for (const mode of ["stream-size", "utf8"] as const) {
    const store = new MemoryStore();
    let cancelled = false;
    const chunks =
      mode === "stream-size"
        ? [new Uint8Array(600_000), new Uint8Array(600_000)]
        : [Uint8Array.from([0xc3, 0x28])];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk !== undefined) controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      runScheduledKrakenCandleCycle({
        scheduledAtMs: SCHEDULED_AT_MS,
        pairs: [pair],
        store,
        historyProvider: () => Promise.resolve(history()),
        fetchImpl: () =>
          Promise.resolve(
            new Response(body, {
              headers: { "Content-Type": "application/json" },
            }),
          ),
        nowMs: monotonicClock(),
        sleep: () => Promise.resolve(),
        requestSpacingMs: 0,
      }),
      mode === "stream-size" ? /body is oversized/u : /not valid UTF-8/u,
    );
    assert.equal(store.inputs.length, 0);
    assert.equal(cancelled, true);
  }
});

test("fails closed when aggregate persisted history remains incomplete", async () => {
  const store = new MemoryStore();
  await assert.rejects(
    runScheduledKrakenCandleCycle({
      scheduledAtMs: SCHEDULED_AT_MS,
      pairs: [pair],
      store,
      historyProvider: () =>
        Promise.resolve(history({ hourlyCommittedCandles: 219 })),
      fetchImpl: (input) => {
        const body = payload(new URL(String(input)));
        return Promise.resolve(
          new Response(body, {
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
      nowMs: monotonicClock(),
      sleep: () => Promise.resolve(),
      requestSpacingMs: 0,
    }),
    /persisted hourly\/daily candle history is incomplete/u,
  );
  assert.equal(store.inputs.length, 2);
});

test("rejects duplicate configured pair identities without network access", async () => {
  let called = false;
  await assert.rejects(
    runScheduledKrakenCandleCycle({
      scheduledAtMs: SCHEDULED_AT_MS,
      pairs: [pair, pair],
      store: new MemoryStore(),
      historyProvider: () => Promise.resolve(history()),
      fetchImpl: () => {
        called = true;
        return Promise.reject(new Error("unexpected"));
      },
    }),
    /unique and canonical/u,
  );
  assert.equal(called, false);
});

class SQLiteD1 {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(sql: string) {
    const prepared = this.sqlite.prepare(sql);
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
    return statement;
  }

  batch(statements: readonly { run(): unknown }[]): readonly unknown[] {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

test("loads the exact persisted incremental cursor from immutable D1 candles", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0003_market_candles.sql", import.meta.url),
      "utf8",
    ),
  );
  const repository = new MarketCandleRepository(
    new SQLiteD1(sqlite) as unknown as D1Database,
  );
  const latestOpenTimeMs = SCHEDULED_AT_MS - 3_600_000;
  await repository.persistBatch({
    batchId: "a".repeat(64),
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    exchangePair: "XBTAUD",
    intervalMinutes: 60,
    sourceCursor: `last=${SCHEDULED_AT_MS / 1000};response-sha256=${"b".repeat(64)}`,
    fetchedAt: new Date(SCHEDULED_AT_MS).toISOString(),
    candles: [
      {
        timestampMs: latestOpenTimeMs,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 5,
      },
    ],
  });
  assert.equal(
    await repository.loadLatestOpenTimeMs("BTC/AUD", 60),
    latestOpenTimeMs,
  );
  assert.equal(await repository.loadLatestOpenTimeMs("BTC/AUD", 1440), null);
  assert.deepEqual(
    await repository.loadOpenTimesMs(
      "BTC/AUD",
      60,
      latestOpenTimeMs - 3_600_000,
      latestOpenTimeMs,
    ),
    [latestOpenTimeMs],
  );
  sqlite.close();
});
