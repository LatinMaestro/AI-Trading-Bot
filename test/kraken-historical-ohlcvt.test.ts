import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKrakenHistoricalOhlcvtSourceManifest,
  KRAKEN_HISTORICAL_OHLCVT_SOURCE,
} from "../src/marketData/krakenHistoricalOhlcvt.ts";

test("binds the exact official Kraken historical OHLCVT source", async () => {
  const first = await buildKrakenHistoricalOhlcvtSourceManifest();
  const second = await buildKrakenHistoricalOhlcvtSourceManifest();

  assert.deepEqual(first, second);
  assert.match(first.contractSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    first.contract.supportPageUrl,
    "https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data",
  );
  assert.equal(
    first.contract.completeArchiveUrl,
    "https://drive.google.com/file/d/1ptNqWYidLkhb2VAKuLCxmp2OXEfGO-AP/view?usp=sharing",
  );
  assert.equal(
    first.contract.incrementalArchiveFolderUrl,
    "https://drive.google.com/drive/folders/15RSlNuW_h0kVM8or8McOGOMfHeBFvFGI?usp=sharing",
  );
});

test("keeps historical data research-only and non-fabricating", () => {
  assert.deepEqual(KRAKEN_HISTORICAL_OHLCVT_SOURCE.approvedPairs, [
    "BTC/AUD",
    "ETH/AUD",
  ]);
  assert.deepEqual(
    KRAKEN_HISTORICAL_OHLCVT_SOURCE.approvedIntervalsMinutes,
    [60, 1440],
  );
  assert.equal(
    KRAKEN_HISTORICAL_OHLCVT_SOURCE.emptyIntervalPolicy,
    "preserve-absence-never-forward-fill",
  );
  assert.equal(
    KRAKEN_HISTORICAL_OHLCVT_SOURCE.rawArchiveRetention,
    "transient-validation-only",
  );
  assert.equal(KRAKEN_HISTORICAL_OHLCVT_SOURCE.liveDecisionUse, false);
  assert.equal(
    KRAKEN_HISTORICAL_OHLCVT_SOURCE.modelTrainingPermitted,
    false,
  );
});
