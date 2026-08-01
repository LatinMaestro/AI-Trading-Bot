import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareUniverseIngestionBatch,
  resolveAudValuationPath,
  summariseUniverseCalibration,
  type UniverseCalibrationSample,
  type UniverseIngestionInput,
} from "../src/universe/ingestion.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 6, 26, 12);
const digest = (value: string) => value.repeat(64).slice(0, 64);

function input(markets: UniverseIngestionInput["markets"]): UniverseIngestionInput {
  return {
    venue: "kraken",
    recordedAtMs: NOW,
    maximumAudQuoteAgeMs: HOUR,
    metadataSource: {
      sourceId: "asset-pairs-1",
      sourceKind: "venue-metadata",
      sourceRef: "kraken:asset-pairs",
      fetchedAtMs: NOW,
      payloadSha256: digest("a"),
    },
    qualitySource: {
      sourceId: "quality-1",
      sourceKind: "venue-market-quality",
      sourceRef: "kraken:market-quality",
      fetchedAtMs: NOW,
      payloadSha256: digest("b"),
    },
    conversionQuotes: [
      {
        baseAsset: "USDT",
        quoteAsset: "AUD",
        rate: 1.5,
        observedAtMs: NOW - 2_000,
        availableAtMs: NOW - 1_500,
        payloadSha256: digest("c"),
      },
    ],
    markets,
    lifecycleAnnouncements: [
      {
        source: {
          sourceId: "listing-1",
          sourceKind: "official-lifecycle-announcement",
          sourceRef: "kraken:announcement:listing",
          fetchedAtMs: NOW - 100,
          payloadSha256: digest("d"),
        },
        announcement: {
          canonicalPair: "NEW/USDT",
          eventType: "listed",
          effectiveAtMs: NOW - 10_000,
          publishedAtMs: NOW - 5_000,
        },
      },
    ],
  };
}

const market = {
  canonicalPair: "NEW/USDT",
  exchangePair: "NEWUSDT",
  baseAsset: "NEW",
  quoteAsset: "USDT",
  instrumentKind: "spot" as const,
  observedAtMs: NOW - 1_000,
  availableAtMs: NOW - 500,
  spreadBps: 50,
  quoteTurnover24h: 1_000,
  availableQuoteVolume: 200,
  estimatedImpactBps: 20,
  minimumOrderQuote: 5,
  dailyCommittedCandles: 10,
  hourlyCommittedCandles: 100,
  annualisedVolatility: 2,
  dataQualityState: "complete" as const,
};

test("resolves direct and indirect AUD paths", () => {
  const direct = resolveAudValuationPath("AUD", [], NOW, HOUR);
  assert.equal(direct.rateToAud, 1);
  const indirect = resolveAudValuationPath(
    "USD",
    [
      {
        baseAsset: "USD",
        quoteAsset: "USDT",
        rate: 1,
        observedAtMs: NOW,
        availableAtMs: NOW,
        payloadSha256: digest("a"),
      },
      {
        baseAsset: "USDT",
        quoteAsset: "AUD",
        rate: 1.5,
        observedAtMs: NOW,
        availableAtMs: NOW,
        payloadSha256: digest("b"),
      },
    ],
    NOW,
    HOUR,
  );
  assert.equal(indirect.rateToAud, 1.5);
  assert.deepEqual(indirect.assets, ["USD", "USDT", "AUD"]);
});

test("stale, missing and ambiguous AUD paths fail closed", () => {
  assert.throws(
    () =>
      resolveAudValuationPath(
        "USDT",
        [
          {
            baseAsset: "USDT",
            quoteAsset: "AUD",
            rate: 1.5,
            observedAtMs: NOW - 2 * HOUR,
            availableAtMs: NOW - HOUR,
            payloadSha256: digest("a"),
          },
        ],
        NOW,
        HOUR,
      ),
    /No fresh AUD valuation path/,
  );
  assert.throws(() => resolveAudValuationPath("USD", [], NOW, HOUR), /No fresh/);
  assert.throws(
    () =>
      resolveAudValuationPath(
        "USD",
        [
          {
            baseAsset: "USD",
            quoteAsset: "AUD",
            rate: 1.5,
            observedAtMs: NOW,
            availableAtMs: NOW,
            payloadSha256: digest("a"),
          },
          {
            baseAsset: "USD",
            quoteAsset: "AUD",
            rate: 1.6,
            observedAtMs: NOW - 1,
            availableAtMs: NOW,
            payloadSha256: digest("b"),
          },
        ],
        NOW,
        HOUR,
      ),
    /Ambiguous AUD valuation paths/,
  );
});

test("ingestion is deterministic and converts quote metrics to AUD", async () => {
  const first = await prepareUniverseIngestionBatch(input([market]));
  const second = await prepareUniverseIngestionBatch(input([market]));
  assert.deepEqual(first, second);
  assert.match(first.batchSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.observations[0]?.quoteTurnoverAud24h, 1_500);
  assert.equal(first.observations[0]?.availableQuoteVolumeAud, 300);
  assert.equal(first.observations[0]?.minimumOrderAud, 7.5);
  assert.equal(first.definitions[0]?.availableAtMs, NOW);
  assert.equal(first.observations[0]?.availableAtMs, NOW);
  assert.equal(first.lifecycleEvents[0]?.eventType, "listed");
  assert.equal(first.sourceDigests.length, 4);
});

test("future-effective lifecycle announcements remain knowable but not yet effective", async () => {
  const future = input([market]);
  const announcements = future.lifecycleAnnouncements;
  if (announcements === undefined || announcements[0] === undefined) {
    throw new Error("Missing fixture");
  }
  const batch = await prepareUniverseIngestionBatch({
    ...future,
    lifecycleAnnouncements: [
      {
        ...announcements[0],
        announcement: {
          ...announcements[0].announcement,
          effectiveAtMs: NOW + HOUR,
        },
      },
    ],
  });
  assert.equal(batch.lifecycleEvents[0]?.effectiveAtMs, NOW + HOUR);
  assert.ok((batch.lifecycleEvents[0]?.publishedAtMs ?? 0) <= NOW);
});

test("invalid identity and conversion chronology fail closed", async () => {
  await assert.rejects(
    prepareUniverseIngestionBatch(
      input([{ ...market, canonicalPair: "WRONG/AUD" }]),
    ),
    /canonicalPair/,
  );
  assert.throws(
    () =>
      resolveAudValuationPath(
        "USD",
        [
          {
            baseAsset: "USD",
            quoteAsset: "AUD",
            rate: 1.5,
            observedAtMs: NOW,
            availableAtMs: NOW - 1,
            payloadSha256: digest("a"),
          },
        ],
        NOW,
        HOUR,
      ),
    /available before observation/,
  );
  assert.throws(
    () =>
      resolveAudValuationPath(
        "USD",
        [
          {
            baseAsset: "USD",
            quoteAsset: "AUD",
            rate: Number.MIN_VALUE,
            observedAtMs: NOW,
            availableAtMs: NOW,
            payloadSha256: digest("a"),
          },
        ],
        NOW,
        HOUR,
      ),
    /reciprocal rate/,
  );
});

test("lifecycle events require explicit official evidence", async () => {
  const invalid = input([market]);
  const announcements = invalid.lifecycleAnnouncements;
  if (announcements === undefined) throw new Error("Missing fixture");
  const first = announcements[0];
  if (first === undefined) throw new Error("Missing announcement fixture");
  await assert.rejects(
    prepareUniverseIngestionBatch({
      ...invalid,
      lifecycleAnnouncements: [
        {
          ...first,
          source: { ...first.source, sourceKind: "venue-metadata" },
        },
      ],
    }),
    /official-lifecycle-announcement/,
  );
});

test("calibration summaries are deterministic and enforce evidence minimums", async () => {
  const samples: UniverseCalibrationSample[] = [1, 2, 3, 4].map((value) => ({
    venue: "kraken",
    canonicalPair: value % 2 === 0 ? "BTC/AUD" : "ETH/AUD",
    tier: "established",
    observedAtMs: NOW + value,
    equityAud: 200 * value,
    spreadBps: value * 10,
    quoteTurnoverAud24h: value * 1_000,
    availableQuoteVolumeAud: value * 100,
    estimatedImpactBps: value * 5,
    payloadSha256: String(value).repeat(64),
  }));
  const first = await summariseUniverseCalibration("established", samples, 4);
  const second = await summariseUniverseCalibration(
    "established",
    [...samples].reverse(),
    4,
  );
  assert.deepEqual(first, second);
  assert.equal(first.sampleCount, 4);
  assert.equal(first.venue, "kraken");
  assert.equal(first.distinctPairCount, 2);
  assert.equal(first.spreadBps.p50, 25);
  assert.match(first.evidenceSha256, /^[0-9a-f]{64}$/);
  await assert.rejects(
    summariseUniverseCalibration("established", samples, 5),
    /at least 5 samples/,
  );
  await assert.rejects(
    summariseUniverseCalibration(
      "established",
      [...samples, { ...samples[0]!, venue: "other", payloadSha256: digest("a") }],
      5,
    ),
    /cannot mix venues/,
  );
  await assert.rejects(
    summariseUniverseCalibration(
      "established",
      [...samples, { ...samples[0]!, spreadBps: 999, payloadSha256: digest("f") }],
      5,
    ),
    /Conflicting calibration sample/,
  );
});
