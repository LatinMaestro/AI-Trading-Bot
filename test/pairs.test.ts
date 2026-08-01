import assert from "node:assert/strict";
import test from "node:test";
import {
  parseKrakenSpotPairs,
  selectApprovedAudPairs,
} from "../src/marketData/pairs.ts";

const payload = {
  "BTC/AUD": {
    altname: "XBTAUD",
    wsname: "XBT/AUD",
    base: "BTC",
    quote: "AUD",
    pair_decimals: 1,
    lot_decimals: 8,
    ordermin: "0.0001",
    costmin: "5",
    tick_size: "0.1",
    status: "online",
  },
  "ETH/AUD": {
    altname: "ETHAUD",
    wsname: "ETH/AUD",
    base: "ETH",
    quote: "AUD",
    pair_decimals: 2,
    lot_decimals: 8,
    ordermin: "0.001",
    costmin: "5",
    tick_size: "0.01",
    status: "online",
  },
  "BTC/USD": {
    altname: "XBTUSD",
    wsname: "XBT/USD",
    base: "BTC",
    quote: "USD",
    pair_decimals: 1,
    lot_decimals: 8,
    ordermin: "0.0001",
    costmin: "0.5",
    tick_size: "0.1",
    status: "online",
  },
};

test("Kraken pair payload is converted to canonical and exchange symbols", () => {
  const pairs = parseKrakenSpotPairs(payload);
  const bitcoinAud = pairs.find((pair) => pair.canonicalSymbol === "BTC/AUD");
  assert.equal(bitcoinAud?.exchangeSymbol, "XBTAUD");
  assert.equal(bitcoinAud?.minimumOrderCostQuote, 5);
});

test("approved AUD pairs retain configured order after normalisation", () => {
  const selected = selectApprovedAudPairs(parseKrakenSpotPairs(payload), [
    "ETH/AUD",
    "XBTAUD",
  ]);
  assert.deepEqual(
    selected.map((pair) => pair.canonicalSymbol),
    ["ETH/AUD", "BTC/AUD"],
  );
});

test("missing approved pair fails closed", () => {
  assert.throws(
    () => selectApprovedAudPairs(parseKrakenSpotPairs(payload), ["SOL/AUD"]),
    /not available/,
  );
});

test("offline approved pair fails closed", () => {
  const offlinePayload = {
    ...payload,
    "ETH/AUD": { ...payload["ETH/AUD"], status: "cancel_only" },
  };
  assert.throws(
    () => selectApprovedAudPairs(parseKrakenSpotPairs(offlinePayload), ["ETH/AUD"]),
    /not online/,
  );
});

test("duplicate canonical pairs fail closed", () => {
  const pairs = parseKrakenSpotPairs(payload);
  const bitcoin = pairs.find((pair) => pair.canonicalSymbol === "BTC/AUD");
  assert.ok(bitcoin);
  assert.throws(
    () => selectApprovedAudPairs([...pairs, bitcoin], ["BTC/AUD"]),
    /duplicate pair/,
  );
});
