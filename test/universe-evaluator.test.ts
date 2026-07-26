import assert from "node:assert/strict";
import test from "node:test";
import { evaluateUniverseAt } from "../src/universe/evaluator.ts";
import type {
  MarketMembershipRecord,
  UniverseObservation,
  UniversePolicy,
} from "../src/universe/types.ts";

const NOW = Date.UTC(2026, 6, 26);
const DAY_MS = 86_400_000;
const policy: UniversePolicy = {
  establishedMinimumDailyCandles: 220,
  establishedMinimumHourlyCandles: 720,
  newListingMaximumAgeDays: 30,
  highVolatilityThreshold: 1.5,
  maximumSpreadBps: 100,
  minimumQuoteTurnoverAud: 100_000,
  minimumAvailableQuoteVolumeAud: 10_000,
  maximumEstimatedImpactBps: 100,
  maximumMinimumOrderShareOfEquity: 0.1,
};

function membership(
  pair: string,
  overrides: Partial<MarketMembershipRecord> = {},
): MarketMembershipRecord {
  return {
    venue: "test",
    canonicalPair: pair,
    availableInAustralia: true,
    instrumentType: "spot",
    status: "online",
    effectiveFromMs: NOW - 400 * DAY_MS,
    listingTimestampMs: NOW - 400 * DAY_MS,
    quoteAsset: "AUD",
    ...overrides,
  };
}

function observation(
  pair: string,
  overrides: Partial<UniverseObservation> = {},
): UniverseObservation {
  return {
    timestampMs: NOW,
    canonicalPair: pair,
    committedDailyCandles: 300,
    committedHourlyCandles: 1_000,
    annualisedVolatility: 1,
    spreadBps: 20,
    quoteTurnoverAud: 1_000_000,
    availableQuoteVolumeAud: 100_000,
    minimumOrderAud: 1,
    estimatedImpactBps: 10,
    hasAudValuationPath: true,
    dataComplete: true,
    ...overrides,
  };
}

test("classifies established, high-volatility and new-listing tiers", () => {
  const results = evaluateUniverseAt(
    [
      observation("A/AUD"),
      observation("B/AUD", { annualisedVolatility: 2 }),
      observation("C/AUD", { committedDailyCandles: 10, committedHourlyCandles: 100 }),
    ],
    [
      membership("A/AUD"),
      membership("B/AUD"),
      membership("C/AUD", { listingTimestampMs: NOW - 10 * DAY_MS }),
    ],
    policy,
    200,
  );
  assert.deepEqual(results.map((result) => result.tier), [
    "established",
    "high-volatility",
    "new-listing",
  ]);
  assert.ok(results.every((result) => result.eligible));
});

test("uses time-appropriate membership and excludes suspended or delisted markets", () => {
  const result = evaluateUniverseAt(
    [observation("A/AUD")],
    [membership("A/AUD", { status: "suspended" })],
    policy,
    200,
  )[0];
  assert.equal(result?.eligible, false);
  assert.deepEqual(result?.reasons, ["market-suspended"]);
});

test("rejects non-spot instruments and weak market structure", () => {
  const result = evaluateUniverseAt(
    [
      observation("LEV/AUD", {
        spreadBps: 200,
        quoteTurnoverAud: 1,
        availableQuoteVolumeAud: 1,
        estimatedImpactBps: 200,
        minimumOrderAud: 50,
        hasAudValuationPath: false,
        dataComplete: false,
      }),
    ],
    [membership("LEV/AUD", { instrumentType: "leveraged-token" })],
    policy,
    200,
  )[0];
  assert.equal(result?.eligible, false);
  assert.ok(result?.reasons.includes("non-spot-instrument"));
  assert.ok(result?.reasons.includes("minimum-order-too-large"));
  assert.ok(result?.reasons.includes("impact-too-high"));
});

test("fails closed for overlapping membership, duplicate observations and pre-listing data", () => {
  assert.throws(
    () =>
      evaluateUniverseAt(
        [observation("A/AUD")],
        [membership("A/AUD"), membership("A/AUD")],
        policy,
        200,
      ),
    /exactly one active membership/,
  );
  assert.throws(
    () =>
      evaluateUniverseAt(
        [observation("A/AUD"), observation("A/AUD")],
        [membership("A/AUD")],
        policy,
        200,
      ),
    /Duplicate observation/,
  );
  assert.throws(
    () =>
      evaluateUniverseAt(
        [observation("A/AUD")],
        [membership("A/AUD", { listingTimestampMs: NOW + DAY_MS })],
        policy,
        200,
      ),
    /predates listing/,
  );
});
