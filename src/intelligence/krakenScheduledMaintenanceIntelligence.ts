import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";
import type {
  ExternalIntelligenceItem,
  ExternalIntelligencePolicy,
  IntelligenceStance,
} from "./externalIntelligence.ts";
import type {
  ExternalIntelligenceAssessmentRequestInput,
  NormalisedExternalIntelligenceCapture,
} from "./queuePipeline.ts";
import type {
  ExternalIntelligenceFeedTarget,
  ExternalIntelligencePayloadCapture,
} from "./sourceAdapters.ts";
import {
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";
import type { ExternalIntelligenceItemRecord } from "../storage/externalIntelligence.ts";
import { bytesToHex } from "../utils/encoding.ts";

export const KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID =
  "kraken-status-active-maintenance";
export const KRAKEN_ACTIVE_MAINTENANCE_SOURCE_REF =
  "https://status.kraken.com/api/v2/scheduled-maintenances/active.json";
export const KRAKEN_STATUS_API_REF = "https://status.kraken.com/api";
export const KRAKEN_STATUS_ORIGIN = "https://status.kraken.com/";
export const KRAKEN_STATUS_PUBLISHER_ID = "kraken-status";
export const KRAKEN_STATUS_PROVIDER_ID = "kraken-statuspage";
export const KRAKEN_STATUS_PAGE_ID = "lfz25gyhcpjf";
export const KRAKEN_STATUS_PAGE_NAME = "Kraken";
export const KRAKEN_STATUS_PAGE_URL = "https://status.kraken.com";
export const KRAKEN_STATUS_VENUE_SCOPE = "KRAKEN.VENUE";

const MAXIMUM_MAINTENANCES = 100;
const MAXIMUM_UPDATES_PER_MAINTENANCE = 100;
const MAXIMUM_PROVIDER_TEXT_LENGTH = 20_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

type KrakenMaintenanceImpact =
  | "none"
  | "minor"
  | "major"
  | "critical"
  | "maintenance";
type KrakenActiveMaintenanceStatus = "in_progress" | "verifying";
type KrakenMaintenanceUpdateStatus =
  | "scheduled"
  | "in_progress"
  | "verifying"
  | "completed";

const IMPACTS = new Set<KrakenMaintenanceImpact>([
  "none",
  "minor",
  "major",
  "critical",
  "maintenance",
]);
const ACTIVE_STATUSES = new Set<KrakenActiveMaintenanceStatus>([
  "in_progress",
  "verifying",
]);
const UPDATE_STATUSES = new Set<KrakenMaintenanceUpdateStatus>([
  "scheduled",
  "in_progress",
  "verifying",
  "completed",
]);

interface KrakenMaintenanceUpdate {
  readonly id: string;
  readonly status: KrakenMaintenanceUpdateStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly displayedAtMs: number;
  readonly bodySha256: string;
}

interface KrakenActiveMaintenance {
  readonly id: string;
  readonly name: string;
  readonly status: KrakenActiveMaintenanceStatus;
  readonly impact: KrakenMaintenanceImpact;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly scheduledForMs: number;
  readonly scheduledUntilMs: number;
  readonly latestUpdate: KrakenMaintenanceUpdate;
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

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedArray(
  value: unknown,
  name: string,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${name} must be an array with at most ${maximum} entries`);
  }
  return value;
}

function canonicalText(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > MAXIMUM_PROVIDER_TEXT_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be bounded canonical text`);
  }
  return value;
}

function providerId(value: unknown, name: string): string {
  const id = canonicalText(value, name);
  if (id.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(id)) {
    throw new Error(`${name} must be a bounded provider identifier`);
  }
  return id;
}

function providerBody(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100_000 ||
    value.includes("\u0000")
  ) {
    throw new Error("Kraken maintenance update body must be bounded");
  }
  return value;
}

function isoTime(value: unknown, name: string): number {
  const parsed = Date.parse(canonicalText(value, name));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a valid non-negative ISO timestamp`);
  }
  return parsed;
}

function impact(value: unknown): KrakenMaintenanceImpact {
  if (
    typeof value !== "string" ||
    !IMPACTS.has(value as KrakenMaintenanceImpact)
  ) {
    throw new Error("Kraken maintenance impact is unsupported");
  }
  return value as KrakenMaintenanceImpact;
}

function activeStatus(value: unknown): KrakenActiveMaintenanceStatus {
  if (
    typeof value !== "string" ||
    !ACTIVE_STATUSES.has(value as KrakenActiveMaintenanceStatus)
  ) {
    throw new Error("Kraken maintenance is not active");
  }
  return value as KrakenActiveMaintenanceStatus;
}

function updateStatus(value: unknown): KrakenMaintenanceUpdateStatus {
  if (
    typeof value !== "string" ||
    !UPDATE_STATUSES.has(value as KrakenMaintenanceUpdateStatus)
  ) {
    throw new Error("Kraken maintenance update status is unsupported");
  }
  return value as KrakenMaintenanceUpdateStatus;
}

async function parseUpdate(
  value: unknown,
  maintenanceId: string,
): Promise<KrakenMaintenanceUpdate> {
  const update = record(value, "Kraken maintenance update");
  const id = providerId(update.id, "Kraken maintenance update id");
  if (
    providerId(
      update.incident_id,
      "Kraken maintenance update incident id",
    ) !== maintenanceId
  ) {
    throw new Error("Kraken maintenance update has conflicting parent");
  }
  const createdAtMs = isoTime(
    update.created_at,
    "Kraken maintenance update created_at",
  );
  const updatedAtMs = isoTime(
    update.updated_at,
    "Kraken maintenance update updated_at",
  );
  const displayedAtMs = isoTime(
    update.display_at,
    "Kraken maintenance update display_at",
  );
  if (createdAtMs > updatedAtMs || createdAtMs > displayedAtMs) {
    throw new Error("Kraken maintenance update chronology is invalid");
  }
  return {
    id,
    status: updateStatus(update.status),
    createdAtMs,
    updatedAtMs,
    displayedAtMs,
    bodySha256: await sha256CanonicalIntelligence({
      schemaVersion: "kraken-maintenance-update-body-v1",
      body: providerBody(update.body),
    }),
  };
}

function newestUpdate(
  updates: readonly KrakenMaintenanceUpdate[],
): KrakenMaintenanceUpdate {
  const latest = [...updates]
    .sort(
      (left, right) =>
        left.displayedAtMs - right.displayedAtMs ||
        left.updatedAtMs - right.updatedAtMs ||
        left.id.localeCompare(right.id),
    )
    .at(-1);
  if (latest === undefined) {
    throw new Error("Kraken active maintenance must contain an update");
  }
  return latest;
}

async function parseMaintenance(
  value: unknown,
  pageId: string,
): Promise<KrakenActiveMaintenance> {
  const maintenance = record(value, "Kraken active maintenance");
  const id = providerId(maintenance.id, "Kraken maintenance id");
  if (
    providerId(maintenance.page_id, "Kraken maintenance page id") !== pageId
  ) {
    throw new Error("Kraken maintenance belongs to another status page");
  }
  const status = activeStatus(maintenance.status);
  const createdAtMs = isoTime(
    maintenance.created_at,
    "Kraken maintenance created_at",
  );
  const updatedAtMs = isoTime(
    maintenance.updated_at,
    "Kraken maintenance updated_at",
  );
  const scheduledForMs = isoTime(
    maintenance.scheduled_for,
    "Kraken maintenance scheduled_for",
  );
  const scheduledUntilMs = isoTime(
    maintenance.scheduled_until,
    "Kraken maintenance scheduled_until",
  );
  if (
    createdAtMs > updatedAtMs ||
    scheduledForMs >= scheduledUntilMs
  ) {
    throw new Error("Kraken maintenance chronology is invalid");
  }
  const updates = await Promise.all(
    boundedArray(
      maintenance.incident_updates,
      "Kraken maintenance updates",
      MAXIMUM_UPDATES_PER_MAINTENANCE,
    ).map((entry) => parseUpdate(entry, id)),
  );
  const updateIds = updates.map((update) => update.id);
  if (new Set(updateIds).size !== updateIds.length) {
    throw new Error(`Kraken maintenance ${id} contains duplicate update ids`);
  }
  const latestUpdate = newestUpdate(updates);
  if (latestUpdate.status !== status || latestUpdate.updatedAtMs > updatedAtMs) {
    throw new Error("Kraken maintenance latest update conflicts with state");
  }
  return {
    id,
    name: canonicalText(maintenance.name, "Kraken maintenance name"),
    status,
    impact: impact(maintenance.impact),
    createdAtMs,
    updatedAtMs,
    scheduledForMs,
    scheduledUntilMs,
    latestUpdate,
  };
}

function stanceForImpact(value: KrakenMaintenanceImpact): IntelligenceStance {
  return value === "major" || value === "critical" ? "negative" : "neutral";
}

function confidenceForImpact(value: KrakenMaintenanceImpact): number {
  switch (value) {
    case "critical":
      return 10_000;
    case "major":
      return 9_500;
    case "minor":
    case "maintenance":
      return 8_000;
    case "none":
      return 7_000;
  }
}

async function assertManifest(
  contract: ExternalIntelligenceSourceContract,
  capture?: ExternalIntelligencePayloadCapture,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  if (
    contract.sourceId !== KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID ||
    contract.sourceKind !== "official-exchange" ||
    contract.authority !== "authoritative" ||
    contract.sourceOrigin !== KRAKEN_STATUS_ORIGIN ||
    contract.publisherId !== KRAKEN_STATUS_PUBLISHER_ID ||
    contract.providerId !== KRAKEN_STATUS_PROVIDER_ID ||
    contract.contentPolicy !== "digest-only" ||
    contract.licenceRef !== KRAKEN_STATUS_API_REF ||
    contract.attributionRequired !== false ||
    contract.deletionHandling !== "not-applicable" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    !contract.allowedAcquisitionModes.includes("minute-poll")
  ) {
    throw new Error(
      "Kraken active-maintenance contract does not match the approved manifest",
    );
  }
  if (capture === undefined) return;
  if (
    capture.sourceId !== contract.sourceId ||
    capture.sourceContractSha256 !== contract.sourceContractSha256 ||
    capture.sourceKind !== "official-exchange" ||
    capture.publisherId !== contract.publisherId ||
    capture.providerId !== contract.providerId ||
    capture.sourceRef !== KRAKEN_ACTIVE_MAINTENANCE_SOURCE_REF ||
    capture.acquisitionMode !== "minute-poll" ||
    capture.contentType !== "application/json" ||
    capture.payloadRetention !== "transient-only" ||
    capture.modelTrainingAllowed !== false
  ) {
    throw new Error(
      "Kraken active-maintenance capture does not match the approved manifest",
    );
  }
}

async function parsePayload(
  capture: ExternalIntelligencePayloadCapture,
): Promise<readonly KrakenActiveMaintenance[]> {
  if (capture.payloadByteLength !== capture.payloadBytes.byteLength) {
    throw new Error("Kraken maintenance byte length does not match its capture");
  }
  const digest = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(capture.payloadBytes),
      ),
    ),
  );
  if (digest !== capture.payloadSha256) {
    throw new Error("Kraken maintenance digest does not match its capture");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(capture.payloadBytes));
  } catch {
    throw new Error("Kraken maintenance payload must be valid UTF-8 JSON");
  }
  const root = record(parsed, "Kraken maintenance payload");
  const page = record(root.page, "Kraken Status page");
  const pageId = providerId(page.id, "Kraken Status page id");
  if (
    pageId !== KRAKEN_STATUS_PAGE_ID ||
    canonicalText(page.name, "Kraken Status page name") !==
      KRAKEN_STATUS_PAGE_NAME ||
    canonicalText(page.url, "Kraken Status page URL") !== KRAKEN_STATUS_PAGE_URL
  ) {
    throw new Error("Kraken maintenance payload has an unapproved status page");
  }
  const maintenances = await Promise.all(
    boundedArray(
      root.scheduled_maintenances,
      "Kraken active maintenances",
      MAXIMUM_MAINTENANCES,
    ).map((entry) => parseMaintenance(entry, pageId)),
  );
  const ids = maintenances.map((maintenance) => maintenance.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Kraken maintenance payload contains duplicate ids");
  }
  return [...maintenances].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

async function itemRecordFor(
  maintenance: KrakenActiveMaintenance,
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
): Promise<ExternalIntelligenceItemRecord> {
  const update = maintenance.latestUpdate;
  if (
    maintenance.createdAtMs > capture.receivedAtMs ||
    maintenance.updatedAtMs > capture.receivedAtMs ||
    update.updatedAtMs > capture.receivedAtMs ||
    update.displayedAtMs > capture.receivedAtMs
  ) {
    throw new Error("Kraken maintenance chronology extends after receipt");
  }
  const externalId = `maintenance:${maintenance.id}:update:${update.id}`;
  const stance = stanceForImpact(maintenance.impact);
  const contentSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "kraken-active-maintenance-content-v1",
    maintenanceId: maintenance.id,
    maintenanceName: maintenance.name,
    status: maintenance.status,
    impact: maintenance.impact,
    createdAtMs: maintenance.createdAtMs,
    updatedAtMs: maintenance.updatedAtMs,
    scheduledForMs: maintenance.scheduledForMs,
    scheduledUntilMs: maintenance.scheduledUntilMs,
    updateId: update.id,
    updateStatus: update.status,
    updateCreatedAtMs: update.createdAtMs,
    updateUpdatedAtMs: update.updatedAtMs,
    updateDisplayedAtMs: update.displayedAtMs,
    updateBodySha256: update.bodySha256,
  });
  const item: ExternalIntelligenceItem = {
    itemId: await sha256CanonicalIntelligence({
      schemaVersion: "kraken-active-maintenance-item-id-v1",
      sourceId: contract.sourceId,
      externalId,
    }),
    sourceId: contract.sourceId,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: contract.publisherId,
    sourceRef: capture.sourceRef,
    externalId,
    acquisitionMode: "minute-poll",
    topicKey: `kraken-maintenance:${maintenance.id}`,
    assetSymbols: [KRAKEN_STATUS_VENUE_SCOPE],
    eventType: "market-structure",
    stance,
    publishedAtMs: update.displayedAtMs,
    receivedAtMs: capture.receivedAtMs,
    availableAtMs: capture.availableAtMs,
    payloadSha256: capture.payloadSha256,
    contentSha256,
    credibilityBps: 10_000,
    confidenceBps: confidenceForImpact(maintenance.impact),
    contentPolicy: contract.contentPolicy,
    modelTrainingAllowed: false,
  };
  return { item, sourceContractSha256: contract.sourceContractSha256 };
}

export async function normaliseKrakenActiveMaintenanceCapture(
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
  policy: ExternalIntelligencePolicy,
): Promise<NormalisedExternalIntelligenceCapture | null> {
  await assertManifest(contract, capture);
  const maintenances = await parsePayload(capture);
  if (maintenances.length === 0) return null;
  const itemRecords = await Promise.all(
    maintenances.map((maintenance) =>
      itemRecordFor(maintenance, contract, capture),
    ),
  );
  const assessmentRequests: ExternalIntelligenceAssessmentRequestInput[] =
    itemRecords.map((record) => ({
      topicKey: record.item.topicKey,
      eventType: "market-structure",
      stance: record.item.stance,
      itemIds: [record.item.itemId],
      policy,
    }));
  const result: NormalisedExternalIntelligenceCapture = {
    itemRecords,
    corrections: [],
    assessmentRequests,
  };
  const retained = canonicalIntelligenceJson(result);
  if (
    retained.includes("payloadBytes") ||
    maintenances.some((maintenance) => retained.includes(maintenance.name))
  ) {
    throw new Error("Kraken maintenance normalisation retained provider text");
  }
  return result;
}

export async function createKrakenActiveMaintenanceMinuteSource(
  contract: ExternalIntelligenceSourceContract,
  policy: ExternalIntelligencePolicy,
): Promise<MinuteExternalIntelligenceSource> {
  await assertManifest(contract);
  return {
    contract,
    target: {
      sourceId: KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
      sourceRef: KRAKEN_ACTIVE_MAINTENANCE_SOURCE_REF,
      acquisitionMode: "minute-poll",
      acceptedContentTypes: ["application/json"],
    },
    normaliseCapture: (capture) =>
      normaliseKrakenActiveMaintenanceCapture(contract, capture, policy),
  };
}
