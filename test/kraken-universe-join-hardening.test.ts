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
  type KrakenPublicClientLike,
  type KrakenScheduledUniverseInput,
} from "../src/universe/krakenScheduledIngestion.ts";

const NOW = 2_000_000;
const digest = (value: string) => value.repeat(64).slice(0, 64);

function evidence<T>(
  name: string,
  payloadSha256: string,
  data: T,
): KrakenPublicEvidence<T> {
  return {
    sourceId: `kraken:${name}`,
    sourceRef: `https://api.kraken.test/${name}`,
    fetchedAtMs: NOW,
    payloadSha256,
    data,
  };
}

function input(): KrakenScheduledUniverseInput {
  return {
    canonicalPairs: ["ETH/USD"],
    candidateOrderAud: 100,
    maximumPairs: 2,
    depthCount: 10,
    maximumConcurrentDepthRequests: 1,
    maximumEvidenceSkewMs: 100,
    maximumHourlyCandleAgeMs: 2_000,
    maximumDailyCandleAgeMs: 2_000,
    maximumAudQuoteAgeMs: 2_000,
    candleEvidence: [
      {
        canonicalPair: "ETH/USD",
        dailyCommittedCandles: 365,
        hourlyCommittedCandles: 2_000,
        latestDailyCommittedAtMs: NOW - 500,
        latestHourlyCommittedAtMs: NOW - 100,
        annualisedVolatility: 1.1,
        availableAtMs: NOW - 50,
        dataQualityState: "complete",
        source: {
          sourceId: "candles:ETH/USD",
          sourceKind: "venue-market-quality",
          sourceRef: "urn:candles:ETH/USD",
          fetchedAtMs: NOW - 50,
          payloadSha256: digest("c"),
        },
      },
    ],
    conversionQuotes: [
      {
        baseAsset: "USD",
        quoteAsset: "AUD",
        rate: 1.5,
        observedAtMs: NOW - 100,
        availableAtMs: NOW - 90,
        payloadSha256: digest("u"),
      },
      {
        baseAsset: "EUR",
        quoteAsset: "AUD",
        rate: 1.7,
        observedAtMs: NOW - 100,
        availableAtMs: NOW - 90,
        payloadSha256: digest("e"),
      },
    ],
  };
}

function client(): KrakenPublicClientLike {
  const pair: SpotPairDefinition = {
    canonicalSymbol: "ETH/USD",
    exchangeSymbol: "ETHUSD",
    baseAsset: "ETH",
    quoteAsset: "USD",
    status: "online",
    priceDecimals: 2,
    volumeDecimals: 8,
    minimumOrderVolume: 0.01,
    minimumOrderCostQuote: 1,
    tickSizeQuote: 0.01,
  };
  const ticker: KrakenTickerObservation = {
    canonicalPair: "ETH/USD",
    ask: 51,
    bid: 49,
    last: 50,
    baseVolume24h: 100,
    vwap24h: 50,
    quoteTurnover24h: 5_000,
  };
  const book: KrakenOrderBook = {
    canonicalPair: "ETH/USD",
    asks: [{ price: 51, baseVolume: 10, timestampMs: NOW - 10 }],
    bids: [{ price: 49, baseVolume: 10, timestampMs: NOW - 10 }],
  };
  return {
    async fetchAssetPairs() {
      return evidence("pairs", digest("a"), [pair]);
    },
    async fetchTickers() {
      return evidence("ticker", digest("b"), [ticker]);
    },
    async fetchOrderBook() {
      return evidence("depth", digest("d"), book);
    },
  };
}

test("manifest includes only conversion evidence used by selected pairs", async () => {
  const result = await runKrakenScheduledUniverseIngestion(input(), {
    client: client(),
    repository: {
      persistBatch: (value) => prepareUniverseIngestionBatch(value),
    },
    clock: () => NOW + 10,
  });
  assert.deepEqual(result.qualityManifest.conversionQuoteDigests, [digest("u")]);
});

test("lifecycle evidence outside selected pairs fails before public fetches", async () => {
  let fetched = false;
  const invalid: KrakenScheduledUniverseInput = {
    ...input(),
    lifecycleAnnouncements: [
      {
        source: {
          sourceId: "listing:SOL/AUD",
          sourceKind: "official-lifecycle-announcement",
          sourceRef: "urn:listing:SOL/AUD",
          fetchedAtMs: NOW,
          payloadSha256: digest("l"),
        },
        announcement: {
          canonicalPair: "SOL/AUD",
          eventType: "listed",
          effectiveAtMs: NOW - 100,
          publishedAtMs: NOW - 50,
        },
      },
    ],
  };
  await assert.rejects(
    runKrakenScheduledUniverseIngestion(invalid, {
      client: {
        ...client(),
        async fetchAssetPairs() {
          fetched = true;
          return client().fetchAssetPairs();
        },
      },
      repository: {
        persistBatch: async () => {
          throw new Error("unexpected persistence");
        },
      },
      clock: () => NOW + 10,
    }),
    /outside canonicalPairs/,
  );
  assert.equal(fetched, false);
});
