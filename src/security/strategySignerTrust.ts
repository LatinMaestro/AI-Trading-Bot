import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import type {
  ReviewedP256VerificationKey,
} from "./signedStrategyConfiguration.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const RECORD_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const MAXIMUM_TRUST_VALIDITY_MS = 366 * 86_400_000;

export type StrategySignerRole =
  | "strategy-configuration-signer"
  | "external-strategy-authoriser";

export type StrategySignerRevocationReason =
  | "suspected-compromise"
  | "planned-rotation"
  | "review-withdrawn"
  | "key-retired"
  | "other-security-event";

export interface ReviewedStrategySignerTrustAnchorInput {
  readonly trustAnchorId: string;
  readonly role: StrategySignerRole;
  readonly keyId: string;
  readonly verificationKeySha256: string;
  readonly reviewEvidenceSha256: string;
  readonly reviewedAtMs: number;
  readonly validFromMs: number;
  readonly validUntilMs: number;
  readonly predecessorTrustAnchorSha256: string | null;
}

export interface ReviewedStrategySignerTrustAnchor
  extends ReviewedStrategySignerTrustAnchorInput {
  readonly executionAuthority: "none";
  readonly trustAnchorSha256: string;
}

export interface StrategySignerTrustRevocationInput {
  readonly revocationId: string;
  readonly trustAnchorSha256: string;
  readonly reason: StrategySignerRevocationReason;
  readonly effectiveAtMs: number;
  readonly reviewedAtMs: number;
  readonly reviewEvidenceSha256: string;
}

export interface StrategySignerTrustRevocation
  extends StrategySignerTrustRevocationInput {
  readonly executionAuthority: "none";
  readonly revocationSha256: string;
}

export interface StrategySignerTrustAtTime {
  readonly anchor: ReviewedStrategySignerTrustAnchor;
  readonly revocation: StrategySignerTrustRevocation | null;
  readonly expectedRole: StrategySignerRole;
  readonly artifactTimeMs: number;
  readonly checkedAtMs: number;
}

function assertCanonicalId(name: string, value: string): void {
  if (value.trim() !== value || !RECORD_ID.test(value)) {
    throw new Error(`${name} is not canonical`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) throw new Error(`${name} is not SHA-256`);
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertRole(role: StrategySignerRole): void {
  if (
    role !== "strategy-configuration-signer" &&
    role !== "external-strategy-authoriser"
  ) {
    throw new Error("strategy signer role is invalid");
  }
}

function assertAnchorInput(
  input: ReviewedStrategySignerTrustAnchorInput,
): void {
  assertCanonicalId("trustAnchorId", input.trustAnchorId);
  assertRole(input.role);
  assertCanonicalId("keyId", input.keyId);
  assertDigest("verificationKeySha256", input.verificationKeySha256);
  assertDigest("reviewEvidenceSha256", input.reviewEvidenceSha256);
  assertTimestamp("reviewedAtMs", input.reviewedAtMs);
  assertTimestamp("validFromMs", input.validFromMs);
  assertTimestamp("validUntilMs", input.validUntilMs);
  if (
    input.reviewedAtMs > input.validFromMs ||
    input.validFromMs >= input.validUntilMs ||
    input.validUntilMs - input.validFromMs > MAXIMUM_TRUST_VALIDITY_MS
  ) {
    throw new Error("strategy signer trust chronology is invalid");
  }
  if (input.predecessorTrustAnchorSha256 !== null) {
    assertDigest(
      "predecessorTrustAnchorSha256",
      input.predecessorTrustAnchorSha256,
    );
  }
}

function assertRevocationInput(
  input: StrategySignerTrustRevocationInput,
): void {
  assertCanonicalId("revocationId", input.revocationId);
  assertDigest("trustAnchorSha256", input.trustAnchorSha256);
  if (
    ![
      "suspected-compromise",
      "planned-rotation",
      "review-withdrawn",
      "key-retired",
      "other-security-event",
    ].includes(input.reason)
  ) {
    throw new Error("strategy signer revocation reason is invalid");
  }
  assertTimestamp("effectiveAtMs", input.effectiveAtMs);
  assertTimestamp("reviewedAtMs", input.reviewedAtMs);
  assertDigest("reviewEvidenceSha256", input.reviewEvidenceSha256);
}

export async function prepareReviewedStrategySignerTrustAnchor(
  input: ReviewedStrategySignerTrustAnchorInput,
): Promise<ReviewedStrategySignerTrustAnchor> {
  assertAnchorInput(input);
  const content = {
    ...input,
    executionAuthority: "none",
  } as const;
  return {
    ...content,
    trustAnchorSha256: await sha256CanonicalIntelligence({
      schemaVersion: "strategy-signer-trust-anchor-v1",
      ...content,
    }),
  };
}

export async function verifyReviewedStrategySignerTrustAnchor(
  anchor: ReviewedStrategySignerTrustAnchor,
): Promise<void> {
  const prepared = await prepareReviewedStrategySignerTrustAnchor({
    trustAnchorId: anchor.trustAnchorId,
    role: anchor.role,
    keyId: anchor.keyId,
    verificationKeySha256: anchor.verificationKeySha256,
    reviewEvidenceSha256: anchor.reviewEvidenceSha256,
    reviewedAtMs: anchor.reviewedAtMs,
    validFromMs: anchor.validFromMs,
    validUntilMs: anchor.validUntilMs,
    predecessorTrustAnchorSha256:
      anchor.predecessorTrustAnchorSha256,
  });
  if (canonicalIntelligenceJson(prepared) !== canonicalIntelligenceJson(anchor)) {
    throw new Error("strategy signer trust anchor identity is invalid");
  }
}

export async function prepareStrategySignerTrustRevocation(
  input: StrategySignerTrustRevocationInput,
  anchor: ReviewedStrategySignerTrustAnchor,
): Promise<StrategySignerTrustRevocation> {
  await verifyReviewedStrategySignerTrustAnchor(anchor);
  assertRevocationInput(input);
  if (
    input.trustAnchorSha256 !== anchor.trustAnchorSha256 ||
    input.effectiveAtMs < anchor.validFromMs ||
    input.effectiveAtMs >= anchor.validUntilMs ||
    input.reviewedAtMs < anchor.reviewedAtMs
  ) {
    throw new Error("strategy signer revocation anchor is invalid");
  }
  const content = {
    ...input,
    executionAuthority: "none",
  } as const;
  return {
    ...content,
    revocationSha256: await sha256CanonicalIntelligence({
      schemaVersion: "strategy-signer-trust-revocation-v1",
      ...content,
    }),
  };
}

export async function verifyStrategySignerTrustRevocation(
  revocation: StrategySignerTrustRevocation,
  anchor: ReviewedStrategySignerTrustAnchor,
): Promise<void> {
  const prepared = await prepareStrategySignerTrustRevocation(
    {
      revocationId: revocation.revocationId,
      trustAnchorSha256: revocation.trustAnchorSha256,
      reason: revocation.reason,
      effectiveAtMs: revocation.effectiveAtMs,
      reviewedAtMs: revocation.reviewedAtMs,
      reviewEvidenceSha256: revocation.reviewEvidenceSha256,
    },
    anchor,
  );
  if (
    canonicalIntelligenceJson(prepared) !==
      canonicalIntelligenceJson(revocation)
  ) {
    throw new Error("strategy signer revocation identity is invalid");
  }
}

export async function resolveReviewedStrategySignerKey(
  input: StrategySignerTrustAtTime,
): Promise<ReviewedP256VerificationKey> {
  await verifyReviewedStrategySignerTrustAnchor(input.anchor);
  assertRole(input.expectedRole);
  assertTimestamp("artifactTimeMs", input.artifactTimeMs);
  assertTimestamp("checkedAtMs", input.checkedAtMs);
  if (
    input.anchor.role !== input.expectedRole ||
    input.artifactTimeMs < input.anchor.validFromMs ||
    input.artifactTimeMs >= input.anchor.validUntilMs ||
    input.checkedAtMs < input.artifactTimeMs ||
    input.checkedAtMs >= input.anchor.validUntilMs
  ) {
    throw new Error("strategy signer trust is not active");
  }
  if (input.revocation !== null) {
    await verifyStrategySignerTrustRevocation(
      input.revocation,
      input.anchor,
    );
    if (
      input.revocation.reviewedAtMs <= input.checkedAtMs &&
      input.revocation.effectiveAtMs <= input.checkedAtMs
    ) {
      throw new Error("strategy signer trust is revoked");
    }
  }
  return {
    keyId: input.anchor.keyId,
    verificationKeySha256: input.anchor.verificationKeySha256,
  };
}
