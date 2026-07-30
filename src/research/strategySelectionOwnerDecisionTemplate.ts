import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import type {
  VerifiedStrategySelectionOwnerDecisionProposalAtTime,
} from "../storage/strategySelectionOwnerDecisionProposal.ts";

const RECORD_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

export const REQUIRED_OWNER_DECISION_TEMPLATE_WARNINGS = [
  "template-is-unsigned-and-records-no-owner-decision",
  "candidate-remains-unselected",
  "authorisation-remains-unconsumed",
  "separate-explicit-owner-selection-and-activation-remain-required",
] as const;

export interface StrategySelectionOwnerDecisionRecordTemplateInput {
  readonly templateId: string;
  readonly preparedAtMs: number;
  readonly verifiedProposal:
    VerifiedStrategySelectionOwnerDecisionProposalAtTime;
}

export interface StrategySelectionOwnerDecisionRecordTemplate {
  readonly schemaVersion:
    "strategy-selection-owner-decision-record-template-v1";
  readonly templateId: string;
  readonly preparedAtMs: number;
  readonly decisionProposalSha256: string;
  readonly ownerDecisionProposalVerificationSha256: string;
  readonly ownerDecision: null;
  readonly ownerDecisionRecordedAtMs: null;
  readonly ownerIdentityReference: null;
  readonly ownerSignatureSha256: null;
  readonly selectedConfigurationSha256: null;
  readonly selectedAuthorisationSha256: null;
  readonly activationRequestSha256: null;
  readonly ownerActionRequired: true;
  readonly templateStatus: "unsigned-uncompleted-owner-decision-template";
  readonly candidateStatus: "unselected";
  readonly selectionDecision: "none";
  readonly authorisationConsumed: false;
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly warnings: typeof REQUIRED_OWNER_DECISION_TEMPLATE_WARNINGS;
  readonly templateSha256: string;
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} is invalid`);
  }
}

async function assertVerifiedProposal(
  verified:
    VerifiedStrategySelectionOwnerDecisionProposalAtTime,
): Promise<void> {
  const {
    ownerDecisionProposalVerificationSha256:
      _ownerDecisionProposalVerificationSha256,
    ...verificationContent
  } = verified;
  const {
    decisionProposalSha256: _decisionProposalSha256,
    ...proposalContent
  } = verified.proposal;
  if (
    !SHA256_HEX.test(
      verified.ownerDecisionProposalVerificationSha256,
    ) ||
    !SHA256_HEX.test(verified.proposal.decisionProposalSha256) ||
    verified.schemaVersion !==
      "verified-strategy-selection-owner-decision-proposal-at-time-v1" ||
    verified.proposalStatus !== "verified-for-owner-decision-review" ||
    verified.ownerReviewAtMs < verified.proposal.preparedAtMs ||
    verified.candidateStatus !== "unselected" ||
    verified.selectionDecision !== "none" ||
    verified.authorisationConsumed !== false ||
    verified.activationAuthority !== "none" ||
    verified.executionAuthority !== "none" ||
    await sha256CanonicalIntelligence(verificationContent) !==
      verified.ownerDecisionProposalVerificationSha256 ||
    await sha256CanonicalIntelligence(proposalContent) !==
      verified.proposal.decisionProposalSha256
  ) {
    throw new Error(
      "owner decision record template evidence is invalid",
    );
  }
}

export async function prepareStrategySelectionOwnerDecisionRecordTemplate(
  input: StrategySelectionOwnerDecisionRecordTemplateInput,
): Promise<StrategySelectionOwnerDecisionRecordTemplate> {
  if (
    input.templateId.trim() !== input.templateId ||
    !RECORD_ID.test(input.templateId)
  ) {
    throw new Error("owner decision record template ID is invalid");
  }
  assertTimestamp("owner decision record template time", input.preparedAtMs);
  await assertVerifiedProposal(input.verifiedProposal);
  if (input.preparedAtMs !== input.verifiedProposal.ownerReviewAtMs) {
    throw new Error("owner decision record template is backdated");
  }
  const content = {
    schemaVersion: "strategy-selection-owner-decision-record-template-v1",
    templateId: input.templateId,
    preparedAtMs: input.preparedAtMs,
    decisionProposalSha256:
      input.verifiedProposal.proposal.decisionProposalSha256,
    ownerDecisionProposalVerificationSha256:
      input.verifiedProposal.ownerDecisionProposalVerificationSha256,
    ownerDecision: null,
    ownerDecisionRecordedAtMs: null,
    ownerIdentityReference: null,
    ownerSignatureSha256: null,
    selectedConfigurationSha256: null,
    selectedAuthorisationSha256: null,
    activationRequestSha256: null,
    ownerActionRequired: true,
    templateStatus: "unsigned-uncompleted-owner-decision-template",
    candidateStatus: "unselected",
    selectionDecision: "none",
    authorisationConsumed: false,
    activationAuthority: "none",
    executionAuthority: "none",
    warnings: REQUIRED_OWNER_DECISION_TEMPLATE_WARNINGS,
  } as const;
  return {
    ...content,
    templateSha256: await sha256CanonicalIntelligence(content),
  };
}

export async function verifyStrategySelectionOwnerDecisionRecordTemplate(
  template: StrategySelectionOwnerDecisionRecordTemplate,
  verifiedProposal:
    VerifiedStrategySelectionOwnerDecisionProposalAtTime,
): Promise<void> {
  const prepared =
    await prepareStrategySelectionOwnerDecisionRecordTemplate({
      templateId: template.templateId,
      preparedAtMs: template.preparedAtMs,
      verifiedProposal,
    });
  if (
    canonicalIntelligenceJson(prepared) !==
      canonicalIntelligenceJson(template)
  ) {
    throw new Error("owner decision record template identity is invalid");
  }
}
