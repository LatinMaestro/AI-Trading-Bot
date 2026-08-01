import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAudPairSymbol } from "../src/marketData/symbols.ts";

test("AUD pair symbols normalise to canonical display names", () => {
  assert.equal(normalizeAudPairSymbol("XBTAUD"), "BTC/AUD");
  assert.equal(normalizeAudPairSymbol("btc/aud"), "BTC/AUD");
  assert.equal(normalizeAudPairSymbol("ETH-AUD"), "ETH/AUD");
});

test("non-AUD pairs are rejected", () => {
  assert.throws(() => normalizeAudPairSymbol("BTC/USD"), /must be an AUD spot pair/);
});
