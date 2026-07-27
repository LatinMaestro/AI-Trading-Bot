import {
  assessExternalIntelligence,
  type ExternalIntelligencePolicy,
  type IntelligenceEventType,
  type IntelligenceStance,
} from "./externalIntelligence.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";
import type { ExternalIntelligenceCorrection } from "./externalIntelligenceRecords.ts";
import {
  sourceContractAllowsReference,
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";
import {
  pollExternalIntelligenceFeed,
  type ExternalIntelligenceCacheValidators,
  type ExternalIntelligenceFeedTarget,
  type ExternalIntelligencePayloadCapture,
  type PollExternalIntelligenceFeedOptions,
} from "./sourceAdapters.ts";
import type {
  ExternalIntelligenceAssessmentRecord,
  ExternalIntelligenceIngestionBatch,
  ExternalIntelligenceItemRecord,
  ExternalIntelligencePersistenceInput,
} from "../storage/externalIntelligence.ts";

const QUEUE_SCHEMA_VERSION = "external-intelligence-queue-v1";
const MAXIMUM_QUEUE_MESSAGE_BYTES = 120_000;
const MAXIMUM_QUEUE_ITEMS = 100;
const MAXIMUM_ASSESSMENT_REQUESTS = 50;
const MAXIMUM_RETRY_DELAY_SECONDS = 300;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();

export interface ExternalIntelligenceAssessmentRequestInput {
  readonly topicKey: string;
  readonly eventType: IntelligenceEventType;
  readonly stance: IntelligenceStance;
  readonly itemIds: readonly string[];
  readonly policy: ExternalIntelligencePolicy;
}

export interface ExternalIntelligenceAssessmentRequest
  extends ExternalIntelligenceAssessmentRequestInput {
  readonly assessedAtMs: number;
}

export interface NormalisedExternalIntelligenceCapture {
  readonly itemRecords: readonly ExternalIntelligenceItemRecord[];
  readonly corrections: readonly ExternalIntelligenceCorrection[];
  readonly assessmentRequests: readonly ExternalIntelligenceAssessmentRequestInput[];
}

export interface ExternalIntelligenceQueueCaptureEvidence {
  readonly captureId: string;
  readonly sourceId: string;
  readonly sourceContractSha256: string;
  readonly sourceRef: string;
  readonly acquisitionMode: "minute-poll" | "scheduled-poll" | "webhook";
  readonly requestStartedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly responseLatencyMs: number;
  readonly availabilityLatencyMs: number;
  readonly payloadSha256: string;
  readonly payloadByteLength: number;
  readonly contentType: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly payloadRetention: "transient-only" | "contract-permitted-full";
  readonly modelTrainingAllowed: false;
}

export interface ExternalIntelligenceQueueInput {
  readonly recordedAtMs: number;
  readonly sourceContract: ExternalIntelligenceSourceContract;
  readonly capture: ExternalIntelligenceQueueCaptureEvidence;
  readonly itemRecords: readonly ExternalIntelligenceItemRecord[];
  readonly corrections: readonly ExternalIntelligenceCorrection[];
  readonly assessmentRequests: readonly ExternalIntelligenceAssessmentRequestInput[];
}

export interface ExternalIntelligenceQueueMessage {
  readonly schemaVersion: typeof QUEUE_SCHEMA_VERSION;
  readonly messageId: string;
  readonly enqueuedAtMs: number;
  readonly payload: {
    readonly recordedAtMs: number;
    readonly sourceContract: ExternalIntelligenceSourceContract;
    readonly capture: ExternalIntelligenceQueueCaptureEvidence;
    readonly itemRecords: readonly ExternalIntelligenceItemRecord[];
    readonly corrections: readonly ExternalIntelligenceCorrection[];
    readonly assessmentRequests: readonly ExternalIntelligenceAssessmentRequest[];
  };
}

export interface ExternalIntelligenceQueueProducer {
  send(
    body: ExternalIntelligenceQueueMessage,
    options?: { readonly contentType?: "json" },
  ): Promise<void>;
}

export interface ExternalIntelligenceQueueDelivery {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options?: { readonly delaySeconds?: number }): void;
}

export interface ExternalIntelligenceQueueRepository {
  persistBatch(
    input: ExternalIntelligencePersistenceInput,
  ): Promise<ExternalIntelligenceIngestionBatch>;
}

export interface ExternalIntelligenceQueueProcessingOutcome {
  readonly deliveryId: string;
  readonly messageId: string | null;
  readonly status: "persisted" | "retry";
  readonly batchSha256: string | null;
  readonly retryDelaySeconds: number | null;
  readonly error: string | null;
}

export interface MinuteExternalIntelligenceSource {
  readonly contract: ExternalIntelligenceSourceContract;
  readonly target: ExternalIntelligenceFeedTarget & {
    readonly acquisitionMode: "minute-poll";
  };
  normaliseCapture(
    capture: ExternalIntelligencePayloadCapture,
  ): Promise<NormalisedExternalIntelligenceCapture | null>;
}

export interface ExternalIntelligenceCacheState {
  load(sourceId: string): Promise<ExternalIntelligenceCacheValidators | undefined>;
  save(
    sourceId: string,
    validators: ExternalIntelligenceCacheValidators,
    observedAtMs: number,
  ): Promise<void>;
}

export interface RunMinuteExternalIntelligenceCollectorOptions
  extends Omit<PollExternalIntelligenceFeedOptions, "scheduledAtMs" | "cacheValidators"> {
  readonly scheduledAtMs: number;
}

export interface MinuteExternalIntelligenceCollectionOutcome {
  readonly sourceId: string;
  readonly status: "enqueued" | "not-modified" | "no-items" | "failed";
  readonly messageId: string | null;
  readonly requestStartedAtMs: number | null;
  readonly receivedAtMs: number | null;
  readonly availableAtMs: number | null;
  readonly responseLatencyMs: number | null;
  readonly availabilityLatencyMs: number | null;
  readonly staleOrDelayed: boolean;
  readonly error: string | null;
}

export interface MinuteExternalIntelligenceCollectionReport {
  readonly scheduledAtMs: number;
  readonly completedAtMs: number;
  readonly outcomes: readonly MinuteExternalIntelligenceCollectionOutcome[];
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertCanonicalText(name: string, value: string): void {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be canonical text`);
  }
}

function uniqueSorted(values: readonly string[], name: string): readonly string[] {
  const sorted = [...values].sort();
  for (const value of sorted) assertCanonicalText(name, value);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`${name} contains duplicates`);
  }
  return sorted;
}

function captureEvidenceOf(
  capture: ExternalIntelligencePayloadCapture,
): ExternalIntelligenceQueueCaptureEvidence {
  return {
    captureId: capture.captureId,
    sourceId: capture.sourceId,
    sourceContractSha256: capture.sourceContractSha256,
    sourceRef: capture.sourceRef,
    acquisitionMode: capture.acquisitionMode,
    requestStartedAtMs: capture.requestStartedAtMs,
    receivedAtMs: capture.receivedAtMs,
    availableAtMs: capture.availableAtMs,
    responseLatencyMs: capture.responseLatencyMs,
    availabilityLatencyMs: capture.availabilityLatencyMs,
    payloadSha256: capture.payloadSha256,
    payloadByteLength: capture.payloadByteLength,
    contentType: capture.contentType,
    etag: capture.etag,
    lastModified: capture.lastModified,
    payloadRetention: capture.payloadRetention,
    modelTrainingAllowed: false,
  };
}

function assertNoRawContent(value: unknown, path = "payload"): void {
  if (value === null || typeof value !== "object") return;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new Error(`${path} cannot contain binary provider content`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawContent(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "payloadBytes" ||
      key === "rawPayload" ||
      key === "rawContent" ||
      key === "fullContent"
    ) {
      throw new Error(`${path}.${key} cannot be placed on the intelligence queue`);
    }
    assertNoRawContent(entry, `${path}.${key}`);
  }
}

function canonicaliseInput(
  input: ExternalIntelligenceQueueInput,
): ExternalIntelligenceQueueMessage["payload"] {
  assertTime("recordedAtMs", input.recordedAtMs);
  if (input.itemRecords.length > MAXIMUM_QUEUE_ITEMS) {
    throw new Error(`Queue messages may contain at most ${MAXIMUM_QUEUE_ITEMS} items`);
  }
  if (input.assessmentRequests.length > MAXIMUM_ASSESSMENT_REQUESTS) {
    throw new Error(
      `Queue messages may contain at most ${MAXIMUM_ASSESSMENT_REQUESTS} assessment requests`,
    );
  }

  const itemRecords = [...input.itemRecords].sort((left, right) =>
    left.item.itemId.localeCompare(right.item.itemId),
  );
  const itemIds = new Set<string>();
  for (const record of itemRecords) {
    if (record.sourceContractSha256 !== input.sourceContract.sourceContractSha256) {
      throw new Error(`${record.item.itemId} uses the wrong source contract`);
    }
    if (record.item.sourceId !== input.sourceContract.sourceId) {
      throw new Error(`${record.item.itemId} uses the wrong source identity`);
    }
    if (itemIds.has(record.item.itemId)) {
      throw new Error(`Duplicate intelligence item ${record.item.itemId}`);
    }
    itemIds.add(record.item.itemId);
  }

  const corrections = [...input.corrections].sort((left, right) =>
    left.correctionSha256.localeCompare(right.correctionSha256),
  );
  const correctionIds = new Set<string>();
  for (const correction of corrections) {
    if (correctionIds.has(correction.correctionSha256)) {
      throw new Error(`Duplicate intelligence correction ${correction.correctionSha256}`);
    }
    correctionIds.add(correction.correctionSha256);
  }

  const assessmentRequests = input.assessmentRequests
    .map((request) => {
      const requestItemIds = uniqueSorted(request.itemIds, "assessment itemId");
      if (requestItemIds.length < 1) {
        throw new Error("Assessment requests must reference at least one item");
      }
      for (const itemId of requestItemIds) {
        if (!itemIds.has(itemId)) {
          throw new Error(`Assessment request references missing item ${itemId}`);
        }
      }
      return {
        topicKey: request.topicKey,
        eventType: request.eventType,
        stance: request.stance,
        itemIds: requestItemIds,
        policy: request.policy,
        assessedAtMs: input.recordedAtMs,
      };
    })
    .sort((left, right) =>
      `${left.topicKey}:${left.eventType}:${left.stance}:${left.itemIds.join(",")}`.localeCompare(
        `${right.topicKey}:${right.eventType}:${right.stance}:${right.itemIds.join(",")}`,
      ),
    );
  const requestKeys = assessmentRequests.map(
    (request) =>
      `${request.topicKey}:${request.eventType}:${request.stance}:${request.itemIds.join(",")}`,
  );
  if (new Set(requestKeys).size !== requestKeys.length) {
    throw new Error("Queue message contains duplicate assessment requests");
  }

  if (
    input.capture.sourceId !== input.sourceContract.sourceId ||
    input.capture.sourceContractSha256 !== input.sourceContract.sourceContractSha256
  ) {
    throw new Error("Capture evidence does not match the source contract");
  }
  if (
    !input.sourceContract.allowedAcquisitionModes.includes(
      input.capture.acquisitionMode,
    ) ||
    !sourceContractAllowsReference(input.sourceContract, input.capture.sourceRef)
  ) {
    throw new Error("Capture evidence is outside its approved source contract");
  }
  if (
    !Number.isSafeInteger(input.capture.payloadByteLength) ||
    input.capture.payloadByteLength <= 0
  ) {
    throw new Error("Queue capture payloadByteLength must be positive");
  }
  if (
    input.capture.availableAtMs > input.recordedAtMs ||
    input.capture.receivedAtMs > input.capture.availableAtMs ||
    input.capture.requestStartedAtMs > input.capture.receivedAtMs
  ) {
    throw new Error("Queue capture chronology is invalid");
  }
  if (
    input.capture.responseLatencyMs !==
      input.capture.receivedAtMs - input.capture.requestStartedAtMs ||
    input.capture.availabilityLatencyMs !==
      input.capture.availableAtMs - input.capture.receivedAtMs
  ) {
    throw new Error("Queue capture latency does not match its timestamps");
  }
  if (
    !SHA256_PATTERN.test(input.capture.captureId) ||
    !SHA256_PATTERN.test(input.capture.payloadSha256)
  ) {
    throw new Error("Queue capture requires lowercase SHA-256 identities");
  }
  if (input.capture.modelTrainingAllowed !== false) {
    throw new Error("Queue capture cannot permit model training");
  }

  return {
    recordedAtMs: input.recordedAtMs,
    sourceContract: input.sourceContract,
    capture: input.capture,
    itemRecords,
    corrections,
    assessmentRequests,
  };
}

export async function prepareExternalIntelligenceQueueMessage(
  input: ExternalIntelligenceQueueInput,
  enqueuedAtMs: number,
): Promise<ExternalIntelligenceQueueMessage> {
  assertTime("enqueuedAtMs", enqueuedAtMs);
  if (input.recordedAtMs > enqueuedAtMs) {
    throw new Error("Queue message cannot be enqueued before it is recorded");
  }
  await verifyExternalIntelligenceSourceContract(input.sourceContract);
  assertNoRawContent(input);
  const payload = canonicaliseInput(input);
  const canonical = {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    enqueuedAtMs,
    payload,
  } as const;
  const message: ExternalIntelligenceQueueMessage = {
    ...canonical,
    messageId: await sha256CanonicalIntelligence(canonical),
  };
  if (
    encoder.encode(canonicalIntelligenceJson(message)).byteLength >
    MAXIMUM_QUEUE_MESSAGE_BYTES
  ) {
    throw new Error(
      `External intelligence queue message exceeds ${MAXIMUM_QUEUE_MESSAGE_BYTES} bytes`,
    );
  }
  return message;
}

export async function verifyExternalIntelligenceQueueMessage(
  value: unknown,
): Promise<ExternalIntelligenceQueueMessage> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External intelligence queue body must be an object");
  }
  const candidate = value as ExternalIntelligenceQueueMessage;
  if (candidate.schemaVersion !== QUEUE_SCHEMA_VERSION) {
    throw new Error("Unsupported external intelligence queue schema");
  }
  if (!SHA256_PATTERN.test(candidate.messageId)) {
    throw new Error("External intelligence queue messageId is invalid");
  }
  const expected = await prepareExternalIntelligenceQueueMessage(
    candidate.payload,
    candidate.enqueuedAtMs,
  );
  if (canonicalIntelligenceJson(candidate) !== canonicalIntelligenceJson(expected)) {
    throw new Error("External intelligence queue message digest does not match");
  }
  return expected;
}

export async function enqueueExternalIntelligence(
  queue: ExternalIntelligenceQueueProducer,
  input: ExternalIntelligenceQueueInput,
  enqueuedAtMs: number,
): Promise<ExternalIntelligenceQueueMessage> {
  const message = await prepareExternalIntelligenceQueueMessage(input, enqueuedAtMs);
  await queue.send(message, { contentType: "json" });
  return message;
}

export async function processExternalIntelligenceQueueMessage(
  value: unknown,
  repository: ExternalIntelligenceQueueRepository,
): Promise<ExternalIntelligenceIngestionBatch> {
  const message = await verifyExternalIntelligenceQueueMessage(value);
  const itemsById = new Map(
    message.payload.itemRecords.map((record) => [record.item.itemId, record.item]),
  );
  const assessmentRecords: ExternalIntelligenceAssessmentRecord[] = [];
  for (const request of message.payload.assessmentRequests) {
    const items = request.itemIds.map((itemId) => {
      const item = itemsById.get(itemId);
      if (item === undefined) {
        throw new Error(`Assessment request references missing item ${itemId}`);
      }
      return item;
    });
    assessmentRecords.push({
      assessment: await assessExternalIntelligence(
        request.topicKey,
        request.eventType,
        request.stance,
        items,
        request.assessedAtMs,
        request.policy,
      ),
      assessedAtMs: request.assessedAtMs,
      policy: request.policy,
    });
  }
  return repository.persistBatch({
    recordedAtMs: message.payload.recordedAtMs,
    sourceContracts: [message.payload.sourceContract],
    itemRecords: message.payload.itemRecords,
    corrections: message.payload.corrections,
    assessmentRecords,
  });
}

function retryDelaySeconds(attempts: number): number {
  const boundedAttempts =
    Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  return Math.min(
    5 * 2 ** Math.min(boundedAttempts - 1, 6),
    MAXIMUM_RETRY_DELAY_SECONDS,
  );
}

function safeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unknown queue processing error";
  return message.replace(/\s+/gu, " ").slice(0, 300);
}

function messageIdOf(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const messageId = (value as { messageId?: unknown }).messageId;
  return typeof messageId === "string" && SHA256_PATTERN.test(messageId)
    ? messageId
    : null;
}

export async function processExternalIntelligenceQueueBatch(
  deliveries: readonly ExternalIntelligenceQueueDelivery[],
  repository: ExternalIntelligenceQueueRepository,
): Promise<readonly ExternalIntelligenceQueueProcessingOutcome[]> {
  const outcomes: ExternalIntelligenceQueueProcessingOutcome[] = [];
  for (const delivery of deliveries) {
    try {
      const batch = await processExternalIntelligenceQueueMessage(
        delivery.body,
        repository,
      );
      delivery.ack();
      outcomes.push({
        deliveryId: delivery.id,
        messageId: messageIdOf(delivery.body),
        status: "persisted",
        batchSha256: batch.batchSha256,
        retryDelaySeconds: null,
        error: null,
      });
    } catch (error: unknown) {
      const delaySeconds = retryDelaySeconds(delivery.attempts);
      delivery.retry({ delaySeconds });
      outcomes.push({
        deliveryId: delivery.id,
        messageId: messageIdOf(delivery.body),
        status: "retry",
        batchSha256: null,
        retryDelaySeconds: delaySeconds,
        error: safeError(error),
      });
    }
  }
  return outcomes;
}

function validatorsOf(
  capture: ExternalIntelligencePayloadCapture,
): ExternalIntelligenceCacheValidators {
  return { etag: capture.etag, lastModified: capture.lastModified };
}

export async function runMinuteExternalIntelligenceCollector(
  sources: readonly MinuteExternalIntelligenceSource[],
  queue: ExternalIntelligenceQueueProducer,
  cacheState: ExternalIntelligenceCacheState,
  options: RunMinuteExternalIntelligenceCollectorOptions,
): Promise<MinuteExternalIntelligenceCollectionReport> {
  assertTime("scheduledAtMs", options.scheduledAtMs);
  if (options.scheduledAtMs % 60_000 !== 0) {
    throw new Error("Minute intelligence collection requires an exact UTC minute slot");
  }
  const sourceIds = sources.map((source) => source.contract.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("Minute intelligence sources contain duplicate sourceId values");
  }
  const nowMs = options.nowMs ?? Date.now;
  const outcomes: MinuteExternalIntelligenceCollectionOutcome[] = [];

  for (const source of [...sources].sort((left, right) =>
    left.contract.sourceId.localeCompare(right.contract.sourceId),
  )) {
    try {
      if (source.target.acquisitionMode !== "minute-poll") {
        throw new Error("Minute collector received a non-minute target");
      }
      const cacheValidators = await cacheState.load(source.contract.sourceId);
      const pollOptions: PollExternalIntelligenceFeedOptions =
        cacheValidators === undefined
          ? { ...options, scheduledAtMs: options.scheduledAtMs, nowMs }
          : {
              ...options,
              scheduledAtMs: options.scheduledAtMs,
              cacheValidators,
              nowMs,
            };
      const result = await pollExternalIntelligenceFeed(
        source.contract,
        source.target,
        pollOptions,
      );

      if (result.status === "not-modified") {
        await cacheState.save(
          source.contract.sourceId,
          { etag: result.etag, lastModified: result.lastModified },
          result.availableAtMs,
        );
        outcomes.push({
          sourceId: source.contract.sourceId,
          status: "not-modified",
          messageId: null,
          requestStartedAtMs: result.requestStartedAtMs,
          receivedAtMs: result.receivedAtMs,
          availableAtMs: result.availableAtMs,
          responseLatencyMs: result.responseLatencyMs,
          availabilityLatencyMs: result.availabilityLatencyMs,
          staleOrDelayed: false,
          error: null,
        });
        continue;
      }

      const normalised = await source.normaliseCapture(result.capture);
      if (normalised === null) {
        await cacheState.save(
          source.contract.sourceId,
          validatorsOf(result.capture),
          result.capture.availableAtMs,
        );
        outcomes.push({
          sourceId: source.contract.sourceId,
          status: "no-items",
          messageId: null,
          requestStartedAtMs: result.capture.requestStartedAtMs,
          receivedAtMs: result.capture.receivedAtMs,
          availableAtMs: result.capture.availableAtMs,
          responseLatencyMs: result.capture.responseLatencyMs,
          availabilityLatencyMs: result.capture.availabilityLatencyMs,
          staleOrDelayed: false,
          error: null,
        });
        continue;
      }

      assertNoRawContent(normalised, "normalisedCapture");
      const enqueuedAtMs = nowMs();
      const message = await enqueueExternalIntelligence(
        queue,
        {
          recordedAtMs: enqueuedAtMs,
          sourceContract: source.contract,
          capture: captureEvidenceOf(result.capture),
          itemRecords: normalised.itemRecords,
          corrections: normalised.corrections,
          assessmentRequests: normalised.assessmentRequests,
        },
        enqueuedAtMs,
      );
      await cacheState.save(
        source.contract.sourceId,
        validatorsOf(result.capture),
        result.capture.availableAtMs,
      );
      outcomes.push({
        sourceId: source.contract.sourceId,
        status: "enqueued",
        messageId: message.messageId,
        requestStartedAtMs: result.capture.requestStartedAtMs,
        receivedAtMs: result.capture.receivedAtMs,
        availableAtMs: result.capture.availableAtMs,
        responseLatencyMs: result.capture.responseLatencyMs,
        availabilityLatencyMs: result.capture.availabilityLatencyMs,
        staleOrDelayed: false,
        error: null,
      });
    } catch (error: unknown) {
      outcomes.push({
        sourceId: source.contract.sourceId,
        status: "failed",
        messageId: null,
        requestStartedAtMs: null,
        receivedAtMs: null,
        availableAtMs: null,
        responseLatencyMs: null,
        availabilityLatencyMs: null,
        staleOrDelayed: true,
        error: safeError(error),
      });
    }
  }

  const completedAtMs = nowMs();
  assertTime("completedAtMs", completedAtMs);
  if (completedAtMs < options.scheduledAtMs) {
    throw new Error("Minute intelligence collection completed before its slot");
  }
  return { scheduledAtMs: options.scheduledAtMs, completedAtMs, outcomes };
}
