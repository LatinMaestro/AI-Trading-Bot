import assert from "node:assert/strict";
import test from "node:test";
import type { KrakenPublicEvidence } from "../src/exchanges/krakenPublic.ts";
import type {
  KrakenOrderBook,
  KrakenTickerObservation,
} from "../src/marketData/krakenQuality.ts";
import type { SpotPairDefinition } from "../src/marketData/pairs.ts";
import { prepareUniverseIngestionBatch } from "../src/universe/ingestion.ts";
import {
  runKrakenScheduledUniverseIngestion,
  type CommittedCandleEvidence,
  type KrakenPublicClientLike,
  type KrakenScheduledUniverseInput,
} from "../src/universe/krakenScheduledIngestion.ts";

const digest = (value: string) => value.repeat(64).slice(0, 64);
const FETCHED = 1_000_000;

function pair(
  canonicalSymbol: string,
  exchangeSymbol: string,
): SpotPairDefinition {
  const [baseAsset, quoteAsset] = canonicalSymbol.split("/");
  if (baseAsset === undefined || quoteAsset === undefined) {
    throw new Error("Invalid pair fixture");
  }
  return {
    canonicalSymbol,
    exchangeSymbol,
    baseAsset,
    quoteAsset,
    status: "online",
    priceDecimals: 2,
    volumeDecimals: 8,
    minimumOrderVolume: 0.01,
    minimumOrderCostQuote: 1,
    tickSizeQuote: 0.01,
  };
}

function ticker(
  canonicalPair: string,
  last: number,
): KrakenTickerObservation {
  return {
    canonicalPair,
    ask: last * 1.01,
    bid: last * 0.99,
    last,
    baseVolume24h: 100,
    vwap24h: last,
    quoteTurnover24h: 100 * last,
  };
}

function book(
  canonicalPair: string,
  last: number,
  volume = 100,
): KrakenOrderBook {
  return {
    canonicalPair,
    asks: [
      { price: last * 1.01, baseVolume: volume, timestampMs: FETCHED - 50 },
      { price: last * 1.02, baseVolume: volume, timestampMs: FETCHED - 40 },
    ],
    bids: [
      { price: last * 0.99, baseVolume: volume, timestampMs: FETCHED - 30 },
      { price: last * 0.98, baseVolume: volume, timestampMs: FETCHED - 20 },
    ],
  };
}

function evidence<T>(
  operation: string,
  data: T,
  fetchedAtMs = FETCHED,
): KrakenPublicEvidence<T> {
  return {
    sourceId: `kraken:${operation}:${fetchedAtMs}`,
    sourceRef: `https://api.kraken.test/${operation}`,
    fetchedAtMs,
    payloadSha256: digest(operation === "pairs" ? "a" : operation === "ticker" ? "b" : "c"),
    data,
  };
}

function candle(canonicalPair: string): CommittedCandleEvidence {
  return {
    canonicalPair,
    dailyCommittedCandles: 365,
    hourlyCommittedCandles: 2_000,
    latestDailyCommittedAtMs: FETCHED - 500,
    latestHourlyCommittedAtMs: FETCHED - 100,
    annualisedVolatility: 1.2,
    availableAtMs: FETCHED - 75,
    dataQualityState: "complete",
    source: {
      sourceId: `candles:${canonicalPair}`,
      sourceKind: "venue-market-quality",
      sourceRef: `urn:candles:${canonicalPair}`,
      fetchedAtMs: FETCHED - 75,
      payloadSha256: digest(canonicalPair.startsWith("BTC") ? "d" : "e"),
    },
  };
}

function baseInput(): KrakenScheduledUniverseInput {
  return {
    canonicalPairs: ["BTC/AUD", "ETH/USD"],
    candidateOrderAud: 150,
    maximumPairs: 10,
    depthCount: 50,
    maximumConcurrentDepthRequests: 2,
    maximumEvidenceSkewMs: 100,
    maximumHourlyCandleAgeMs: 1_000,
    maximumDailyCandleAgeMs: 2_000,
    maximumAudQuoteAgeMs: 1_000,
    candleEvidence: [candle("BTC/AUD"), candle("ETH/USD")],
    conversionQuotes: [
      {
        baseAsset: "USD",
        quoteAsset: "AUD",
        rate: 1.5,
        observedAtMs: FETCHED - 100,
        availableAtMs: FETCHED - 90,
        payloadSha256: digest("f"),
      },
    ],
  };
}

function client(options: {
  readonly depthVolume?: number;
  readonly secondDepthTime?: number;
  readonly onConcurrency?: (active: number) => void;
} = {}): KrakenPublicClientLike {
  const definitions = [pair("BTC/AUD", "XBTAUD"), pair("ETH/USD", "ETHUSD")];
  const tickers = [ticker("BTC/AUD", 100), ticker("ETH/USD", 50)];
  let active = 0;
  return {
    async fetchAssetPairs() {
      return evidence("pairs", definitions, FETCHED - 20);
    },
    async fetchTickers() {
      return evidence("ticker", tickers, FETCHED);
    },
    async fetchOrderBook(canonicalPair) {
      active += 1;
      options.onConcurrency?.(active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const last = canonicalPair === "BTC/AUD" ? 100 : 50;
      const fetchedAtMs =
        canonicalPair === "ETH/USD"
          ? options.secondDepthTime ?? FETCHED + 10
          : FETCHED + 5;
      return evidence(
        "depth",
        book(canonicalPair, last, options.depthVolume ?? 100),
        fetchedAtMs,
      );
    },
  };
}

test("joins bounded Kraken and committed evidence before atomic persistence", async () => {
  let maximumActive = 0;
  let persisted = 0;
  const repository = {
    async persistBatch(input: Parameters<typeof prepareUniverseIngestionBatch>[0]) {
      persisted += 1;
      return prepareUniverseIngestionBatch(input);
    },
  };
  const first = await runKrakenScheduledUniverseIngestion(baseInput(), {
    client: client({ onConcurrency: (active) => (maximumActive = Math.max(maximumActive, active)) }),
    repository,
    clock: () => FETCHED + 50,
  });
  const second = await runKrakenScheduledUniverseIngestion(baseInput(), {
    client: client(),
    repository,
    clock: () => FETCHED + 50,
  });

  assert.equal(persisted, 2);
  assert.ok(maximumActive <= 2);
  assert.equal(first.batch.observations.length, 2);
  const eth = first.batch.observations.find(
    (observation) => observation.canonicalPair === "ETH/USD",
  );
  assert.equal(eth?.quoteTurnoverAud24h, 7_500);
  assert.equal(first.qualityManifest.manifestSha256, second.qualityManifest.manifestSha256);
  assert.equal(first.batch.batchSha256, second.batch.batchSha256);
});

test("requires exact complete candle evidence", async () => {
  const input = { ...baseInput(), candleEvidence: [candle("BTC/AUD")] };
  await assert.rejects(
    runKrakenScheduledUniverseIngestion(input, {
      client: client(),
      repository: { persistBatch: async () => { throw new Error("unexpected persistence"); } },
      clock: () => FETCHED + 50,
    }),
    /exactly match canonicalPairs/,
  );
});

test("rejects stale committed candle evidence", async () => {
  const stale = {
    ...candle("ETH/USD"),
    latestHourlyCommittedAtMs: FETCHED - 5_000,
  };
  await assert.rejects(
    runKrakenScheduledUniverseIngestion(
      { ...baseInput(), candleEvidence: [candle("BTC/AUD"), stale] },
      {
        client: client(),
        repository: { persistBatch: async () => { throw new Error("unexpected persistence"); } },
        clock: () => FETCHED + 50,
      },
    ),
    /candle evidence is stale/,
  );
});

test("rejects insufficient displayed depth", async () => {
  await assert.rejects(
    runKrakenScheduledUniverseIngestion(baseInput(), {
      client: client({ depthVolume: 0.001 }),
      repository: { persistBatch: async () => { throw new Error("unexpected persistence"); } },
      clock: () => FETCHED + 50,
    }),
    /cannot fill the candidate order/,
  );
});

test("rejects excessive ticker and depth skew", async () => {
  await assert.rejects(
    runKrakenScheduledUniverseIngestion(baseInput(), {
      client: client({ secondDepthTime: FETCHED + 1_000 }),
      repository: { persistBatch: async () => { throw new Error("unexpected persistence"); } },
      clock: () => FETCHED + 1_100,
    }),
    /evidence skew is too large/,
  );
});

test("rejects ambiguous fresh AUD conversion paths", async () => {
  const ambiguous = [
    {
      baseAsset: "USD",
      quoteAsset: "EUR",
      rate: 1,
      observedAtMs: FETCHED - 100,
      availableAtMs: FETCHED - 90,
      payloadSha256: digest("1"),
    },
    {
      baseAsset: "EUR",
      quoteAsset: "AUD",
      rate: 1.5,
      observedAtMs: FETCHED - 100,
      availableAtMs: FETCHED - 90,
      payloadSha256: digest("2"),
    },
    {
      baseAsset: "USD",
      quoteAsset: "GBP",
      rate: 1,
      observedAtMs: FETCHED - 100,
      availableAtMs: FETCHED - 90,
      payloadSha256: digest("3"),
    },
    {
      baseAsset: "GBP",
      quoteAsset: "AUD",
      rate: 1.6,
      observedAtMs: FETCHED - 100,
      availableAtMs: FETCHED - 90,
      payloadSha256: digest("4"),
    },
  ];
  await assert.rejects(
    runKrakenScheduledUniverseIngestion(
      { ...baseInput(), conversionQuotes: ambiguous },
      {
        client: client(),
        repository: { persistBatch: async () => { throw new Error("unexpected persistence"); } },
        clock: () => FETCHED + 50,
      },
    ),
    /Ambiguous AUD valuation paths/,
  );
});
