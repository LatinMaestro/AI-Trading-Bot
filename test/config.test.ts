import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";

function env(approvedPairs: string): Env {
  return {
    APP_ENV: "test",
    TRADING_MODE: "paper",
    LIVE_TRADING_ENABLED: "false",
    APPROVED_PAIRS: approvedPairs,
    MAX_GROSS_EXPOSURE_PCT: "90",
    DAILY_LOSS_LIMIT_PCT: "5",
    WEEKLY_LOSS_LIMIT_PCT: "10",
    MAX_DRAWDOWN_PCT: "15",
    LIVE_ACTIVATION_SHA256: "",
  } as Env;
}

test("configured Kraken aliases become canonical AUD symbols", () => {
  assert.deepEqual(loadConfig(env("XBTAUD, eth/aud")).approvedPairs, [
    "BTC/AUD",
    "ETH/AUD",
  ]);
});

test("duplicate pairs after normalisation fail closed", () => {
  assert.throws(
    () => loadConfig(env("XBTAUD,BTC/AUD")),
    /duplicates after normalisation/,
  );
});
