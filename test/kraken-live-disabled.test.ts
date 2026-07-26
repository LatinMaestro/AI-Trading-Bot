import assert from "node:assert/strict";
import test from "node:test";
import { KrakenSpotAdapter } from "../src/exchanges/kraken.ts";

const intent = {
  pair: "XBTAUD",
  side: "buy",
  priceAud: 100_000,
  volume: 0.0001,
  notionalAud: 10,
  postOnly: true,
} as const;

test("Kraken adapter rejects executable orders in Phase 0", async () => {
  const adapter = new KrakenSpotAdapter();
  await assert.rejects(
    () => adapter.submitPostOnlyLimit(intent, false),
    /permits Kraken order validation only/,
  );
});
