import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";
import {
  KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
  KRAKEN_STATUS_API_REF,
  KRAKEN_STATUS_ORIGIN,
  KRAKEN_STATUS_PROVIDER_ID,
  KRAKEN_STATUS_PUBLISHER_ID,
} from "./krakenScheduledMaintenanceIntelligence.ts";
import {
  EXTERNAL_INTELLIGENCE_MINUTE_CRON,
  EXTERNAL_INTELLIGENCE_QUEUE_NAME,
} from "./externalIntelligenceRuntime.ts";
import {
  createExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "./sourceRegistry.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_REVIEW_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;

export interface KrakenMaintenanceActivationManifestInput {
  readonly licenceSha256: string;
  readonly approvedAtMs: number;
  readonly effectiveFromMs: number;
  readonly expiresAtMs: number;
}

export interface KrakenMaintenancePaperActivationManifest {
  readonly schemaVersion: "kraken-maintenance-paper-activation-manifest-v1";
  readonly deploymentTarget: "paper";
  readonly runtimeEnabledValue: "true";
  readonly minuteCron: typeof EXTERNAL_INTELLIGENCE_MINUTE_CRON;
  readonly queueName: typeof EXTERNAL_INTELLIGENCE_QUEUE_NAME;
  readonly sourceContract: ExternalIntelligenceSourceContract;
  readonly sourceContractJson: string;
  readonly activationManifestSha256: string;
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function validateInput(
  input: KrakenMaintenanceActivationManifestInput,
): void {
  if (!SHA256_PATTERN.test(input.licenceSha256)) {
    throw new Error("licenceSha256 must be lowercase SHA-256");
  }
  assertTime("approvedAtMs", input.approvedAtMs);
  assertTime("effectiveFromMs", input.effectiveFromMs);
  assertTime("expiresAtMs", input.expiresAtMs);
  if (
    input.approvedAtMs > input.effectiveFromMs ||
    input.expiresAtMs <= input.effectiveFromMs
  ) {
    throw new Error("Activation manifest chronology is invalid");
  }
  if (
    input.expiresAtMs - input.effectiveFromMs >
    MAXIMUM_REVIEW_WINDOW_MS
  ) {
    throw new Error(
      "Activation manifest review window cannot exceed 366 days",
    );
  }
}

export async function createKrakenMaintenancePaperActivationManifest(
  input: KrakenMaintenanceActivationManifestInput,
): Promise<KrakenMaintenancePaperActivationManifest> {
  validateInput(input);
  const sourceContract = await createExternalIntelligenceSourceContract({
    sourceId: KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
    contractVersion: 1,
    sourceKind: "official-exchange",
    authority: "authoritative",
    publisherId: KRAKEN_STATUS_PUBLISHER_ID,
    providerId: KRAKEN_STATUS_PROVIDER_ID,
    sourceOrigin: KRAKEN_STATUS_ORIGIN,
    allowedAcquisitionModes: ["minute-poll"],
    contentPolicy: "digest-only",
    licenceRef: KRAKEN_STATUS_API_REF,
    licenceSha256: input.licenceSha256,
    attributionRequired: false,
    maximumRetentionMs: null,
    deletionHandling: "not-applicable",
    modelTrainingAllowed: false,
    approvedAtMs: input.approvedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    enabled: true,
  });
  const sourceContractJson = canonicalIntelligenceJson(sourceContract);
  const canonical = {
    schemaVersion: "kraken-maintenance-paper-activation-manifest-v1",
    deploymentTarget: "paper",
    runtimeEnabledValue: "true",
    minuteCron: EXTERNAL_INTELLIGENCE_MINUTE_CRON,
    queueName: EXTERNAL_INTELLIGENCE_QUEUE_NAME,
    sourceContract,
    sourceContractJson,
  } as const;
  return {
    ...canonical,
    activationManifestSha256:
      await sha256CanonicalIntelligence(canonical),
  };
}
