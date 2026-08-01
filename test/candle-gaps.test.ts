import assert from "node:assert/strict";
import test from "node:test";
import { DAY_MS, HOUR_MS } from "../src/marketData/candleIntervals.ts";
import { findCandleGaps, planKrakenRestGapRepair } from "../src/marketData/gaps.ts";

test("gap detection finds leading, internal and trailing gaps", () => {
  const start = Date.UTC(2026, 0, 1);
  const timestamps = [start + DAY_MS, start + 2 * DAY_MS, start + 4 * DAY_MS];
  assert.deepEqual(findCandleGaps(timestamps, 1440, start, start + 5 * DAY_MS), [
    { startOpenTimeMs: start, endOpenTimeMs: start, missingCount: 1 },
    {
      startOpenTimeMs: start + 3 * DAY_MS,
      endOpenTimeMs: start + 3 * DAY_MS,
      missingCount: 1,
    },
    {
      startOpenTimeMs: start + 5 * DAY_MS,
      endOpenTimeMs: start + 5 * DAY_MS,
      missingCount: 1,
    },
  ]);
});

test("gap detection fails closed for duplicate or misaligned timestamps", () => {
  const start = Date.UTC(2026, 0, 1);
  assert.throws(
    () => findCandleGaps([start, start], 1440, start, start + DAY_MS),
    /unique and strictly ordered/,
  );
  assert.throws(
    () => findCandleGaps([start + 1], 1440, start, start + DAY_MS),
    /aligned/,
  );
});

test("Kraken repair planning identifies gaps outside the REST retention horizon", () => {
  const currentOpen = Date.UTC(2026, 6, 26, 12);
  const oldGap = {
    startOpenTimeMs: currentOpen - 800 * HOUR_MS,
    endOpenTimeMs: currentOpen - 790 * HOUR_MS,
    missingCount: 11,
  };
  const crossingGap = {
    startOpenTimeMs: currentOpen - 721 * HOUR_MS,
    endOpenTimeMs: currentOpen - 717 * HOUR_MS,
    missingCount: 5,
  };
  const recentGap = {
    startOpenTimeMs: currentOpen - 10 * HOUR_MS,
    endOpenTimeMs: currentOpen - 8 * HOUR_MS,
    missingCount: 3,
  };
  const plan = planKrakenRestGapRepair([oldGap, crossingGap, recentGap], 60, currentOpen);
  assert.deepEqual(plan.unavailableFromRest, [
    oldGap,
    {
      startOpenTimeMs: currentOpen - 721 * HOUR_MS,
      endOpenTimeMs: currentOpen - 720 * HOUR_MS,
      missingCount: 2,
    },
  ]);
  assert.deepEqual(plan.repairable, [
    {
      startOpenTimeMs: currentOpen - 719 * HOUR_MS,
      endOpenTimeMs: currentOpen - 717 * HOUR_MS,
      missingCount: 3,
    },
    recentGap,
  ]);
  assert.equal(plan.earliestRestOpenTimeMs, currentOpen - 719 * HOUR_MS);
});

test("Kraken repair planning rejects current or future intervals", () => {
  const currentOpen = Date.UTC(2026, 6, 26, 12);
  assert.throws(
    () =>
      planKrakenRestGapRepair(
        [
          {
            startOpenTimeMs: currentOpen,
            endOpenTimeMs: currentOpen,
            missingCount: 1,
          },
        ],
        60,
        currentOpen,
      ),
    /committed intervals only/,
  );
});
