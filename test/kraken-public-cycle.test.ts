import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareScheduledKrakenUniverse,
  runScheduledKrakenUniverseCycle,
  type UniverseBatchSink,
} from "../src/universe/krakenPublicCycle.ts";
import type { UniverseIngestionBatch, UniverseIngestionInput } from "../src/universe/ingestion.ts";

const pairsPayload = {
  error: [],
  result: {
    "BTC/AUD": {
      altname: "XBTAUD",
      base: "BTC",
      quote: "AUD",
      status: "online",
      pair_decimals: 1,
      lot_decimals: 8,
      ordermin: "0.0001",
      costmin: "1",
      tick_size: "0.1",
    },
    "ETH/AUD": {
      altname: "ETHAUD",
      base: "ETH",
      quote: "AUD",
      status: "online",
      pair_decimals: 2,
      lot_decimals: 8,
      ordermin: "0.001",
      costmin: "1",
      tick_size: "0.01",
    },
    "SOL/USD": {
      altname: "SOLUSD",
      base: "SOL",
      quote: "USD",
      status: "online",
      pair_decimals: 2,
      lot_decimals: 8,
      ordermin: "0.01",
      costmin: "1",
      tick_size: "0.01",
    },
    "USD/AUD": {
      altname: "USDAUD",
      base: "USD",
      quote: "AUD",
      status: "online",
      pair_decimals: 5,
      lot_decimals: 4,
      ordermin: "1",
      costmin: "1",
      tick_size: "0.00001",
    },
    "OFF/AUD": {
      altname: "OFFAUD",
      base: "OFF",
      quote: "AUD",
      status: "maintenance",
      pair_decimals: 2,
      lot_decimals: 4,
      ordermin: "1",
      costmin: "1",
      tick_size: "0.01",
    },
  },
};

const tickerPayload = {
  error: [],
  result: {
    "BTC/AUD": { a: ["101"], b: ["99"], c: ["100"], v: ["5", "10"], p: ["100", "100"] },
    "ETH/AUD": { a: ["51"], b: ["49"], c: ["50"], v: ["20", "40"], p: ["50", "50"] },
    "SOL/USD": { a: ["21"], b: ["19"], c: ["20"], v: ["50", "100"], p: ["20", "20"] },
    "USD/AUD": { a: ["1.51"], b: ["1.49"], c: ["1.5"], v: ["1000", "2000"], p: ["1.5", "1.5"] },
  },
};

function depthPayload(pair: string) {
  const mid = pair === "BTC/AUD" ? 100 : pair === "ETH/AUD" ? 50 : pair === "SOL/USD" ? 20 : 1.5;
  return {
    error: [],
    result: {
      [pair]: {
        asks: [
          [String(mid * 1.001), "100", 1],
          [String(mid * 1.002), "100", 1],
        ],
        bids: [
          [String(mid * 0.999), "100", 1],
          [String(mid * 0.998), "100", 1],
        ],
      },
    },
  };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(requests: string[], failures: { remaining: number } = { remaining: 0 }): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    requests.push(url.toString());
    if (failures.remaining > 0) {
      failures.remaining -= 1;
      return response({ error: [], result: {} }, 429);
    }
    if (url.pathname.endsWith("/AssetPairs")) return response(pairsPayload);
    if (url.pathname.endsWith("/Ticker")) return response(tickerPayload);
    if (url.pathname.endsWith("/Depth")) {
      const pair = url.searchParams.get("pair");
      if (pair === null) throw new Error("Missing pair");
      return response(depthPayload(pair));
    }
    return response({ error: ["EGeneral:Unknown method"], result: {} });
  }) as typeof fetch;
}

const completeHistory = {
  dailyCommittedCandles: 300,
  hourlyCommittedCandles: 1000,
  annualisedVolatility: 1.2,
  dataQualityState: "complete" as const,
};

test("fetches AU spot metadata, all tickers and a bounded rotating depth window", async () => {
  const requests: string[] = [];
  const prepared = await prepareScheduledKrakenUniverse({
    scheduledAtMs: 0,
    nowMs: () => 1000,
    fetchImpl: fakeFetch(requests),
    sleep: async () => undefined,
    maximumDepthPairs: 2,
    requestSpacingMs: 0,
    historyByPair: {
      "BTC/AUD": completeHistory,
      "ETH/AUD": completeHistory,
    },
  });

  assert.deepEqual(prepared.selectedPairs, ["BTC/AUD", "ETH/AUD"]);
  assert.equal(prepared.requestCount, 4);
  assert.equal(prepared.input.markets.length, 2);
  assert.equal(prepared.input.markets[0]?.dataQualityState, "complete");
  assert.ok((prepared.input.markets[0]?.availableQuoteVolume ?? 0) > 0);
  assert.ok((prepared.input.markets[0]?.estimatedImpactBps ?? 0) > 0);

  const metadataUrl = new URL(requests[0] ?? "");
  assert.equal(metadataUrl.searchParams.get("assetVersion"), "1");
  assert.equal(metadataUrl.searchParams.get("aclass_base"), "currency");
  assert.equal(metadataUrl.searchParams.get("country_code"), "AU");
  assert.equal(metadataUrl.searchParams.get("execution_venue"), "international");
  assert.ok(requests.slice(2).every((value) => new URL(value).searchParams.get("count") === "50"));
});

test("rotates to non-AUD markets and retains fresh conversion evidence", async () => {
  const prepared = await prepareScheduledKrakenUniverse({
    scheduledAtMs: 900_000,
    nowMs: () => 901_000,
    fetchImpl: fakeFetch([]),
    sleep: async () => undefined,
    maximumDepthPairs: 2,
    requestSpacingMs: 0,
    historyByPair: {
      "SOL/USD": completeHistory,
      "USD/AUD": completeHistory,
    },
  });

  assert.deepEqual(prepared.selectedPairs, ["SOL/USD", "USD/AUD"]);
  const sol = prepared.input.markets.find((market) => market.canonicalPair === "SOL/USD");
  assert.equal(sol?.quoteAsset, "USD");
  assert.equal(sol?.quoteTurnover24h, 2000);
  assert.ok(prepared.input.conversionQuotes.some((quote) => quote.baseAsset === "USD" && quote.quoteAsset === "AUD"));
  assert.equal(prepared.input.metadataSource.sourceKind, "venue-metadata");
  assert.equal(prepared.input.qualitySource.sourceKind, "venue-market-quality");
});

test("persists one prepared batch through the supplied atomic sink", async () => {
  let persisted: UniverseIngestionInput | undefined;
  const sink: UniverseBatchSink = {
    async persistBatch(input: UniverseIngestionInput): Promise<UniverseIngestionBatch> {
      persisted = input;
      return { batchSha256: "a".repeat(64) };
    },
  };
  const result = await runScheduledKrakenUniverseCycle(sink, {
    scheduledAtMs: 0,
    nowMs: () => 1000,
    fetchImpl: fakeFetch([]),
    sleep: async () => undefined,
    maximumDepthPairs: 1,
    requestSpacingMs: 0,
  });
  assert.equal(result.batch.batchSha256, "a".repeat(64));
  assert.equal(persisted?.venue, "kraken");
  assert.equal(result.requestCount, 3);
});

test("retries transient public throttling with bounded backoff", async () => {
  const delays: number[] = [];
  const failures = { remaining: 1 };
  const prepared = await prepareScheduledKrakenUniverse({
    scheduledAtMs: 0,
    nowMs: () => 1000,
    fetchImpl: fakeFetch([], failures),
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    maximumDepthPairs: 1,
    requestSpacingMs: 0,
    retryBaseDelayMs: 25,
  });
  assert.equal(prepared.selectedPairs.length, 1);
  assert.equal(prepared.requestCount, 4);
  assert.deepEqual(delays, [25]);
});

test("skips unavailable AUD valuation paths and fails closed for malformed books", async () => {
  const missingConversionFetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/AssetPairs")) return response(pairsPayload);
    if (url.pathname.endsWith("/Ticker")) {
      const withoutUsdAud = structuredClone(tickerPayload);
      delete (withoutUsdAud.result as Record<string, unknown>)["USD/AUD"];
      return response(withoutUsdAud);
    }
    if (url.pathname.endsWith("/Depth")) {
      const pair = url.searchParams.get("pair");
      if (pair === null) throw new Error("Missing pair");
      return response(depthPayload(pair));
    }
    return response({ error: ["EGeneral:Unknown method"], result: {} });
  }) as typeof fetch;

  const prepared = await prepareScheduledKrakenUniverse({
    scheduledAtMs: 900_000,
    nowMs: () => 901_000,
    fetchImpl: missingConversionFetch,
    sleep: async () => undefined,
    maximumDepthPairs: 1,
    requestSpacingMs: 0,
  });
  assert.ok(prepared.skippedPairs.includes("SOL/USD"));

  const malformedBookFetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/AssetPairs")) return response(pairsPayload);
    if (url.pathname.endsWith("/Ticker")) return response(tickerPayload);
    const pair = url.searchParams.get("pair");
    if (pair === null) throw new Error("Missing pair");
    return response({ error: [], result: { [pair]: { asks: [], bids: [] } } });
  }) as typeof fetch;

  await assert.rejects(
    prepareScheduledKrakenUniverse({
      scheduledAtMs: 0,
      nowMs: () => 1000,
      fetchImpl: malformedBookFetch,
      sleep: async () => undefined,
      maximumDepthPairs: 1,
      requestSpacingMs: 0,
    }),
    /has no asks/,
  );
});


test("loads stored history only for the selected rotation before persistence", async () => {
  const historyCalls: Array<{ pairs: readonly string[]; asOfMs: number }> = [];
  const prepared = await prepareScheduledKrakenUniverse({
    scheduledAtMs: 900_000,
    nowMs: () => 901_000,
    fetchImpl: fakeFetch([]),
    sleep: async () => undefined,
    maximumDepthPairs: 2,
    requestSpacingMs: 0,
    historyProvider: async (pairs, asOfMs) => {
      historyCalls.push({ pairs, asOfMs });
      return Object.fromEntries(
        pairs.map((pair) => [pair, completeHistory]),
      );
    },
  });

  assert.deepEqual(historyCalls, [
    { pairs: ["SOL/USD", "USD/AUD"], asOfMs: 900_000 },
  ]);
  assert.ok(
    prepared.input.markets.every(
      (market) => market.dataQualityState === "complete",
    ),
  );
  await assert.rejects(
    prepareScheduledKrakenUniverse({
      scheduledAtMs: 0,
      nowMs: () => 1_000,
      fetchImpl: fakeFetch([]),
      sleep: async () => undefined,
      maximumDepthPairs: 1,
      requestSpacingMs: 0,
      historyByPair: { "BTC/AUD": completeHistory },
      historyProvider: async () => ({}),
    }),
    /not both/,
  );
});
