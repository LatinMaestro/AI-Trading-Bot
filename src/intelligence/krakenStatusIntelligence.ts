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
  MinuteExternalIntelligenceSource,
  NormalisedExternalIntelligenceCapture,
} from "./queuePipeline.ts";
import {
  externalIntelligencePayloadCaptureId,
  type ExternalIntelligencePayloadCapture,
} from "./sourceAdapters.ts";
import {
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";
import type { ExternalIntelligenceItemRecord } from "../storage/externalIntelligence.ts";
import { bytesToHex } from "../utils/encoding.ts";

export const KRAKEN_STATUS_INCIDENTS_SOURCE_ID =
  "kraken-status-unresolved-incidents";
export const KRAKEN_STATUS_INCIDENTS_SOURCE_REF =
  "https://status.kraken.com/api/v2/incidents/unresolved.json";
export const KRAKEN_STATUS_ORIGIN = "https://status.kraken.com/";
export const KRAKEN_STATUS_PUBLISHER_ID = "kraken-status";
export const KRAKEN_STATUS_PROVIDER_ID = "kraken-statuspage";
export const KRAKEN_STATUS_PAGE_ID = "lfz25gyhcpjf";
export const KRAKEN_STATUS_PAGE_NAME = "Kraken";
export const KRAKEN_STATUS_PAGE_URL = "https://status.kraken.com";
export const KRAKEN_STATUS_VENUE_SCOPE = "KRAKEN.VENUE";

const MAXIMUM_INCIDENTS = 100;
const MAXIMUM_UPDATES_PER_INCIDENT = 100;
const MAXIMUM_PROVIDER_TEXT_LENGTH = 20_000;
const MAXIMUM_PAYLOAD_BYTES = 1_048_576;
const decoder = new TextDecoder("utf-8", { fatal: true });

const KRAKEN_INCIDENT_IMPACTS = new Set([
  "none",
  "minor",
  "major",
  "critical",
] as const);
const KRAKEN_UNRESOLVED_STATUSES = new Set([
  "investigating",
  "identified",
  "monitoring",
] as const);

type KrakenIncidentImpact = "none" | "minor" | "major" | "critical";
type KrakenUnresolvedIncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring";

interface KrakenStatusUpdate {
  readonly id: string;
  readonly incidentId: string;
  readonly status: KrakenUnresolvedIncidentStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly displayedAtMs: number;
  readonly bodySha256: string;
}

interface KrakenStatusIncident {
  readonly id: string;
  readonly name: string;
  readonly status: KrakenUnresolvedIncidentStatus;
  readonly impact: KrakenIncidentImpact;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly latestUpdate: KrakenStatusUpdate;
}

function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertArray(value: unknown, name: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${name} must be an array with at most ${maximum} entries`);
  }
  return value;
}

function canonicalProviderText(value: unknown, name: string): string {
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

function boundedProviderContent(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100_000 ||
    value.includes("\u0000")
  ) {
    throw new Error(`${name} must be bounded provider content`);
  }
  return value;
}

function canonicalProviderId(value: unknown, name: string): string {
  const id = canonicalProviderText(value, name);
  if (id.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(id)) {
    throw new Error(`${name} must be a bounded provider identifier`);
  }
  return id;
}

function parseIsoTime(value: unknown, name: string): number {
  const text = canonicalProviderText(value, name);
  const parsed = Date.parse(text);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a valid non-negative ISO timestamp`);
  }
  return parsed;
}

function parseImpact(value: unknown): KrakenIncidentImpact {
  if (
    typeof value !== "string" ||
    !KRAKEN_INCIDENT_IMPACTS.has(value as KrakenIncidentImpact)
  ) {
    throw new Error("Kraken incident impact is unsupported");
  }
  return value as KrakenIncidentImpact;
}

function parseStatus(value: unknown, name: string): KrakenUnresolvedIncidentStatus {
  if (
    typeof value !== "string" ||
    !KRAKEN_UNRESOLVED_STATUSES.has(value as KrakenUnresolvedIncidentStatus)
  ) {
    throw new Error(`${name} is not an unresolved Kraken incident status`);
  }
  return value as KrakenUnresolvedIncidentStatus;
}

async function parseUpdate(
  value: unknown,
  incidentId: string,
): Promise<KrakenStatusUpdate> {
  const update = assertRecord(value, "Kraken incident update");
  const id = canonicalProviderId(update.id, "Kraken incident update id");
  const updateIncidentId = canonicalProviderId(
    update.incident_id,
    "Kraken incident update incident id",
  );
  if (updateIncidentId !== incidentId) {
    throw new Error("Kraken incident update does not belong to its incident");
  }
  const status = parseStatus(update.status, "Kraken incident update status");
  const createdAtMs = parseIsoTime(
    update.created_at,
    "Kraken incident update created_at",
  );
  const updatedAtMs = parseIsoTime(
    update.updated_at,
    "Kraken incident update updated_at",
  );
  const displayedAtMs = parseIsoTime(
    update.display_at,
    "Kraken incident update display_at",
  );
  // Statuspage can publish display_at with coarser precision just before
  // created_at. Both provider times must still be no later than updated_at.
  if (createdAtMs > updatedAtMs || displayedAtMs > updatedAtMs) {
    throw new Error("Kraken incident update chronology is invalid");
  }
  const body = boundedProviderContent(update.body, "Kraken incident update body");
  return {
    id,
    incidentId,
    status,
    createdAtMs,
    updatedAtMs,
    displayedAtMs,
    bodySha256: await sha256CanonicalIntelligence({
      schemaVersion: "kraken-status-update-body-v1",
      body,
    }),
  };
}

function latestUpdate(updates: readonly KrakenStatusUpdate[]): KrakenStatusUpdate {
  const sorted = [...updates].sort((left, right) => {
    const chronology =
      left.displayedAtMs - right.displayedAtMs ||
      left.updatedAtMs - right.updatedAtMs;
    return chronology || left.id.localeCompare(right.id);
  });
  const latest = sorted.at(-1);
  if (latest === undefined) {
    throw new Error("Kraken unresolved incident must contain an update");
  }
  return latest;
}

async function parseIncident(
  value: unknown,
  pageId: string,
): Promise<KrakenStatusIncident> {
  const incident = assertRecord(value, "Kraken incident");
  const id = canonicalProviderId(incident.id, "Kraken incident id");
  const incidentPageId = canonicalProviderId(
    incident.page_id,
    "Kraken incident page id",
  );
  if (incidentPageId !== pageId) {
    throw new Error(
      "Kraken incident does not belong to the approved status page",
    );
  }
  const name = canonicalProviderText(incident.name, "Kraken incident name");
  const status = parseStatus(incident.status, "Kraken incident status");
  const impact = parseImpact(incident.impact);
  const createdAtMs = parseIsoTime(
    incident.created_at,
    "Kraken incident created_at",
  );
  const updatedAtMs = parseIsoTime(
    incident.updated_at,
    "Kraken incident updated_at",
  );
  if (createdAtMs > updatedAtMs) {
    throw new Error("Kraken incident chronology is invalid");
  }
  const updates = await Promise.all(
    assertArray(
      incident.incident_updates,
      "Kraken incident updates",
      MAXIMUM_UPDATES_PER_INCIDENT,
    ).map((entry) => parseUpdate(entry, id)),
  );
  const updateIds = updates.map((update) => update.id);
  if (new Set(updateIds).size !== updateIds.length) {
    throw new Error(`Kraken incident ${id} contains duplicate update ids`);
  }
  const newest = latestUpdate(updates);
  if (newest.status !== status || newest.updatedAtMs > updatedAtMs) {
    throw new Error("Kraken incident latest update conflicts with incident state");
  }
  return {
    id,
    name,
    status,
    impact,
    createdAtMs,
    updatedAtMs,
    latestUpdate: newest,
  };
}

function stanceForImpact(impact: KrakenIncidentImpact): IntelligenceStance {
  return impact === "major" || impact === "critical" ? "negative" : "neutral";
}

function confidenceForImpact(impact: KrakenIncidentImpact): number {
  switch (impact) {
    case "critical":
      return 10_000;
    case "major":
      return 9_500;
    case "minor":
      return 8_000;
    case "none":
      return 7_000;
  }
}

async function itemRecordFor(
  incident: KrakenStatusIncident,
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
): Promise<ExternalIntelligenceItemRecord> {
  const update = incident.latestUpdate;
  if (update.displayedAtMs > capture.receivedAtMs) {
    throw new Error("Kraken incident was published after the payload was received");
  }
  const externalId = `incident:${incident.id}:update:${update.id}`;
  const topicKey = `kraken-status:${incident.id}`;
  const stance = stanceForImpact(incident.impact);
  const contentSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "kraken-status-incident-content-v1",
    providerIncidentId: incident.id,
    providerUpdateId: update.id,
    incidentName: incident.name,
    incidentStatus: incident.status,
    incidentImpact: incident.impact,
    incidentCreatedAtMs: incident.createdAtMs,
    incidentUpdatedAtMs: incident.updatedAtMs,
    updateStatus: update.status,
    updateCreatedAtMs: update.createdAtMs,
    updateUpdatedAtMs: update.updatedAtMs,
    updateDisplayedAtMs: update.displayedAtMs,
    updateBodySha256: update.bodySha256,
  });
  const itemId = await sha256CanonicalIntelligence({
    schemaVersion: "kraken-status-intelligence-item-id-v1",
    sourceId: contract.sourceId,
    externalId,
  });
  const item: ExternalIntelligenceItem = {
    itemId,
    sourceId: contract.sourceId,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: contract.publisherId,
    sourceRef: capture.sourceRef,
    externalId,
    acquisitionMode: "minute-poll",
    topicKey,
    assetSymbols: [KRAKEN_STATUS_VENUE_SCOPE],
    eventType: "network-incident",
    stance,
    publishedAtMs: update.displayedAtMs,
    receivedAtMs: capture.receivedAtMs,
    availableAtMs: capture.availableAtMs,
    payloadSha256: capture.payloadSha256,
    contentSha256,
    credibilityBps: 10_000,
    confidenceBps: confidenceForImpact(incident.impact),
    contentPolicy: contract.contentPolicy,
    modelTrainingAllowed: false,
  };
  return { item, sourceContractSha256: contract.sourceContractSha256 };
}

async function assertKrakenManifest(
  contract: ExternalIntelligenceSourceContract,
  capture?: ExternalIntelligencePayloadCapture,
): Promise<void> {
  await verifyExternalIntelligenceSourceContract(contract);
  if (
    contract.sourceId !== KRAKEN_STATUS_INCIDENTS_SOURCE_ID ||
    contract.sourceKind !== "official-exchange" ||
    contract.authority !== "authoritative" ||
    contract.sourceOrigin !== KRAKEN_STATUS_ORIGIN ||
    contract.publisherId !== KRAKEN_STATUS_PUBLISHER_ID ||
    contract.providerId !== KRAKEN_STATUS_PROVIDER_ID ||
    contract.contentPolicy !== "digest-only" ||
    contract.licenceRef !== KRAKEN_STATUS_ORIGIN ||
    contract.attributionRequired !== false ||
    contract.maximumRetentionMs !== null ||
    contract.deletionHandling !== "not-applicable" ||
    contract.modelTrainingAllowed !== false ||
    !contract.enabled ||
    contract.allowedAcquisitionModes.length !== 1 ||
    contract.allowedAcquisitionModes[0] !== "minute-poll"
  ) {
    throw new Error(
      "Kraken Status source contract does not match the approved manifest",
    );
  }
  if (capture === undefined) return;
  if (
    capture.requestStartedAtMs < contract.effectiveFromMs ||
    (contract.expiresAtMs !== null &&
      capture.requestStartedAtMs >= contract.expiresAtMs)
  ) {
    throw new Error("Kraken Status source contract was not active at capture time");
  }
  if (
    capture.sourceId !== contract.sourceId ||
    capture.sourceContractSha256 !== contract.sourceContractSha256 ||
    capture.sourceKind !== "official-exchange" ||
    capture.publisherId !== contract.publisherId ||
    capture.providerId !== contract.providerId ||
    capture.sourceRef !== KRAKEN_STATUS_INCIDENTS_SOURCE_REF ||
    capture.acquisitionMode !== "minute-poll" ||
    capture.contentType !== "application/json" ||
    capture.payloadRetention !== "transient-only" ||
    capture.modelTrainingAllowed !== false
  ) {
    throw new Error("Kraken Status capture does not match the approved manifest");
  }
  const reproducedCaptureId = await externalIntelligencePayloadCaptureId({
    sourceId: capture.sourceId,
    sourceContractSha256: capture.sourceContractSha256,
    sourceKind: capture.sourceKind,
    sourceRef: capture.sourceRef,
    acquisitionMode: capture.acquisitionMode,
    requestStartedAtMs: capture.requestStartedAtMs,
    receivedAtMs: capture.receivedAtMs,
    availableAtMs: capture.availableAtMs,
    payloadSha256: capture.payloadSha256,
    payloadByteLength: capture.payloadByteLength,
    contentType: capture.contentType,
    etag: capture.etag,
    lastModified: capture.lastModified,
  });
  if (capture.captureId !== reproducedCaptureId) {
    throw new Error("Kraken Status capture identity does not reproduce");
  }
}

async function parseKrakenStatusPayload(
  capture: ExternalIntelligencePayloadCapture,
): Promise<readonly KrakenStatusIncident[]> {
  if (
    capture.payloadByteLength <= 0 ||
    capture.payloadByteLength > MAXIMUM_PAYLOAD_BYTES
  ) {
    throw new Error("Kraken Status payload byte length is outside bounds");
  }
  if (capture.payloadByteLength !== capture.payloadBytes.byteLength) {
    throw new Error(
      "Kraken Status payload byte length does not match its capture",
    );
  }
  const exactDigest = bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", capture.payloadBytes)),
  );
  if (exactDigest !== capture.payloadSha256) {
    throw new Error("Kraken Status payload digest does not match its capture");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(capture.payloadBytes));
  } catch {
    throw new Error("Kraken Status payload must be valid UTF-8 JSON");
  }
  const root = assertRecord(parsed, "Kraken Status payload");
  const page = assertRecord(root.page, "Kraken Status page");
  const pageId = canonicalProviderId(page.id, "Kraken Status page id");
  const pageName = canonicalProviderText(page.name, "Kraken Status page name");
  const pageUrl = canonicalProviderText(page.url, "Kraken Status page URL");
  if (
    pageId !== KRAKEN_STATUS_PAGE_ID ||
    pageName !== KRAKEN_STATUS_PAGE_NAME ||
    pageUrl !== KRAKEN_STATUS_PAGE_URL
  ) {
    throw new Error("Kraken Status payload is not from the approved status page");
  }
  const incidents = await Promise.all(
    assertArray(root.incidents, "Kraken Status incidents", MAXIMUM_INCIDENTS).map(
      (entry) => parseIncident(entry, pageId),
    ),
  );
  const incidentIds = incidents.map((incident) => incident.id);
  if (new Set(incidentIds).size !== incidentIds.length) {
    throw new Error("Kraken Status payload contains duplicate incident ids");
  }
  return [...incidents].sort((left, right) => left.id.localeCompare(right.id));
}

export async function normaliseKrakenStatusIncidentCapture(
  contract: ExternalIntelligenceSourceContract,
  capture: ExternalIntelligencePayloadCapture,
  policy: ExternalIntelligencePolicy,
): Promise<NormalisedExternalIntelligenceCapture | null> {
  await assertKrakenManifest(contract, capture);
  const incidents = await parseKrakenStatusPayload(capture);
  if (incidents.length === 0) return null;
  const itemRecords = await Promise.all(
    incidents.map((incident) => itemRecordFor(incident, contract, capture)),
  );
  const assessmentRequests: ExternalIntelligenceAssessmentRequestInput[] =
    itemRecords.map((record) => ({
      topicKey: record.item.topicKey,
      eventType: "network-incident",
      stance: record.item.stance,
      itemIds: [record.item.itemId],
      policy,
    }));
  const result: NormalisedExternalIntelligenceCapture = {
    itemRecords,
    corrections: [],
    assessmentRequests,
  };
  if (canonicalIntelligenceJson(result).includes("payloadBytes")) {
    throw new Error("Kraken Status normalisation retained raw provider bytes");
  }
  return result;
}

export async function createKrakenStatusIncidentMinuteSource(
  contract: ExternalIntelligenceSourceContract,
  policy: ExternalIntelligencePolicy,
): Promise<MinuteExternalIntelligenceSource> {
  await assertKrakenManifest(contract);
  return {
    contract,
    target: {
      sourceId: KRAKEN_STATUS_INCIDENTS_SOURCE_ID,
      sourceRef: KRAKEN_STATUS_INCIDENTS_SOURCE_REF,
      acquisitionMode: "minute-poll",
      acceptedContentTypes: ["application/json"],
    },
    normaliseCapture: (capture) =>
      normaliseKrakenStatusIncidentCapture(contract, capture, policy),
  };
}
