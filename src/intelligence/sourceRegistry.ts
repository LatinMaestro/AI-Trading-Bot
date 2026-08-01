import type {
  IntelligenceAcquisitionMode,
  IntelligenceAuthority,
  IntelligenceContentPolicy,
  IntelligenceSourceKind,
} from "./externalIntelligence.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_RETENTION_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

const ACQUISITION_MODES = new Set<IntelligenceAcquisitionMode>([
  "webhook",
  "stream",
  "minute-poll",
  "scheduled-poll",
]);

const CONTENT_POLICIES = new Set<IntelligenceContentPolicy>([
  "digest-only",
  "metadata-only",
  "permitted-excerpt",
  "permitted-full",
]);

export type IntelligenceDeletionHandling = "required" | "not-applicable";

export interface ExternalIntelligenceSourceContractInput {
  readonly sourceId: string;
  readonly contractVersion: number;
  readonly sourceKind: IntelligenceSourceKind;
  readonly authority: IntelligenceAuthority;
  readonly publisherId: string;
  readonly providerId: string;
  readonly sourceOrigin: string;
  readonly allowedAcquisitionModes: readonly IntelligenceAcquisitionMode[];
  readonly contentPolicy: IntelligenceContentPolicy;
  readonly licenceRef: string;
  readonly licenceSha256: string;
  readonly attributionRequired: boolean;
  readonly maximumRetentionMs: number | null;
  readonly deletionHandling: IntelligenceDeletionHandling;
  readonly modelTrainingAllowed: false;
  readonly approvedAtMs: number;
  readonly effectiveFromMs: number;
  readonly expiresAtMs: number | null;
  readonly enabled: boolean;
}

export interface ExternalIntelligenceSourceContract
  extends ExternalIntelligenceSourceContractInput {
  readonly sourceContractSha256: string;
}

export function intelligenceAuthorityForSourceKind(
  sourceKind: IntelligenceSourceKind,
): IntelligenceAuthority {
  switch (sourceKind) {
    case "official-exchange":
    case "regulator":
    case "issuer":
      return "authoritative";
    case "mainstream-news":
    case "specialist-news":
      return "reputable";
    case "reddit":
      return "social";
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

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function canonicalHttpsUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (
    url.toString() !== value ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${name} must be canonical credential-free HTTPS`);
  }
  return url;
}

function assertSourceOrigin(value: string): void {
  const url = canonicalHttpsUrl("sourceOrigin", value);
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.port !== "" ||
    url.origin + "/" !== value
  ) {
    throw new Error("sourceOrigin must be a canonical HTTPS origin ending in /");
  }
}

function canonicalModes(
  values: readonly IntelligenceAcquisitionMode[],
): readonly IntelligenceAcquisitionMode[] {
  if (values.length < 1 || values.length > ACQUISITION_MODES.size) {
    throw new Error("allowedAcquisitionModes must contain 1 to 4 values");
  }
  for (const value of values) {
    if (!ACQUISITION_MODES.has(value)) {
      throw new Error(`Unsupported acquisition mode ${String(value)}`);
    }
  }
  const modes = [...new Set(values)].sort();
  if (modes.length !== values.length) {
    throw new Error("allowedAcquisitionModes contains duplicates");
  }
  return modes;
}

function validateContractInput(
  input: ExternalIntelligenceSourceContractInput,
): ExternalIntelligenceSourceContractInput {
  assertCanonicalText("sourceId", input.sourceId);
  assertCanonicalText("publisherId", input.publisherId);
  assertCanonicalText("providerId", input.providerId);
  if (
    !Number.isSafeInteger(input.contractVersion) ||
    input.contractVersion < 1 ||
    input.contractVersion > 1_000_000
  ) {
    throw new Error("contractVersion must be a positive bounded integer");
  }
  if (input.authority !== intelligenceAuthorityForSourceKind(input.sourceKind)) {
    throw new Error(`${input.sourceKind} has incompatible authority`);
  }
  assertSourceOrigin(input.sourceOrigin);
  const allowedAcquisitionModes = canonicalModes(input.allowedAcquisitionModes);
  if (!CONTENT_POLICIES.has(input.contentPolicy)) {
    throw new Error(`Unsupported content policy ${String(input.contentPolicy)}`);
  }
  canonicalHttpsUrl("licenceRef", input.licenceRef);
  assertDigest("licenceSha256", input.licenceSha256);
  if (
    input.maximumRetentionMs !== null &&
    (!Number.isSafeInteger(input.maximumRetentionMs) ||
      input.maximumRetentionMs < 1 ||
      input.maximumRetentionMs > MAXIMUM_RETENTION_MS)
  ) {
    throw new Error("maximumRetentionMs is outside the approved bounds");
  }
  if (
    input.deletionHandling !== "required" &&
    input.deletionHandling !== "not-applicable"
  ) {
    throw new Error("deletionHandling is invalid");
  }
  if (input.modelTrainingAllowed !== false) {
    throw new Error("External intelligence cannot be approved for model training");
  }
  assertTime("approvedAtMs", input.approvedAtMs);
  assertTime("effectiveFromMs", input.effectiveFromMs);
  if (input.approvedAtMs > input.effectiveFromMs) {
    throw new Error("Source contract approval must not follow its effective time");
  }
  if (input.expiresAtMs !== null) {
    assertTime("expiresAtMs", input.expiresAtMs);
    if (input.expiresAtMs <= input.effectiveFromMs) {
      throw new Error("Source contract expiry must follow its effective time");
    }
  }
  if (
    (input.contentPolicy === "permitted-excerpt" ||
      input.contentPolicy === "permitted-full") &&
    input.maximumRetentionMs === null
  ) {
    throw new Error("Stored publisher content requires a finite retention period");
  }
  if (
    (input.sourceKind === "mainstream-news" ||
      input.sourceKind === "specialist-news" ||
      input.sourceKind === "reddit") &&
    !input.attributionRequired
  ) {
    throw new Error("News and Reddit source contracts require attribution");
  }
  if (input.sourceKind === "reddit") {
    if (input.contentPolicy === "permitted-full") {
      throw new Error("Reddit full-content storage is prohibited by default");
    }
    if (
      input.deletionHandling !== "required" ||
      input.maximumRetentionMs === null
    ) {
      throw new Error("Reddit contracts require deletion handling and finite retention");
    }
  }
  return {
    sourceId: input.sourceId,
    contractVersion: input.contractVersion,
    sourceKind: input.sourceKind,
    authority: input.authority,
    publisherId: input.publisherId,
    providerId: input.providerId,
    sourceOrigin: input.sourceOrigin,
    allowedAcquisitionModes,
    contentPolicy: input.contentPolicy,
    licenceRef: input.licenceRef,
    licenceSha256: input.licenceSha256,
    attributionRequired: input.attributionRequired,
    maximumRetentionMs: input.maximumRetentionMs,
    deletionHandling: input.deletionHandling,
    modelTrainingAllowed: false,
    approvedAtMs: input.approvedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    enabled: input.enabled,
  };
}

export async function createExternalIntelligenceSourceContract(
  input: ExternalIntelligenceSourceContractInput,
): Promise<ExternalIntelligenceSourceContract> {
  const canonical = validateContractInput(input);
  return {
    ...canonical,
    sourceContractSha256: await sha256CanonicalIntelligence({
      schemaVersion: "external-intelligence-source-contract-v1",
      ...canonical,
    }),
  };
}

export async function verifyExternalIntelligenceSourceContract(
  contract: ExternalIntelligenceSourceContract,
): Promise<void> {
  assertDigest("sourceContractSha256", contract.sourceContractSha256);
  const { sourceContractSha256, ...input } = contract;
  const expected = await createExternalIntelligenceSourceContract(input);
  if (
    sourceContractSha256 !== expected.sourceContractSha256 ||
    canonicalIntelligenceJson(contract) !== canonicalIntelligenceJson(expected)
  ) {
    throw new Error("External intelligence source contract digest does not match");
  }
}

export function sourceContractAllowsReference(
  contract: ExternalIntelligenceSourceContract,
  sourceRef: string,
): boolean {
  let source: URL;
  let origin: URL;
  try {
    source = new URL(sourceRef);
    origin = new URL(contract.sourceOrigin);
  } catch {
    return false;
  }
  return (
    source.toString() === sourceRef &&
    source.protocol === "https:" &&
    source.username === "" &&
    source.password === "" &&
    source.hash === "" &&
    source.origin === origin.origin
  );
}
