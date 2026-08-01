import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntelligenceItem } from "../src/intelligence/externalIntelligence.ts";
import { createExternalIntelligenceSourceContract } from "../src/intelligence/sourceRegistry.ts";
import { externalIntelligencePayloadCaptureId } from "../src/intelligence/sourceAdapters.ts";
import {
  prepareExternalIntelligenceQueueMessage,
  processExternalIntelligenceQueueBatch,
  runMinuteExternalIntelligenceCollector,
  verifyExternalIntelligenceQueueMessage,
  type ExternalIntelligenceQueueDelivery,
  type ExternalIntelligenceQueueProducer,
  type ExternalIntelligenceQueueRepository,
} from "../src/intelligence/queuePipeline.ts";

const BASE_TIME = Date.UTC(2026, 6, 27, 4, 0, 0);
const digest = (character: string) => character.repeat(64);

const policy = {
  maximumItemAgeMs: {
    "official-exchange": 60_000,
    regulator: 60_000,
    issuer: 60_000,
    "mainstream-news": 60_000,
    "specialist-news": 60_000,
    reddit: 60_000,
  },
  maximumReceiptDelayMs: 30_000,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 7_000,
  maximumItems: 10,
} as const;

async function contract() {
  return createExternalIntelligenceSourceContract({
    sourceId: "kraken-blog",
    contractVersion: 1,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: "kraken.com",
    providerId: "direct",
    sourceOrigin: "https://blog.kraken.com/",
    allowedAcquisitionModes: ["minute-poll"],
    contentPolicy: "metadata-only",
    licenceRef: "https://www.kraken.com/legal/",
    licenceSha256: digest("a"),
    attributionRequired: false,
    maximumRetentionMs: null,
    deletionHandling: "not-applicable",
    modelTrainingAllowed: false,
    approvedAtMs: BASE_TIME - 2_000,
    effectiveFromMs: BASE_TIME - 1_000,
    expiresAtMs: null,
    enabled: true,
  });
}

function item(
  sourceContractSha256: string,
  itemId = "kraken-listing-btc",
  availableAtMs = BASE_TIME + 20,
): { readonly item: ExternalIntelligenceItem; readonly sourceContractSha256: string } {
  return {
    sourceContractSha256,
    item: {
      itemId,
      sourceId: "kraken-blog",
      sourceKind: "official-exchange",
      authority: "authoritative",
      publisherId: "kraken.com",
      sourceRef: "https://blog.kraken.com/product/asset-listings/bitcoin",
      externalId: itemId,
      acquisitionMode: "minute-poll",
      topicKey: "BTC:listing:20260727",
      assetSymbols: ["BTC"],
      eventType: "listing",
      stance: "positive",
      publishedAtMs: BASE_TIME - 1_000,
      receivedAtMs: BASE_TIME + 10,
      availableAtMs,
      payloadSha256: digest("b"),
      contentSha256: digest("c"),
      credibilityBps: 9_000,
      confidenceBps: 9_000,
      contentPolicy: "metadata-only",
      modelTrainingAllowed: false,
    },
  };
}

async function capture(
  sourceContract: Awaited<ReturnType<typeof contract>>,
) {
  const evidence = {
    sourceId: "kraken-blog",
    sourceContractSha256: sourceContract.sourceContractSha256,
    sourceRef: "https://blog.kraken.com/feed",
    acquisitionMode: "minute-poll" as const,
    requestStartedAtMs: BASE_TIME,
    receivedAtMs: BASE_TIME + 10,
    availableAtMs: BASE_TIME + 20,
    responseLatencyMs: 10,
    availabilityLatencyMs: 10,
    payloadSha256: digest("b"),
    payloadByteLength: 2,
    contentType: "application/json",
    etag: '"v1"',
    lastModified: null,
    payloadRetention: "transient-only" as const,
    modelTrainingAllowed: false as const,
  };
  return {
    ...evidence,
    captureId: await externalIntelligencePayloadCaptureId({
      ...evidence,
      sourceKind: sourceContract.sourceKind,
    }),
  };
}

async function queueInput() {
  const sourceContract = await contract();
  const record = item(sourceContract.sourceContractSha256);
  return {
    recordedAtMs: BASE_TIME + 30,
    sourceContract,
    capture: await capture(sourceContract),
    itemRecords: [record],
    corrections: [],
    assessmentRequests: [
      {
        topicKey: record.item.topicKey,
        eventType: record.item.eventType,
        stance: record.item.stance,
        itemIds: [record.item.itemId],
        policy,
      },
    ],
  } as const;
}

test("queue identity is deterministic and contains no raw provider payload", async () => {
  const input = await queueInput();
  const first = await prepareExternalIntelligenceQueueMessage(input, BASE_TIME + 40);
  const second = await prepareExternalIntelligenceQueueMessage(
    {
      ...input,
      itemRecords: [...input.itemRecords].reverse(),
      assessmentRequests: [...input.assessmentRequests].reverse(),
    },
    BASE_TIME + 40,
  );

  assert.equal(first.messageId, second.messageId);
  assert.equal(JSON.stringify(first).includes("payloadBytes"), false);
  assert.equal(JSON.stringify(first).includes("rawContent"), false);
});

test("items must bind the exact acquisition payload and receipt chronology", async () => {
  const input = await queueInput();
  const changed = structuredClone(input) as unknown as {
    itemRecords: Array<{ item: { payloadSha256: string } }>;
  };
  changed.itemRecords[0]!.item.payloadSha256 = digest("8");

  await assert.rejects(
    () => prepareExternalIntelligenceQueueMessage(changed as never, BASE_TIME + 40),
    /not bound to its acquisition capture/,
  );
});

test("reproduces capture identity and rejects forged acquisition evidence", async () => {
  const input = await queueInput();
  const changed = structuredClone(input) as unknown as {
    capture: { captureId: string };
  };
  changed.capture.captureId = digest("d");

  await assert.rejects(
    () => prepareExternalIntelligenceQueueMessage(changed as never, BASE_TIME + 40),
    /captureId does not reproduce/u,
  );
});

test("rejects retention drift and credential-bearing capture references", async () => {
  const retentionChanged = structuredClone(await queueInput()) as unknown as {
    capture: { payloadRetention: string };
  };
  retentionChanged.capture.payloadRetention = "contract-permitted-full";
  await assert.rejects(
    () =>
      prepareExternalIntelligenceQueueMessage(
        retentionChanged as never,
        BASE_TIME + 40,
      ),
    /retention does not match/u,
  );

  const credentialChanged = structuredClone(await queueInput()) as Awaited<
    ReturnType<typeof queueInput>
  >;
  const sourceRef = "https://blog.kraken.com/feed?api_key=secret";
  const captureId = await externalIntelligencePayloadCaptureId({
    ...credentialChanged.capture,
    sourceKind: credentialChanged.sourceContract.sourceKind,
    sourceRef,
  });
  await assert.rejects(
    () =>
      prepareExternalIntelligenceQueueMessage(
        {
          ...credentialChanged,
          capture: { ...credentialChanged.capture, sourceRef, captureId },
        },
        BASE_TIME + 40,
      ),
    /contains credentials or signatures/u,
  );
});

test("changed queue content is rejected when the deterministic identity is reused", async () => {
  const message = await prepareExternalIntelligenceQueueMessage(
    await queueInput(),
    BASE_TIME + 40,
  );
  const changed = structuredClone(message) as unknown as {
    payload: { itemRecords: Array<{ item: { credibilityBps: number } }> };
  };
  changed.payload.itemRecords[0]!.item.credibilityBps = 1;

  await assert.rejects(
    () => verifyExternalIntelligenceQueueMessage(changed),
    /digest does not match/,
  );
});

class Repository implements ExternalIntelligenceQueueRepository {
  readonly inputs: unknown[] = [];

  async persistBatch(
    input: Parameters<ExternalIntelligenceQueueRepository["persistBatch"]>[0],
  ) {
    this.inputs.push(input);
    return {
      batchSha256: digest("e"),
      recordedAtMs: input.recordedAtMs,
      sourceContracts: input.sourceContracts,
      itemRecords: input.itemRecords,
      corrections: input.corrections,
      assessmentRecords: input.assessmentRecords.map((record) => ({
        ...record,
        policySha256: digest("f"),
      })),
    };
  }
}

function delivery(body: unknown, attempts = 1) {
  const state = { acked: false, retryDelaySeconds: null as number | null };
  const value: ExternalIntelligenceQueueDelivery = {
    id: `delivery-${attempts}`,
    body,
    attempts,
    ack: () => {
      state.acked = true;
    },
    retry: (options) => {
      state.retryDelaySeconds = options?.delaySeconds ?? 0;
    },
  };
  return { value, state };
}

test("at-least-once duplicate deliveries are acknowledged through idempotent persistence", async () => {
  const message = await prepareExternalIntelligenceQueueMessage(
    await queueInput(),
    BASE_TIME + 40,
  );
  const first = delivery(message);
  const duplicate = delivery(message, 2);
  const repository = new Repository();

  const outcomes = await processExternalIntelligenceQueueBatch(
    [first.value, duplicate.value],
    repository,
  );

  assert.equal(repository.inputs.length, 2);
  assert.equal(first.state.acked, true);
  assert.equal(duplicate.state.acked, true);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ["persisted", "persisted"],
  );
});

test("one malformed delivery is retried without replaying an acknowledged neighbour", async () => {
  const message = await prepareExternalIntelligenceQueueMessage(
    await queueInput(),
    BASE_TIME + 40,
  );
  const valid = delivery(message);
  const invalid = delivery({ schemaVersion: "external-intelligence-queue-v1" }, 3);
  const outcomes = await processExternalIntelligenceQueueBatch(
    [valid.value, invalid.value],
    new Repository(),
  );

  assert.equal(valid.state.acked, true);
  assert.equal(valid.state.retryDelaySeconds, null);
  assert.equal(invalid.state.acked, false);
  assert.equal(invalid.state.retryDelaySeconds, 20);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ["persisted", "retry"],
  );
});

test("minute collection queues normalised metadata and advances cache state only after enqueue", async () => {
  const sourceContract = await contract();
  const sent: unknown[] = [];
  const saved: unknown[] = [];
  const queue: ExternalIntelligenceQueueProducer = {
    send: async (body) => {
      sent.push(body);
    },
  };
  const times = [
    BASE_TIME,
    BASE_TIME + 10,
    BASE_TIME + 20,
    BASE_TIME + 30,
    BASE_TIME + 40,
  ];
  const report = await runMinuteExternalIntelligenceCollector(
    [
      {
        contract: sourceContract,
        target: {
          sourceId: sourceContract.sourceId,
          sourceRef: "https://blog.kraken.com/feed",
          acquisitionMode: "minute-poll",
          acceptedContentTypes: ["application/json"],
        },
        normaliseCapture: async (payloadCapture) => ({
          itemRecords: [
            (() => {
              const record = item(
                sourceContract.sourceContractSha256,
                "kraken-listing-btc",
                payloadCapture.availableAtMs,
              );
              return {
                ...record,
                item: {
                  ...record.item,
                  receivedAtMs: payloadCapture.receivedAtMs,
                  payloadSha256: payloadCapture.payloadSha256,
                },
              };
            })(),
          ],
          corrections: [],
          assessmentRequests: [
            {
              topicKey: "BTC:listing:20260727",
              eventType: "listing",
              stance: "positive",
              itemIds: ["kraken-listing-btc"],
              policy,
            },
          ],
        }),
      },
    ],
    queue,
    {
      load: async () => undefined,
      save: async (...values) => {
        saved.push(values);
      },
    },
    {
      scheduledAtMs: BASE_TIME,
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            etag: '"v1"',
          },
        }),
      nowMs: () => times.shift() ?? BASE_TIME + 50,
      sleep: async () => undefined,
    },
  );

  assert.equal(sent.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(report.outcomes[0]?.status, "enqueued");
  assert.equal(report.outcomes[0]?.staleOrDelayed, false);
  assert.equal(JSON.stringify(sent[0]).includes("payloadBytes"), false);
});

test("a queue outage leaves validators unchanged and surfaces the source as stale", async () => {
  const sourceContract = await contract();
  let saves = 0;
  const times = [
    BASE_TIME,
    BASE_TIME + 10,
    BASE_TIME + 20,
    BASE_TIME + 30,
    BASE_TIME + 40,
  ];
  const report = await runMinuteExternalIntelligenceCollector(
    [
      {
        contract: sourceContract,
        target: {
          sourceId: sourceContract.sourceId,
          sourceRef: "https://blog.kraken.com/feed",
          acquisitionMode: "minute-poll",
          acceptedContentTypes: ["application/json"],
        },
        normaliseCapture: async (payloadCapture) => ({
          itemRecords: [
            (() => {
              const record = item(
                sourceContract.sourceContractSha256,
                "kraken-listing-btc",
                payloadCapture.availableAtMs,
              );
              return {
                ...record,
                item: {
                  ...record.item,
                  receivedAtMs: payloadCapture.receivedAtMs,
                  payloadSha256: payloadCapture.payloadSha256,
                },
              };
            })(),
          ],
          corrections: [],
          assessmentRequests: [],
        }),
      },
    ],
    {
      send: async () => {
        throw new Error("queue unavailable");
      },
    },
    {
      load: async () => undefined,
      save: async () => {
        saves += 1;
      },
    },
    {
      scheduledAtMs: BASE_TIME,
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      nowMs: () => times.shift() ?? BASE_TIME + 50,
      sleep: async () => undefined,
    },
  );

  assert.equal(saves, 0);
  assert.equal(report.outcomes[0]?.status, "failed");
  assert.equal(report.outcomes[0]?.staleOrDelayed, true);
  assert.match(report.outcomes[0]?.error ?? "", /queue unavailable/);
});
