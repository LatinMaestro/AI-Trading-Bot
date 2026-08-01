import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";

test("live mode remains disabled without explicit enablement", () => {
  const config = loadConfig({
    APP_ENV: "test",
    TRADING_MODE: "live",
    LIVE_TRADING_ENABLED: "false",
    APPROVED_PAIRS: "XBTAUD",
    MAX_GROSS_EXPOSURE_PCT: "90",
    DAILY_LOSS_LIMIT_PCT: "5",
    WEEKLY_LOSS_LIMIT_PCT: "10",
    MAX_DRAWDOWN_PCT: "15",
    LIVE_ACTIVATION_SHA256: "",
  });
  assert.equal(config.mode, "live");
  assert.equal(config.liveTradingEnabled, false);
  assert.equal(config.liveActivationSha256, "");
});
