import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import type {
  VerifiedStrategySelectionProposalAtTime,
} from "../storage/strategySelectionProposal.ts";
import {
  deriveP256VerificationKeySha256,
} from "./signedStrategyConfiguration.ts";
import {
  resolveReviewedStrategySignerKey,
  type ReviewedStrategySignerTrustAnchor,
  type StrategySignerTrustRevocation,
} from "./strategySignerTrust.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const SIGNATURE_HEX = /^[0-9a-f]{128}$/u;
const RECORD_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const P256_COORDINATE = /^[A-Za-z0-9_-]{43}$/u;
const encoder = new TextEncoder();

export type StrategySelectionReviewDisposition =
  | "acknowledged-for-owner-review"
  | "deferred"
  | "rejected";

export interface UnsignedStrategySelectionReviewReceipt {
  readonly receiptId: string;
  readonly proposalSha256: string;
  readonly proposalVerificationSha256: string;
  readonly reviewedAtMs: number;
  readonly disposition: StrategySelectionReviewDisposition;
  readonly reviewEvidenceSha256: string;
  readonly reviewerKeyId: string;
}

export interface SignedStrategySelectionReviewReceipt
  extends UnsignedStrategySelectionReviewReceipt {
  readonly schemaVersion: "strategy-selection-review-receipt-v1";
  readonly proposalStatus: "non-activating-review-proposal";
  readonly candidateStatus: "unselected";
  readonly selectionDecision: "none";
  readonly authorisationConsumed: false;
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly verificationKeyJwkJson: string;
  readonly verificationKeySha256: string;
  readonly signatureHex: string;
  readonly signedPayloadJson: string;
  readonly signedPayloadSha256: string;
  readonly receiptSha256: string;
}

export interface SignedStrategySelectionReviewReceiptInput
  extends UnsignedStrategySelectionReviewReceipt {
  readonly verifiedProposal: VerifiedStrategySelectionProposalAtTime;
  readonly reviewerTrustAnchor: ReviewedStrategySignerTrustAnchor;
  readonly reviewerTrustRevocation: StrategySignerTrustRevocation | null;
  readonly verificationKeyJwk: JsonWebKey;
  readonly signatureHex: string;
}

interface CanonicalP256PublicKey {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
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

function canonicalP256PublicKey(jwk: JsonWebKey): CanonicalP256PublicKey {
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string" ||
    !P256_COORDINATE.test(jwk.x) ||
    !P256_COORDINATE.test(jwk.y) ||
    jwk.d !== undefined
  ) {
    throw new Error("review receipt key must be a public P-256 JWK");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

function signatureBytes(signatureHex: string): ArrayBuffer {
  if (!SIGNATURE_HEX.test(signatureHex)) {
    throw new Error("review receipt signature must be 64-byte lowercase hex");
  }
  const bytes = Uint8Array.from(
    signatureHex.match(/../gu) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function assertProposalIdentity(
  verified: VerifiedStrategySelectionProposalAtTime,
): Promise<void> {
  const proposal = verified.proposal;
  const { proposalSha256: _proposalSha256, ...content } = proposal;
  const {
    proposalVerificationSha256: _proposalVerificationSha256,
    ...verificationContent
  } = verified;
  if (
    verified.schemaVersion !==
      "verified-strategy-selection-proposal-at-time-v1" ||
    verified.configurationSignerTrustAnchorSha256 !==
      proposal.configurationSignerTrustAnchorSha256 ||
    verified.authoriserTrustAnchorSha256 !==
      proposal.authoriserTrustAnchorSha256 ||
    (
      verified.configurationSignerTrustRevocationSha256 !== null &&
      !SHA256_HEX.test(
        verified.configurationSignerTrustRevocationSha256,
      )
    ) ||
    (
      verified.authoriserTrustRevocationSha256 !== null &&
      !SHA256_HEX.test(verified.authoriserTrustRevocationSha256)
    ) ||
    proposal.schemaVersion !== "strategy-selection-proposal-v1" ||
    proposal.proposalStatus !== "non-activating-review-proposal" ||
    proposal.candidateStatus !== "unselected" ||
    proposal.selectionDecision !== "none" ||
    proposal.activationAuthority !== "none" ||
    proposal.executionAuthority !== "none" ||
    verified.candidateStatus !== "unselected" ||
    verified.selectionDecision !== "none" ||
    verified.authorisationConsumed !== false ||
    verified.activationAuthority !== "none" ||
    verified.executionAuthority !== "none" ||
    await sha256CanonicalIntelligence(content) !==
      proposal.proposalSha256 ||
    await sha256CanonicalIntelligence(verificationContent) !==
      verified.proposalVerificationSha256
  ) {
    throw new Error("review receipt proposal identity is invalid");
  }
}

function assertUnsignedReceipt(
  input: UnsignedStrategySelectionReviewReceipt,
  verifiedProposal: VerifiedStrategySelectionProposalAtTime,
): void {
  const proposal = verifiedProposal.proposal;
  assertCanonicalId("receiptId", input.receiptId);
  assertDigest("proposalSha256", input.proposalSha256);
  assertDigest(
    "proposalVerificationSha256",
    input.proposalVerificationSha256,
  );
  assertTimestamp("reviewedAtMs", input.reviewedAtMs);
  assertDigest("reviewEvidenceSha256", input.reviewEvidenceSha256);
  assertCanonicalId("reviewerKeyId", input.reviewerKeyId);
  if (
    ![
      "acknowledged-for-owner-review",
      "deferred",
      "rejected",
    ].includes(input.disposition) ||
    input.proposalSha256 !== proposal.proposalSha256 ||
    input.proposalVerificationSha256 !==
      verifiedProposal.proposalVerificationSha256 ||
    input.reviewedAtMs !== verifiedProposal.reviewedAtMs ||
    input.reviewedAtMs < proposal.proposedAtMs
  ) {
    throw new Error("strategy selection review receipt is invalid");
  }
}

export function strategySelectionReviewReceiptSigningPayload(
  input: UnsignedStrategySelectionReviewReceipt,
  verifiedProposal: VerifiedStrategySelectionProposalAtTime,
): string {
  assertUnsignedReceipt(input, verifiedProposal);
  return canonicalIntelligenceJson({
    schemaVersion: "strategy-selection-review-receipt-v1",
    receiptId: input.receiptId,
    proposalSha256: input.proposalSha256,
    proposalVerificationSha256: input.proposalVerificationSha256,
    reviewedAtMs: input.reviewedAtMs,
    disposition: input.disposition,
    reviewEvidenceSha256: input.reviewEvidenceSha256,
    reviewerKeyId: input.reviewerKeyId,
    proposalStatus: "non-activating-review-proposal",
    candidateStatus: "unselected",
    selectionDecision: "none",
    authorisationConsumed: false,
    activationAuthority: "none",
    executionAuthority: "none",
  });
}

export async function prepareSignedStrategySelectionReviewReceipt(
  input: SignedStrategySelectionReviewReceiptInput,
): Promise<SignedStrategySelectionReviewReceipt> {
  await assertProposalIdentity(input.verifiedProposal);
  if (
    input.reviewerTrustAnchor.trustAnchorSha256 !==
      input.verifiedProposal.authoriserTrustAnchorSha256
  ) {
    throw new Error("review receipt trust does not match the proposal");
  }
  const reviewedKey = await resolveReviewedStrategySignerKey({
    anchor: input.reviewerTrustAnchor,
    revocation: input.reviewerTrustRevocation,
    expectedRole: "external-strategy-authoriser",
    artifactTimeMs: input.reviewedAtMs,
    checkedAtMs: input.reviewedAtMs,
  });
  const publicKey = canonicalP256PublicKey(input.verificationKeyJwk);
  const verificationKeySha256 =
    await deriveP256VerificationKeySha256(publicKey);
  if (
    input.reviewerKeyId !== reviewedKey.keyId ||
    verificationKeySha256 !== reviewedKey.verificationKeySha256
  ) {
    throw new Error("review receipt key does not match reviewed trust");
  }
  const signedPayloadJson =
    strategySelectionReviewReceiptSigningPayload(
      input,
      input.verifiedProposal,
    );
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { ...publicKey, ext: true, key_ops: ["verify"] },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      signatureBytes(input.signatureHex),
      encoder.encode(signedPayloadJson),
    ))
  ) {
    throw new Error("review receipt signature verification failed");
  }
  const signedPayloadSha256 =
    await sha256CanonicalIntelligence(JSON.parse(signedPayloadJson));
  const envelope = {
    schemaVersion: "strategy-selection-review-receipt-v1",
    receiptId: input.receiptId,
    proposalSha256: input.proposalSha256,
    proposalVerificationSha256: input.proposalVerificationSha256,
    reviewedAtMs: input.reviewedAtMs,
    disposition: input.disposition,
    reviewEvidenceSha256: input.reviewEvidenceSha256,
    reviewerKeyId: input.reviewerKeyId,
    proposalStatus: "non-activating-review-proposal",
    candidateStatus: "unselected",
    selectionDecision: "none",
    authorisationConsumed: false,
    activationAuthority: "none",
    executionAuthority: "none",
    verificationKeyJwkJson: canonicalIntelligenceJson(publicKey),
    verificationKeySha256,
    signatureHex: input.signatureHex,
    signedPayloadJson,
    signedPayloadSha256,
  } as const;
  return {
    ...envelope,
    receiptSha256: await sha256CanonicalIntelligence({
      schemaVersion: "strategy-selection-review-receipt-envelope-v1",
      proposalSha256: input.proposalSha256,
      proposalVerificationSha256: input.proposalVerificationSha256,
      signedPayloadSha256,
      verificationKeySha256,
      signatureHex: input.signatureHex,
      authorisationConsumed: false,
      activationAuthority: "none",
      executionAuthority: "none",
    }),
  };
}

export async function verifySignedStrategySelectionReviewReceipt(
  receipt: SignedStrategySelectionReviewReceipt,
  verifiedProposal: VerifiedStrategySelectionProposalAtTime,
  reviewerTrustAnchor: ReviewedStrategySignerTrustAnchor,
  reviewerTrustRevocation: StrategySignerTrustRevocation | null,
): Promise<void> {
  let verificationKeyJwk: JsonWebKey;
  try {
    verificationKeyJwk = JSON.parse(receipt.verificationKeyJwkJson) as
      JsonWebKey;
  } catch {
    throw new Error("review receipt verification key JSON is invalid");
  }
  const prepared = await prepareSignedStrategySelectionReviewReceipt({
    receiptId: receipt.receiptId,
    proposalSha256: receipt.proposalSha256,
    proposalVerificationSha256:
      receipt.proposalVerificationSha256,
    reviewedAtMs: receipt.reviewedAtMs,
    disposition: receipt.disposition,
    reviewEvidenceSha256: receipt.reviewEvidenceSha256,
    reviewerKeyId: receipt.reviewerKeyId,
    verifiedProposal,
    reviewerTrustAnchor,
    reviewerTrustRevocation,
    verificationKeyJwk,
    signatureHex: receipt.signatureHex,
  });
  if (
    canonicalIntelligenceJson(prepared) !==
      canonicalIntelligenceJson(receipt)
  ) {
    throw new Error("strategy selection review receipt identity is invalid");
  }
}
