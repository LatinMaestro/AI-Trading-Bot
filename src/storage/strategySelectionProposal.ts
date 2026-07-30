import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  prepareStrategySelectionProposal,
  type StrategySelectionProposal,
} from "../research/strategySelectionProposal.ts";
import type {
  SignedStrategyAuthorisation,
} from "../security/signedStrategyConfiguration.ts";
import type {
  ReviewedStrategySignerTrustAnchor,
  StrategySignerTrustRevocation,
} from "../security/strategySignerTrust.ts";
import {
  SignedStrategyConfigurationRepository,
  type SignedStrategyPersistenceStatement,
  type VerifiedStrategyConfigurationAtTime,
} from "./signedStrategyConfiguration.ts";

export interface StrategySelectionProposalPersistenceInput {
  readonly proposal: StrategySelectionProposal;
  readonly persistedAtMs: number;
}

export interface StrategySelectionProposalSelector {
  readonly proposalId: string;
  readonly proposedAtMs: number;
  readonly verificationEvidenceSha256: string;
  readonly signedAuthorisationSha256: string;
}

interface PersistedVerificationRow {
  readonly verification_evidence_sha256: string;
  readonly signed_configuration_sha256: string;
  readonly decision_at_ms: number;
  readonly evidence_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedAuthorisationRow {
  readonly signed_authorisation_sha256: string;
  readonly signed_configuration_sha256: string;
  readonly authoriser_trust_anchor_sha256: string;
  readonly authorisation_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedTrustAnchorRow {
  readonly trust_anchor_sha256: string;
  readonly trust_anchor_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedTrustRevocationRow {
  readonly revocation_sha256: string;
  readonly trust_anchor_sha256: string;
  readonly revocation_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedProposalRow {
  readonly proposal_sha256: string;
  readonly proposal_id: string;
  readonly proposed_at_ms: number;
  readonly verification_evidence_sha256: string;
  readonly signed_configuration_sha256: string;
  readonly signed_authorisation_sha256: string;
  readonly authorisation_scope: string;
  readonly maximum_capital_aud: number;
  readonly configuration_signer_trust_anchor_sha256: string;
  readonly configuration_signer_trust_revocation_sha256: string | null;
  readonly authoriser_trust_anchor_sha256: string;
  readonly authoriser_trust_revocation_sha256: string | null;
  readonly warnings_json: string;
  readonly proposal_status: string;
  readonly candidate_status: string;
  readonly selection_decision: string;
  readonly activation_authority: string;
  readonly execution_authority: string;
  readonly proposal_canonical_json: string;
  readonly persisted_at_ms: number;
}

export const INSERT_STRATEGY_SELECTION_PROPOSAL_SQL =
  `INSERT INTO hourly_trend_breakout_strategy_selection_proposals
    (proposal_sha256, schema_version, proposal_id, proposed_at_ms,
     verification_evidence_sha256, signed_configuration_sha256,
     signed_authorisation_sha256, authorisation_scope,
     maximum_capital_aud, configuration_signer_trust_anchor_sha256,
     configuration_signer_trust_revocation_sha256,
     authoriser_trust_anchor_sha256,
     authoriser_trust_revocation_sha256, warnings_json,
     proposal_status, candidate_status, selection_decision,
     activation_authority, execution_authority,
     proposal_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

const SELECT_VERIFICATION_SQL =
  `SELECT verification_evidence_sha256, signed_configuration_sha256,
          decision_at_ms, evidence_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_verified_configurations
   WHERE verification_evidence_sha256 = ?`;

const SELECT_AUTHORISATION_SQL =
  `SELECT signed_authorisation_sha256, signed_configuration_sha256,
          authoriser_trust_anchor_sha256,
          authorisation_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_strategy_authorisations
   WHERE signed_authorisation_sha256 = ?`;

const SELECT_TRUST_ANCHOR_SQL =
  `SELECT trust_anchor_sha256, trust_anchor_canonical_json,
          persisted_at_ms
   FROM strategy_signer_trust_anchors
   WHERE trust_anchor_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_TRUST_REVOCATION_SQL =
  `SELECT revocation_sha256, trust_anchor_sha256,
          revocation_canonical_json, persisted_at_ms
   FROM strategy_signer_trust_revocations
   WHERE trust_anchor_sha256 = ?
     AND persisted_at_ms <= ?
     AND reviewed_at_ms <= ?`;

const SELECT_PROPOSAL_SQL =
  `SELECT proposal_sha256, proposal_id, proposed_at_ms,
          verification_evidence_sha256, signed_configuration_sha256,
          signed_authorisation_sha256, authorisation_scope,
          maximum_capital_aud,
          configuration_signer_trust_anchor_sha256,
          configuration_signer_trust_revocation_sha256,
          authoriser_trust_anchor_sha256,
          authoriser_trust_revocation_sha256, warnings_json,
          proposal_status, candidate_status, selection_decision,
          activation_authority, execution_authority,
          proposal_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_strategy_selection_proposals
   WHERE proposal_sha256 = ?`;

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const RECORD_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) throw new Error(`${name} is not SHA-256`);
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} is invalid`);
  }
}

function parseCanonicalJson<T>(name: string, value: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    canonicalIntelligenceJson(parsed) !== value
  ) {
    throw new Error(`${name} is not canonical JSON`);
  }
  return parsed as T;
}

function assertKnownAt(
  name: string,
  persistedAtMs: number,
  proposedAtMs: number,
): void {
  if (
    !Number.isSafeInteger(persistedAtMs) ||
    persistedAtMs < 0 ||
    persistedAtMs > proposedAtMs
  ) {
    throw new Error(`${name} was unavailable at proposal time`);
  }
}

function verificationEvidence(
  verification: VerifiedStrategyConfigurationAtTime,
) {
  return {
    schemaVersion: verification.schemaVersion,
    signedConfigurationSha256:
      verification.configuration.signedConfigurationSha256,
    decisionAtMs: verification.decisionAtMs,
    signerTrustAnchorSha256:
      verification.signerTrustAnchorSha256,
    signerTrustRevocationSha256:
      verification.signerTrustRevocationSha256,
    readinessAssessmentSha256:
      verification.readinessAssessmentSha256,
    completeEvaluationSha256:
      verification.completeEvaluationSha256,
    researchReportSha256: verification.researchReportSha256,
    executionCalibrationSha256:
      verification.executionCalibrationSha256,
    executionStressManifestSha256:
      verification.executionStressManifestSha256,
    selectionAuthority: verification.selectionAuthority,
    executionAuthority: verification.executionAuthority,
  } as const;
}

function proposalContent(proposal: StrategySelectionProposal) {
  const { proposalSha256: _proposalSha256, ...content } = proposal;
  return content;
}

export async function prepareStrategySelectionProposalPersistence(
  input: StrategySelectionProposalPersistenceInput,
): Promise<SignedStrategyPersistenceStatement> {
  const content = proposalContent(input.proposal);
  if (
    input.proposal.schemaVersion !== "strategy-selection-proposal-v1" ||
    input.proposal.candidateStatus !== "unselected" ||
    input.proposal.selectionDecision !== "none" ||
    input.proposal.activationAuthority !== "none" ||
    input.proposal.executionAuthority !== "none" ||
    await sha256CanonicalIntelligence(content) !==
      input.proposal.proposalSha256
  ) {
    throw new Error("strategy selection proposal identity is invalid");
  }
  assertTimestamp(
    "strategy selection proposal persistence time",
    input.persistedAtMs,
  );
  if (input.persistedAtMs < input.proposal.proposedAtMs) {
    throw new Error("strategy selection proposal persistence is backdated");
  }
  return {
    sql: INSERT_STRATEGY_SELECTION_PROPOSAL_SQL,
    params: [
      input.proposal.proposalSha256,
      input.proposal.schemaVersion,
      input.proposal.proposalId,
      input.proposal.proposedAtMs,
      input.proposal.verificationEvidenceSha256,
      input.proposal.signedConfigurationSha256,
      input.proposal.signedAuthorisationSha256,
      input.proposal.authorisationScope,
      input.proposal.maximumCapitalAud,
      input.proposal.configurationSignerTrustAnchorSha256,
      input.proposal.configurationSignerTrustRevocationSha256,
      input.proposal.authoriserTrustAnchorSha256,
      input.proposal.authoriserTrustRevocationSha256,
      canonicalIntelligenceJson(input.proposal.warnings),
      input.proposal.proposalStatus,
      input.proposal.candidateStatus,
      input.proposal.selectionDecision,
      input.proposal.activationAuthority,
      input.proposal.executionAuthority,
      canonicalIntelligenceJson(content),
      input.persistedAtMs,
    ],
  };
}

function proposalRowMatches(
  row: PersistedProposalRow,
  input: StrategySelectionProposalPersistenceInput,
): boolean {
  const proposal = input.proposal;
  return (
    row.proposal_sha256 === proposal.proposalSha256 &&
    row.proposal_id === proposal.proposalId &&
    row.proposed_at_ms === proposal.proposedAtMs &&
    row.verification_evidence_sha256 ===
      proposal.verificationEvidenceSha256 &&
    row.signed_configuration_sha256 ===
      proposal.signedConfigurationSha256 &&
    row.signed_authorisation_sha256 ===
      proposal.signedAuthorisationSha256 &&
    row.authorisation_scope === proposal.authorisationScope &&
    row.maximum_capital_aud === proposal.maximumCapitalAud &&
    row.configuration_signer_trust_anchor_sha256 ===
      proposal.configurationSignerTrustAnchorSha256 &&
    row.configuration_signer_trust_revocation_sha256 ===
      proposal.configurationSignerTrustRevocationSha256 &&
    row.authoriser_trust_anchor_sha256 ===
      proposal.authoriserTrustAnchorSha256 &&
    row.authoriser_trust_revocation_sha256 ===
      proposal.authoriserTrustRevocationSha256 &&
    row.warnings_json === canonicalIntelligenceJson(proposal.warnings) &&
    row.proposal_status === proposal.proposalStatus &&
    row.candidate_status === proposal.candidateStatus &&
    row.selection_decision === proposal.selectionDecision &&
    row.activation_authority === proposal.activationAuthority &&
    row.execution_authority === proposal.executionAuthority &&
    row.proposal_canonical_json ===
      canonicalIntelligenceJson(proposalContent(proposal)) &&
    row.persisted_at_ms >= proposal.proposedAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

export class StrategySelectionProposalRepository {
  private readonly db: D1Database;
  private readonly configurationRepository:
    SignedStrategyConfigurationRepository;

  constructor(db: D1Database) {
    this.db = db;
    this.configurationRepository =
      new SignedStrategyConfigurationRepository(db);
  }

  private async loadTrust(
    trustAnchorSha256: string,
    proposedAtMs: number,
    name: string,
  ): Promise<{
    readonly anchor: ReviewedStrategySignerTrustAnchor;
    readonly revocation: StrategySignerTrustRevocation | null;
  }> {
    const [anchorRow, revocationRow] = await Promise.all([
      this.db.prepare(SELECT_TRUST_ANCHOR_SQL)
        .bind(trustAnchorSha256, proposedAtMs)
        .first<PersistedTrustAnchorRow>(),
      this.db.prepare(SELECT_TRUST_REVOCATION_SQL)
        .bind(trustAnchorSha256, proposedAtMs, proposedAtMs)
        .first<PersistedTrustRevocationRow>(),
    ]);
    if (anchorRow === null) {
      throw new Error(`${name} trust is unavailable`);
    }
    assertKnownAt(name, anchorRow.persisted_at_ms, proposedAtMs);
    const anchor = parseCanonicalJson<ReviewedStrategySignerTrustAnchor>(
      `${name} trust`,
      anchorRow.trust_anchor_canonical_json,
    );
    if (
      anchor.trustAnchorSha256 !== anchorRow.trust_anchor_sha256 ||
      anchor.trustAnchorSha256 !== trustAnchorSha256
    ) {
      throw new Error(`${name} trust binding is invalid`);
    }
    if (revocationRow === null) return { anchor, revocation: null };
    assertKnownAt(
      `${name} revocation`,
      revocationRow.persisted_at_ms,
      proposedAtMs,
    );
    const revocation =
      parseCanonicalJson<StrategySignerTrustRevocation>(
        `${name} revocation`,
        revocationRow.revocation_canonical_json,
      );
    if (
      revocation.revocationSha256 !== revocationRow.revocation_sha256 ||
      revocation.trustAnchorSha256 !==
        revocationRow.trust_anchor_sha256 ||
      revocation.trustAnchorSha256 !== anchor.trustAnchorSha256
    ) {
      throw new Error(`${name} revocation binding is invalid`);
    }
    return { anchor, revocation };
  }

  async prepareAtTime(
    selector: StrategySelectionProposalSelector,
  ): Promise<StrategySelectionProposal> {
    if (
      selector.proposalId.trim() !== selector.proposalId ||
      !RECORD_ID.test(selector.proposalId)
    ) {
      throw new Error("strategy selection proposal ID is invalid");
    }
    assertTimestamp(
      "strategy selection proposal time",
      selector.proposedAtMs,
    );
    assertDigest(
      "verified strategy configuration selector",
      selector.verificationEvidenceSha256,
    );
    assertDigest(
      "signed strategy authorisation selector",
      selector.signedAuthorisationSha256,
    );
    const [verificationRow, authorisationRow] = await Promise.all([
      this.db.prepare(SELECT_VERIFICATION_SQL)
        .bind(selector.verificationEvidenceSha256)
        .first<PersistedVerificationRow>(),
      this.db.prepare(SELECT_AUTHORISATION_SQL)
        .bind(selector.signedAuthorisationSha256)
        .first<PersistedAuthorisationRow>(),
    ]);
    if (verificationRow === null) {
      throw new Error("verified strategy configuration is unavailable");
    }
    if (authorisationRow === null) {
      throw new Error("signed strategy authorisation is unavailable");
    }
    assertKnownAt(
      "verified strategy configuration",
      verificationRow.persisted_at_ms,
      selector.proposedAtMs,
    );
    assertKnownAt(
      "signed strategy authorisation",
      authorisationRow.persisted_at_ms,
      selector.proposedAtMs,
    );
    const verifiedConfiguration =
      await this.configurationRepository.loadVerifiedConfigurationAtTime(
        verificationRow.signed_configuration_sha256,
        verificationRow.decision_at_ms,
      );
    if (
      verifiedConfiguration.verificationEvidenceSha256 !==
        selector.verificationEvidenceSha256 ||
      verificationRow.verification_evidence_sha256 !==
        selector.verificationEvidenceSha256 ||
      verificationRow.evidence_canonical_json !==
        canonicalIntelligenceJson(
          verificationEvidence(verifiedConfiguration),
        )
    ) {
      throw new Error("verified strategy configuration binding is invalid");
    }
    const authorisation =
      parseCanonicalJson<SignedStrategyAuthorisation>(
        "signed strategy authorisation",
        authorisationRow.authorisation_canonical_json,
      );
    if (
      authorisation.signedAuthorisationSha256 !==
        authorisationRow.signed_authorisation_sha256 ||
      authorisation.signedAuthorisationSha256 !==
        selector.signedAuthorisationSha256 ||
      authorisation.signedConfigurationSha256 !==
        authorisationRow.signed_configuration_sha256 ||
      authorisation.signedConfigurationSha256 !==
        verifiedConfiguration.configuration.signedConfigurationSha256
    ) {
      throw new Error("signed strategy authorisation binding is invalid");
    }
    const [configurationTrust, authoriserTrust] = await Promise.all([
      this.loadTrust(
        verifiedConfiguration.signerTrustAnchorSha256,
        selector.proposedAtMs,
        "strategy configuration signer",
      ),
      this.loadTrust(
        authorisationRow.authoriser_trust_anchor_sha256,
        selector.proposedAtMs,
        "external strategy authoriser",
      ),
    ]);
    return prepareStrategySelectionProposal({
      proposalId: selector.proposalId,
      proposedAtMs: selector.proposedAtMs,
      verifiedConfiguration,
      configurationSignerTrustAnchor: configurationTrust.anchor,
      configurationSignerTrustRevocation:
        configurationTrust.revocation,
      authorisation,
      authoriserTrustAnchor: authoriserTrust.anchor,
      authoriserTrustRevocation: authoriserTrust.revocation,
    });
  }

  async persistAtTime(
    selector: StrategySelectionProposalSelector,
    persistedAtMs: number,
  ): Promise<StrategySelectionProposal> {
    const proposal = await this.prepareAtTime(selector);
    const input = { proposal, persistedAtMs };
    const statement =
      await prepareStrategySelectionProposalPersistence(input);
    await this.db.prepare(statement.sql)
      .bind(...statement.params)
      .run();
    const row = await this.db.prepare(SELECT_PROPOSAL_SQL)
      .bind(proposal.proposalSha256)
      .first<PersistedProposalRow>();
    if (row === null || !proposalRowMatches(row, input)) {
      throw new Error("persisted strategy selection proposal is invalid");
    }
    return proposal;
  }
}
