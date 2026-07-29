import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  verifySignedStrategyAuthorisation,
  verifySignedStrategyConfiguration,
  type SignedStrategyAuthorisation,
} from "../security/signedStrategyConfiguration.ts";
import {
  resolveReviewedStrategySignerKey,
  type ReviewedStrategySignerTrustAnchor,
  type StrategySignerTrustRevocation,
} from "../security/strategySignerTrust.ts";
import type {
  VerifiedStrategyConfigurationAtTime,
} from "../storage/signedStrategyConfiguration.ts";

const RECORD_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;

export const STRATEGY_SELECTION_PROPOSAL_WARNINGS = [
  "five-year-objective-is-aspirational-not-a-forecast",
  "complete-approved-capital-loss-is-possible",
  "external-authorisation-does-not-select-or-activate",
  "separate-owner-activation-and-runtime-gates-remain-required",
] as const;

export interface StrategySelectionProposalInput {
  readonly proposalId: string;
  readonly proposedAtMs: number;
  readonly verifiedConfiguration: VerifiedStrategyConfigurationAtTime;
  readonly configurationSignerTrustAnchor:
    ReviewedStrategySignerTrustAnchor;
  readonly configurationSignerTrustRevocation:
    StrategySignerTrustRevocation | null;
  readonly authorisation: SignedStrategyAuthorisation;
  readonly authoriserTrustAnchor: ReviewedStrategySignerTrustAnchor;
  readonly authoriserTrustRevocation:
    StrategySignerTrustRevocation | null;
}

export interface StrategySelectionProposal {
  readonly schemaVersion: "strategy-selection-proposal-v1";
  readonly proposalId: string;
  readonly proposedAtMs: number;
  readonly verificationEvidenceSha256: string;
  readonly signedConfigurationSha256: string;
  readonly signedAuthorisationSha256: string;
  readonly authorisationScope:
    SignedStrategyAuthorisation["authorisationScope"];
  readonly maximumCapitalAud: number;
  readonly configurationSignerTrustAnchorSha256: string;
  readonly configurationSignerTrustRevocationSha256: string | null;
  readonly authoriserTrustAnchorSha256: string;
  readonly authoriserTrustRevocationSha256: string | null;
  readonly warnings: typeof STRATEGY_SELECTION_PROPOSAL_WARNINGS;
  readonly proposalStatus: "non-activating-review-proposal";
  readonly candidateStatus: "unselected";
  readonly selectionDecision: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly proposalSha256: string;
}

function assertCanonicalId(name: string, value: string): void {
  if (value.trim() !== value || !RECORD_ID.test(value)) {
    throw new Error(`${name} is not canonical`);
  }
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

async function assertVerifiedConfigurationIdentity(
  verified: VerifiedStrategyConfigurationAtTime,
): Promise<void> {
  const evidence = {
    schemaVersion: verified.schemaVersion,
    signedConfigurationSha256:
      verified.configuration.signedConfigurationSha256,
    decisionAtMs: verified.decisionAtMs,
    signerTrustAnchorSha256: verified.signerTrustAnchorSha256,
    signerTrustRevocationSha256:
      verified.signerTrustRevocationSha256,
    readinessAssessmentSha256:
      verified.readinessAssessmentSha256,
    completeEvaluationSha256: verified.completeEvaluationSha256,
    researchReportSha256: verified.researchReportSha256,
    executionCalibrationSha256:
      verified.executionCalibrationSha256,
    executionStressManifestSha256:
      verified.executionStressManifestSha256,
    selectionAuthority: verified.selectionAuthority,
    executionAuthority: verified.executionAuthority,
  } as const;
  if (
    verified.schemaVersion !==
      "verified-strategy-configuration-at-time-v1" ||
    verified.selectionAuthority !== "none" ||
    verified.executionAuthority !== "none" ||
    await sha256CanonicalIntelligence(evidence) !==
      verified.verificationEvidenceSha256
  ) {
    throw new Error("verified strategy configuration identity is invalid");
  }
}

export async function prepareStrategySelectionProposal(
  input: StrategySelectionProposalInput,
): Promise<StrategySelectionProposal> {
  assertCanonicalId("proposalId", input.proposalId);
  assertTimestamp("proposedAtMs", input.proposedAtMs);
  await assertVerifiedConfigurationIdentity(input.verifiedConfiguration);

  const configuration = input.verifiedConfiguration.configuration;
  if (
    input.verifiedConfiguration.decisionAtMs > input.proposedAtMs ||
    configuration.effectiveFromMs > input.proposedAtMs ||
    configuration.expiresAtMs <= input.proposedAtMs ||
    input.configurationSignerTrustAnchor.trustAnchorSha256 !==
      input.verifiedConfiguration.signerTrustAnchorSha256
  ) {
    throw new Error("selection proposal configuration evidence is invalid");
  }

  const configurationReviewedKey =
    await resolveReviewedStrategySignerKey({
      anchor: input.configurationSignerTrustAnchor,
      revocation: input.configurationSignerTrustRevocation,
      expectedRole: "strategy-configuration-signer",
      artifactTimeMs: configuration.issuedAtMs,
      checkedAtMs: input.proposedAtMs,
    });
  await verifySignedStrategyConfiguration(
    configuration,
    configurationReviewedKey,
  );

  const authorisation = input.authorisation;
  if (
    authorisation.signedConfigurationSha256 !==
      configuration.signedConfigurationSha256 ||
    authorisation.completeEvaluationSha256 !==
      input.verifiedConfiguration.completeEvaluationSha256 ||
    authorisation.readinessAssessmentSha256 !==
      input.verifiedConfiguration.readinessAssessmentSha256 ||
    authorisation.reviewedAtMs > input.proposedAtMs ||
    authorisation.effectiveFromMs > input.proposedAtMs ||
    authorisation.expiresAtMs <= input.proposedAtMs ||
    authorisation.standaloneExecutionAuthority !== "none" ||
    authorisation.requiresSeparateActivationChecklist !== true ||
    authorisation.maximumCapitalAud >
      configuration.configuration.maximumCapitalAud
  ) {
    throw new Error("selection proposal authorisation evidence is invalid");
  }

  const authorisationReviewedKey =
    await resolveReviewedStrategySignerKey({
      anchor: input.authoriserTrustAnchor,
      revocation: input.authoriserTrustRevocation,
      expectedRole: "external-strategy-authoriser",
      artifactTimeMs: authorisation.reviewedAtMs,
      checkedAtMs: input.proposedAtMs,
    });
  if (
    configurationReviewedKey.verificationKeySha256 ===
      authorisationReviewedKey.verificationKeySha256 ||
    configurationReviewedKey.keyId === authorisationReviewedKey.keyId
  ) {
    throw new Error("selection proposal cannot use self-authorisation");
  }
  await verifySignedStrategyAuthorisation(
    authorisation,
    configuration,
    configurationReviewedKey,
    authorisationReviewedKey,
  );

  const content = {
    schemaVersion: "strategy-selection-proposal-v1",
    proposalId: input.proposalId,
    proposedAtMs: input.proposedAtMs,
    verificationEvidenceSha256:
      input.verifiedConfiguration.verificationEvidenceSha256,
    signedConfigurationSha256:
      configuration.signedConfigurationSha256,
    signedAuthorisationSha256:
      authorisation.signedAuthorisationSha256,
    authorisationScope: authorisation.authorisationScope,
    maximumCapitalAud: authorisation.maximumCapitalAud,
    configurationSignerTrustAnchorSha256:
      input.configurationSignerTrustAnchor.trustAnchorSha256,
    configurationSignerTrustRevocationSha256:
      input.configurationSignerTrustRevocation?.revocationSha256 ?? null,
    authoriserTrustAnchorSha256:
      input.authoriserTrustAnchor.trustAnchorSha256,
    authoriserTrustRevocationSha256:
      input.authoriserTrustRevocation?.revocationSha256 ?? null,
    warnings: STRATEGY_SELECTION_PROPOSAL_WARNINGS,
    proposalStatus: "non-activating-review-proposal",
    candidateStatus: "unselected",
    selectionDecision: "none",
    activationAuthority: "none",
    executionAuthority: "none",
  } as const;
  return {
    ...content,
    proposalSha256: await sha256CanonicalIntelligence(content),
  };
}

export async function verifyStrategySelectionProposal(
  proposal: StrategySelectionProposal,
  input: StrategySelectionProposalInput,
): Promise<void> {
  const prepared = await prepareStrategySelectionProposal(input);
  if (
    canonicalIntelligenceJson(prepared) !==
      canonicalIntelligenceJson(proposal)
  ) {
    throw new Error("strategy selection proposal identity is invalid");
  }
}
