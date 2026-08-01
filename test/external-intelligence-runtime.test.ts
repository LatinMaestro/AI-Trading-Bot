import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeExternalIntelligenceQueue,
  EXTERNAL_INTELLIGENCE_MINUTE_CRON,
  EXTERNAL_INTELLIGENCE_QUEUE_NAME,
  runExternalIntelligenceMinuteCycle,
  scheduledWorkKind,
  TRADING_CYCLE_CRON,
  type ExternalIntelligenceRuntimeDependencies,
} from "../src/intelligence/externalIntelligenceRuntime.ts";
import type { ExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";

const SLOT = Date.parse("2026-07-28T13:00:00.000Z");
const contract: ExternalIntelligenceSourceContract = {
  sourceId: "kraken-status-active-maintenance",
  contractVersion: 1,
  sourceKind: "official-exchange",
  authority: "authoritative",
  publisherId: "kraken-status",
  providerId: "kraken-statuspage",
  sourceOrigin: "https://status.kraken.com/",
  allowedAcquisitionModes: ["minute-poll"],
  contentPolicy: "digest-only",
  licenceRef: "https://status.kraken.com/api",
  licenceSha256: "a".repeat(64),
  attributionRequired: false,
  maximumRetentionMs: null,
  deletionHandling: "not-applicable",
  modelTrainingAllowed: false,
  approvedAtMs: 1_000,
  effectiveFromMs: 1_000,
  expiresAtMs: null,
  enabled: true,
  sourceContractSha256: "b".repeat(64),
};

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_ENV: "paper",
    TRADING_MODE: "paper",
    LIVE_TRADING_ENABLED: "false",
    APPROVED_PAIRS: "BTC/AUD,ETH/AUD",
    MAX_GROSS_EXPOSURE_PCT: "90",
    DAILY_LOSS_LIMIT_PCT: "5",
    WEEKLY_LOSS_LIMIT_PCT: "10",
    MAX_DRAWDOWN_PCT: "15",
    LIVE_ACTIVATION_SHA256: "",
    EXTERNAL_INTELLIGENCE_ENABLED: "false",
    KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON: "",
    DB: {} as D1Database,
    EXTERNAL_INTELLIGENCE_QUEUE: {} as Queue<unknown>,
    ...overrides,
  };
}

function runtimeEnv(overrides: Readonly<Record<string, unknown>>): Env {
  const result = env();
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(result, key, {
      value,
      configurable: true,
      enumerable: true,
    });
  }
  return result;
}

function dependencies(
  overrides: Partial<ExternalIntelligenceRuntimeDependencies> = {},
): ExternalIntelligenceRuntimeDependencies {
  return {
    createMinuteSource: async (sourceContract) => ({
      contract: sourceContract,
      target: {
        sourceId: sourceContract.sourceId,
        sourceRef:
          "https://status.kraken.com/api/v2/scheduled-maintenances/active.json",
        acquisitionMode: "minute-poll",
        acceptedContentTypes: ["application/json"],
      },
      normaliseCapture: async () => null,
    }),
    runCollector: async (_sources, _queue, _cache, options) => ({
      scheduledAtMs: options.scheduledAtMs,
      completedAtMs: options.scheduledAtMs + 1_000,
      outcomes: [],
    }),
    processQueueBatch: async () => [],
    createCacheState: () => ({
      load: async () => undefined,
      save: async () => undefined,
    }),
    createRepository: () => ({
      persistBatch: async () => {
        throw new Error("unexpected persistence");
      },
    }),
    fetchImpl: fetch,
    nowMs: () => SLOT + 1_000,
    ...overrides,
  };
}

test("routes only the two declared scheduled triggers", () => {
  assert.equal(
    scheduledWorkKind(EXTERNAL_INTELLIGENCE_MINUTE_CRON),
    "external-intelligence-minute",
  );
  assert.equal(scheduledWorkKind(TRADING_CYCLE_CRON), "trading-cycle");
  assert.throws(() => scheduledWorkKind("0 * * * *"), /Unrecognised/u);
});

test("remains fail-closed and side-effect free while disabled", async () => {
  let touched = false;
  const result = await runExternalIntelligenceMinuteCycle(
    env(),
    SLOT,
    dependencies({
      createMinuteSource: async () => {
        touched = true;
        throw new Error("must not create a source");
      },
      createCacheState: () => {
        touched = true;
        throw new Error("must not create cache state");
      },
    }),
  );
  assert.deepEqual(result, {
    status: "disabled",
    scheduledAtMs: SLOT,
    sourceCount: 0,
  });
  assert.equal(touched, false);
});

test("rejects ambiguous activation, non-paper authority and missing contract", async () => {
  await assert.rejects(
    runExternalIntelligenceMinuteCycle(
      runtimeEnv({ EXTERNAL_INTELLIGENCE_ENABLED: "TRUE" }),
      SLOT,
      dependencies(),
    ),
    /exactly true or false/u,
  );
  await assert.rejects(
    runExternalIntelligenceMinuteCycle(
      runtimeEnv({
        APP_ENV: "preview",
        EXTERNAL_INTELLIGENCE_ENABLED: "true",
      }),
      SLOT,
      dependencies(),
    ),
    /restricted to fail-closed paper mode/u,
  );
  await assert.rejects(
    runExternalIntelligenceMinuteCycle(
      runtimeEnv({ EXTERNAL_INTELLIGENCE_ENABLED: "true" }),
      SLOT,
      dependencies(),
    ),
    /must contain one bounded contract/u,
  );
  const missingQueue = runtimeEnv({
    EXTERNAL_INTELLIGENCE_ENABLED: "true",
    KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON: JSON.stringify(contract),
    EXTERNAL_INTELLIGENCE_QUEUE: undefined,
  });
  await assert.rejects(
    runExternalIntelligenceMinuteCycle(
      missingQueue,
      SLOT,
      dependencies(),
    ),
    /binding is unavailable/u,
  );
});

test("binds an enabled minute source to Queue and D1 dependencies", async () => {
  const db = {} as D1Database;
  let createdContract: ExternalIntelligenceSourceContract | undefined;
  let sourceCount = 0;
  let cacheDb: D1Database | undefined;
  const result = await runExternalIntelligenceMinuteCycle(
    runtimeEnv({
      EXTERNAL_INTELLIGENCE_ENABLED: "true",
      KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON: JSON.stringify(contract),
      DB: db,
    }),
    SLOT,
    dependencies({
      createMinuteSource: async (value) => {
        createdContract = value;
        return {
          contract: value,
          target: {
            sourceId: value.sourceId,
            sourceRef:
              "https://status.kraken.com/api/v2/scheduled-maintenances/active.json",
            acquisitionMode: "minute-poll",
            acceptedContentTypes: ["application/json"],
          },
          normaliseCapture: async () => null,
        };
      },
      createCacheState: (value) => {
        cacheDb = value;
        return {
          load: async () => undefined,
          save: async () => undefined,
        };
      },
      runCollector: async (sources, _queue, _cache, options) => {
        sourceCount = sources.length;
        return {
          scheduledAtMs: options.scheduledAtMs,
          completedAtMs: SLOT + 1_000,
          outcomes: [],
        };
      },
    }),
  );
  assert.deepEqual(createdContract, contract);
  assert.equal(sourceCount, 1);
  assert.equal(cacheDb, db);
  assert.equal(result.scheduledAtMs, SLOT);
});

test("consumes only the paper queue through the D1 repository", async () => {
  const db = {} as D1Database;
  const batch = {
    queue: EXTERNAL_INTELLIGENCE_QUEUE_NAME,
    messages: [],
    metadata: {
      metrics: { backlogCount: 0, backlogBytes: 0 },
    },
    ackAll() {},
    retryAll() {},
  } satisfies MessageBatch<unknown>;
  let repositoryDb: D1Database | undefined;
  let seenDeliveries = -1;
  const result = await consumeExternalIntelligenceQueue(
    batch,
    env({ DB: db }),
    dependencies({
      createRepository: (value) => {
        repositoryDb = value;
        return {
          persistBatch: async () => {
            throw new Error("unexpected persistence");
          },
        };
      },
      processQueueBatch: async (deliveries) => {
        seenDeliveries = deliveries.length;
        return [];
      },
    }),
  );
  assert.deepEqual(result, []);
  assert.equal(repositoryDb, db);
  assert.equal(seenDeliveries, 0);
  await assert.rejects(
    consumeExternalIntelligenceQueue(
      { ...batch, queue: "unexpected" },
      env({ DB: db }),
      dependencies(),
    ),
    /Unexpected external-intelligence queue/u,
  );
  await assert.rejects(
    consumeExternalIntelligenceQueue(
      batch,
      runtimeEnv({ APP_ENV: "production" }),
      dependencies(),
    ),
    /restricted to fail-closed paper mode/u,
  );
});
