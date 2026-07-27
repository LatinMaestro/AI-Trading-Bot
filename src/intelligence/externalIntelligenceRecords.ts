import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "./canonical.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type ExternalIntelligenceCorrectionKind =
  | "content-update"
  | "retraction"
  | "deletion";

export interface ExternalIntelligenceCorrectionInput {
  readonly itemId: string;
  readonly sourceId: string;
  readonly externalId: string;
  readonly providerEventId: string;
  readonly correctionKind: ExternalIntelligenceCorrectionKind;
  readonly observedAtMs: number;
  readonly reasonCode: string;
  readonly replacementPayloadSha256: string | null;
  readonly replacementContentSha256: string | null;
}

export interface ExternalIntelligenceCorrection
  extends ExternalIntelligenceCorrectionInput {
  readonly correctionSha256: string;
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

function assertNullableDigest(name: string, value: string | null): void {
  if (value !== null && !SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be null or lowercase SHA-256`);
  }
}

function validateCorrectionInput(
  input: ExternalIntelligenceCorrectionInput,
): ExternalIntelligenceCorrectionInput {
  assertCanonicalText("itemId", input.itemId);
  assertCanonicalText("sourceId", input.sourceId);
  assertCanonicalText("externalId", input.externalId);
  assertCanonicalText("providerEventId", input.providerEventId);
  assertCanonicalText("reasonCode", input.reasonCode);
  assertTime("observedAtMs", input.observedAtMs);
  assertNullableDigest(
    "replacementPayloadSha256",
    input.replacementPayloadSha256,
  );
  assertNullableDigest(
    "replacementContentSha256",
    input.replacementContentSha256,
  );
  if (input.correctionKind === "content-update") {
    if (
      input.replacementPayloadSha256 === null ||
      input.replacementContentSha256 === null
    ) {
      throw new Error("Content updates require replacement payload and content digests");
    }
  } else if (
    input.correctionKind === "retraction" ||
    input.correctionKind === "deletion"
  ) {
    if (
      input.replacementPayloadSha256 !== null ||
      input.replacementContentSha256 !== null
    ) {
      throw new Error("Retractions and deletions cannot retain replacement content");
    }
  } else {
    throw new Error(`Unsupported correction kind ${String(input.correctionKind)}`);
  }
  return {
    itemId: input.itemId,
    sourceId: input.sourceId,
    externalId: input.externalId,
    providerEventId: input.providerEventId,
    correctionKind: input.correctionKind,
    observedAtMs: input.observedAtMs,
    reasonCode: input.reasonCode,
    replacementPayloadSha256: input.replacementPayloadSha256,
    replacementContentSha256: input.replacementContentSha256,
  };
}

export async function createExternalIntelligenceCorrection(
  input: ExternalIntelligenceCorrectionInput,
): Promise<ExternalIntelligenceCorrection> {
  const canonical = validateCorrectionInput(input);
  return {
    ...canonical,
    correctionSha256: await sha256CanonicalIntelligence({
      schemaVersion: "external-intelligence-correction-v1",
      ...canonical,
    }),
  };
}

export async function verifyExternalIntelligenceCorrection(
  correction: ExternalIntelligenceCorrection,
): Promise<void> {
  if (!SHA256_PATTERN.test(correction.correctionSha256)) {
    throw new Error("correctionSha256 must be lowercase SHA-256");
  }
  const { correctionSha256, ...input } = correction;
  const expected = await createExternalIntelligenceCorrection(input);
  if (
    correctionSha256 !== expected.correctionSha256 ||
    canonicalIntelligenceJson(correction) !== canonicalIntelligenceJson(expected)
  ) {
    throw new Error("External intelligence correction digest does not match");
  }
}
