import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import type {
  VerifiedStrategySelectionReviewReceiptAtTime,
} from "../storage/strategySelectionReviewReceipt.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const RECORD_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;

export const REQUIRED_OWNER_DECISION_PROPOSAL_WARNINGS = [
  "five-year-objective-is-aspirational-not-a-forecast",
  "complete-approved-capital-loss-is-possible",
  "review-receipt-does-not-imply-owner-selection",
  "separate-explicit-owner-decision-and-activation-remain-required",
] as const;

export interface StrategySelectionOwnerDecisionProposalInput {
  readonly decisionProposalId: string;
  readonly preparedAtMs: number;
  readonly verifiedReceipt:
    VerifiedStrategySelectionReviewReceiptAtTime;
}

export interface StrategySelectionOwnerDecisionProposal {
  readonly schemaVersion: "strategy-selection-owner-decision-proposal-v1";
  readonly decisionProposalId: string;
  readonly preparedAtMs: number;
  readonly receiptSha256: string;
  readonly receiptVerificationSha256: string;
  readonly proposalSha256: string;
  readonly currentProposalVerificationSha256: string;
  readonly signedConfigurationSha256: string;
  readonly signedAuthorisationSha256: string;
  readonly authorisationScope: "paper" | "shadow" | "canary-live";
  readonly maximumCapitalAud: number;
  readonly ownerActionRequired: true;
  readonly ownerDecisionStatus: "pending-explicit-owner-decision";
  readonly proposalStatus: "non-activating-owner-decision-proposal";
  readonly candidateStatus: "unselected";
  readonly selectionDecision: "none";
  readonly authorisationConsumed: false;
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly warnings: typeof REQUIRED_OWNER_DECISION_PROPOSAL_WARNINGS;
  readonly decisionProposalSha256: string;
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) throw new Error(`${name} is not SHA-256`);
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} is invalid`);
  }
}

async function verifyReceiptIdentity(
  verified: VerifiedStrategySelectionReviewReceiptAtTime,
): Promise<void> {
  const {
    receiptVerificationSha256: _receiptVerificationSha256,
    ...content
  } = verified;
  assertDigest(
    "review receipt verification",
    verified.receiptVerificationSha256,
  );
  assertDigest("review receipt", verified.receipt.receiptSha256);
  assertDigest(
    "current proposal verification",
    verified.currentProposalVerificationSha256,
  );
  assertDigest(
    "signed strategy configuration",
    verified.signedConfigurationSha256,
  );
  assertDigest(
    "signed strategy authorisation",
    verified.signedAuthorisationSha256,
  );
  if (
    verified.schemaVersion !==
      "verified-strategy-selection-review-receipt-at-time-v1" ||
    verified.ownerDecisionAtMs < verified.receipt.reviewedAtMs ||
    verified.receipt.disposition !== "acknowledged-for-owner-review" ||
    verified.receipt.proposalStatus !==
      "non-activating-review-proposal" ||
    verified.receipt.candidateStatus !== "unselected" ||
    verified.receipt.selectionDecision !== "none" ||
    verified.receipt.authorisationConsumed !== false ||
    verified.receipt.activationAuthority !== "none" ||
    verified.receipt.executionAuthority !== "none" ||
    verified.receiptStatus !== "verified-for-owner-decision" ||
    verified.candidateStatus !== "unselected" ||
    verified.selectionDecision !== "none" ||
    verified.authorisationConsumed !== false ||
    verified.activationAuthority !== "none" ||
    verified.executionAuthority !== "none" ||
    await sha256CanonicalIntelligence(content) !==
      verified.receiptVerificationSha256
  ) {
    throw new Error(
      "owner decision proposal requires an acknowledged exact receipt",
    );
  }
}

export async function prepareStrategySelectionOwnerDecisionProposal(
  input: StrategySelectionOwnerDecisionProposalInput,
): Promise<StrategySelectionOwnerDecisionProposal> {
  if (
    input.decisionProposalId.trim() !== input.decisionProposalId ||
    !RECORD_ID.test(input.decisionProposalId)
  ) {
    throw new Error("owner decision proposal ID is invalid");
  }
  assertTimestamp("owner decision proposal time", input.preparedAtMs);
  await verifyReceiptIdentity(input.verifiedReceipt);
  const receipt = input.verifiedReceipt.receipt;
  if (
    input.preparedAtMs !== input.verifiedReceipt.ownerDecisionAtMs ||
    receipt.proposalSha256.length !== 64 ||
    input.verifiedReceipt.maximumCapitalAud <= 0 ||
    !Number.isFinite(input.verifiedReceipt.maximumCapitalAud)
  ) {
    throw new Error("owner decision proposal evidence is invalid");
  }
  const content = {
    schemaVersion: "strategy-selection-owner-decision-proposal-v1",
    decisionProposalId: input.decisionProposalId,
    preparedAtMs: input.preparedAtMs,
    receiptSha256: receipt.receiptSha256,
    receiptVerificationSha256:
      input.verifiedReceipt.receiptVerificationSha256,
    proposalSha256: receipt.proposalSha256,
    currentProposalVerificationSha256:
      input.verifiedReceipt.currentProposalVerificationSha256,
    signedConfigurationSha256:
      input.verifiedReceipt.signedConfigurationSha256,
    signedAuthorisationSha256:
      input.verifiedReceipt.signedAuthorisationSha256,
    authorisationScope: input.verifiedReceipt.authorisationScope,
    maximumCapitalAud: input.verifiedReceipt.maximumCapitalAud,
    ownerActionRequired: true,
    ownerDecisionStatus: "pending-explicit-owner-decision",
    proposalStatus: "non-activating-owner-decision-proposal",
    candidateStatus: "unselected",
    selectionDecision: "none",
    authorisationConsumed: false,
    activationAuthority: "none",
    executionAuthority: "none",
    warnings: REQUIRED_OWNER_DECISION_PROPOSAL_WARNINGS,
  } as const;
  return {
    ...content,
    decisionProposalSha256:
      await sha256CanonicalIntelligence(content),
  };
}

export async function verifyStrategySelectionOwnerDecisionProposal(
  proposal: StrategySelectionOwnerDecisionProposal,
  verifiedReceipt: VerifiedStrategySelectionReviewReceiptAtTime,
): Promise<void> {
  const prepared =
    await prepareStrategySelectionOwnerDecisionProposal({
      decisionProposalId: proposal.decisionProposalId,
      preparedAtMs: proposal.preparedAtMs,
      verifiedReceipt,
    });
  if (
    canonicalIntelligenceJson(prepared) !==
      canonicalIntelligenceJson(proposal)
  ) {
    throw new Error("owner decision proposal identity is invalid");
  }
}
