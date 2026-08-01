import assert from "node:assert/strict";
import test from "node:test";
import { KrakenPublicMarketClient } from "../src/exchanges/krakenPublic.ts";
import {
  parseKrakenOrderBook,
  parseKrakenTickers,
  summariseKrakenMarketQuality,
} from "../src/marketData/krakenQuality.ts";

const tickerPayload = {
  "ETH/AUD": {
    a: ["51", "1", "1"],
    b: ["49", "1", "1"],
    c: ["50", "1"],
    v: ["10", "20"],
    p: ["48", "50"],
  },
  "BTC/AUD": {
    a: ["101", "1", "1"],
    b: ["99", "1", "1"],
    c: ["100", "1"],
    v: ["2", "4"],
    p: ["98", "100"],
  },
};

const depthPayload = {
  "BTC/AUD": {
    asks: [
      ["101", "2", 1_700_000_000],
      ["102", "3", 1_700_000_001],
    ],
    bids: [
      ["99", "2", 1_700_000_002],
      ["98", "3", 1_700_000_003],
    ],
  },
};

test("ticker parsing is deterministic and derives quote turnover", () => {
  const tickers = parseKrakenTickers(tickerPayload);
  assert.deepEqual(
    tickers.map((ticker) => ticker.canonicalPair),
    ["BTC/AUD", "ETH/AUD"],
  );
  assert.equal(tickers[0]?.quoteTurnover24h, 400);
  assert.equal(tickers[1]?.quoteTurnover24h, 1_000);
});

test("ticker parsing rejects malformed and crossed markets", () => {
  assert.throws(
    () =>
      parseKrakenTickers({
        "BTC/AUD": { ...tickerPayload["BTC/AUD"], a: ["98"] },
      }),
    /crossed market/,
  );
  assert.throws(
    () =>
      parseKrakenTickers({
        "BTC/AUD": { ...tickerPayload["BTC/AUD"], v: ["2"] },
      }),
    /invalid v/,
  );
  assert.throws(
    () => parseKrakenTickers({ XBTAUD: tickerPayload["BTC/AUD"] }),
    /assetVersion=1/,
  );
  assert.throws(
    () =>
      parseKrakenTickers({
        "BTC/AUD": { ...tickerPayload["BTC/AUD"], a: [true] },
      }),
    /must be numeric text or a number/,
  );
});

test("order-book parsing and market-quality impact are fail closed", () => {
  const ticker = parseKrakenTickers({
    "BTC/AUD": tickerPayload["BTC/AUD"],
  })[0];
  if (ticker === undefined) throw new Error("Missing ticker fixture");
  const book = parseKrakenOrderBook(depthPayload);
  const summary = summariseKrakenMarketQuality(ticker, book, 100);

  assert.equal(summary.spreadBps, 200);
  assert.equal(summary.availableQuoteVolume, 492);
  assert.ok(summary.estimatedImpactBps !== null);
  assert.ok(Math.abs(summary.estimatedImpactBps - 100) < 1e-9);
  assert.equal(
    summariseKrakenMarketQuality(ticker, book, 1_000).estimatedImpactBps,
    null,
  );
});

test("order-book parsing rejects unordered, crossed and multi-pair data", () => {
  assert.throws(
    () =>
      parseKrakenOrderBook({
        "BTC/AUD": {
          ...depthPayload["BTC/AUD"],
          asks: [
            ["102", "1", 1],
            ["101", "1", 2],
          ],
        },
      }),
    /not strictly sorted/,
  );
  assert.throws(
    () =>
      parseKrakenOrderBook({
        "BTC/AUD": {
          asks: [["98", "1", 1]],
          bids: [["99", "1", 1]],
        },
      }),
    /crossed or incomplete/,
  );
  assert.throws(
    () =>
      parseKrakenOrderBook({
        ...depthPayload,
        "ETH/AUD": depthPayload["BTC/AUD"],
      }),
    /exactly one pair/,
  );
});

test("public client requests official assetVersion=1 contracts and hashes payloads", async () => {
  const requests: URL[] = [];
  const requestOptions: RequestInit[] = [];
  const fetcher = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input.toString());
    requests.push(url);
    requestOptions.push(init ?? {});
    let result: unknown;
    if (url.pathname.endsWith("/AssetPairs")) {
      result = {
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
      };
    } else if (url.pathname.endsWith("/Ticker")) {
      result = { "BTC/AUD": tickerPayload["BTC/AUD"] };
    } else {
      result = depthPayload;
    }
    return new Response(JSON.stringify({ error: [], result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const now = 1_800_000_000_000;
  const client = new KrakenPublicMarketClient(fetcher, () => now);

  const pairs = await client.fetchAssetPairs("au");
  const tickers = await client.fetchTickers(["BTC/AUD"]);
  const book = await client.fetchOrderBook("BTC/AUD", 2);

  assert.equal(pairs.data[0]?.canonicalSymbol, "BTC/AUD");
  assert.equal(tickers.data[0]?.canonicalPair, "BTC/AUD");
  assert.equal(book.data.asks.length, 2);
  assert.match(pairs.payloadSha256, /^[0-9a-f]{64}$/);
  assert.match(tickers.sourceId, /^kraken:ticker:1800000000000:/);

  assert.equal(requests[0]?.searchParams.get("assetVersion"), "1");
  assert.equal(requests[0]?.searchParams.get("country_code"), "AU");
  assert.equal(requests[1]?.searchParams.get("pair"), "BTC/AUD");
  assert.equal(requests[2]?.searchParams.get("count"), "2");
  assert.ok(requests.every((url) => url.origin === "https://api.kraken.com"));
  assert.ok(requestOptions.every((options) => options.redirect === "error"));
});

test("public client rejects incomplete responses and invalid depth limits", async () => {
  const client = new KrakenPublicMarketClient(
    async () =>
      new Response(
        JSON.stringify({
          error: [],
          result: { "BTC/AUD": tickerPayload["BTC/AUD"] },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    () => 1,
  );
  await assert.rejects(
    client.fetchTickers(["BTC/AUD", "ETH/AUD"]),
    /did not return exactly the requested pairs/,
  );
  await assert.rejects(client.fetchOrderBook("BTC/AUD", 501), /1 to 500/);

  const invalidMediaType = new KrakenPublicMarketClient(
    async () => new Response("{}", { headers: { "Content-Type": "text/html" } }),
    () => 1,
  );
  await assert.rejects(
    invalidMediaType.fetchTickers(["BTC/AUD"]),
    /invalid media type/,
  );
});
