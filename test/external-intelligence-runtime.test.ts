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

function env(
  overrides: Partial<Env> = {},
): Env {
  return {
    APP_ENV: "preview",
    EXTERNAL_INTELLIGENCE_ENABLED: "false",
    KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON: "",
    DB: {} as D1Database,
    EXTERNAL_INTELLIGENCE_QUEUE: {} as Queue<unknown>,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<ExternalIntelligenceRuntimeDependencies> = {},
): ExternalIntelligenceRuntimeDependencies {
  return {
    createMinuteSource: async (sourceContract) => ({
      contract: sourceContract,
    }),
    runCollector: async (_sources, _queue, _cache, options) => ({
      scheduledAtMs: options.scheduledAtMs,
      completedAtMs: options.scheduledAtMs + 1_000,
      outcomes: [],
    }),
    processQueueBatch: async () => [],
    createCacheState: () => ({}),
    createRepository: () => ({}),
    fetch,
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
        return {};
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

test("rejects ambiguous activation and missing contract configuration", async () => {
  await assert.rejects(
    runExternalIntelligenceMinuteCycle(
      env({ EXTERNAL_INTELLIGENCE_ENABLED: "TRUE" }),
      SLOT,
      dependencies(),
    ),
    /exactly true or false/u,
  );
  await assert.rejects(
    runExternalIntelligenceMinuteCycle(
      env({ EXTERNAL_INTELLIGENCE_ENABLED: "true" }),
      SLOT,
      dependencies(),
    ),
    /must contain one bounded contract/u,
  );
  const missingQueue = env({
    EXTERNAL_INTELLIGENCE_ENABLED: "true",
    KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON: JSON.stringify(contract),
  });
  delete missingQueue.EXTERNAL_INTELLIGENCE_QUEUE;
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
    env({
      EXTERNAL_INTELLIGENCE_ENABLED: "true",
      KRAKEN_ACTIVE_MAINTENANCE_CONTRACT_JSON: JSON.stringify(contract),
      DB: db,
      EXTERNAL_INTELLIGENCE_QUEUE: {
        metrics: async () => ({ backlogCount: 0, backlogBytes: 0 }),
        send: async () => ({
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        }),
        sendBatch: async () => ({
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        }),
      },
    }),
    SLOT,
    dependencies({
      createMinuteSource: async (value) => {
        createdContract = value;
        return { contract: value };
      },
      createCacheState: (value) => {
        cacheDb = value;
        return {};
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

test("consumes only the configured queue through the D1 repository", async () => {
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
        return {};
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
});
