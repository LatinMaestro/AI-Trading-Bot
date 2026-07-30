import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
import {
  prepareStrategySelectionOwnerDecisionProposal,
  verifyStrategySelectionOwnerDecisionProposal,
  type StrategySelectionOwnerDecisionProposal,
} from "../research/strategySelectionOwnerDecisionProposal.ts";
import {
  StrategySelectionReviewReceiptRepository,
  type VerifiedStrategySelectionReviewReceiptAtTime,
} from "./strategySelectionReviewReceipt.ts";
import type {
  SignedStrategyPersistenceStatement,
} from "./signedStrategyConfiguration.ts";

export interface StrategySelectionOwnerDecisionProposalSelector {
  readonly receiptSha256: string;
  readonly ownerDecisionAtMs: number;
  readonly decisionProposalId: string;
}

export interface StrategySelectionOwnerDecisionProposalPersistenceInput {
  readonly verifiedReceipt:
    VerifiedStrategySelectionReviewReceiptAtTime;
  readonly proposal: StrategySelectionOwnerDecisionProposal;
  readonly persistedAtMs: number;
}

interface PersistedOwnerDecisionProposalRow {
  readonly decision_proposal_sha256: string;
  readonly decision_proposal_id: string;
  readonly prepared_at_ms: number;
  readonly receipt_sha256: string;
  readonly receipt_verification_sha256: string;
  readonly proposal_canonical_json: string;
  readonly persisted_at_ms: number;
}

export const INSERT_STRATEGY_SELECTION_RECEIPT_VERIFICATION_SQL =
  `INSERT INTO hourly_trend_breakout_strategy_selection_receipt_verifications
    (receipt_verification_sha256, schema_version, receipt_sha256,
     owner_decision_at_ms, current_proposal_verification_sha256,
     signed_configuration_sha256, signed_authorisation_sha256,
     authorisation_scope, maximum_capital_aud,
     configuration_signer_trust_anchor_sha256,
     configuration_signer_trust_revocation_sha256,
     reviewer_trust_anchor_sha256, reviewer_trust_revocation_sha256,
     receipt_status, candidate_status, selection_decision,
     authorisation_consumed, activation_authority, execution_authority,
     verification_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

export const INSERT_STRATEGY_SELECTION_OWNER_DECISION_PROPOSAL_SQL =
  `INSERT INTO hourly_trend_breakout_strategy_selection_owner_decision_proposals
    (decision_proposal_sha256, schema_version, decision_proposal_id,
     prepared_at_ms, receipt_sha256, receipt_verification_sha256,
     proposal_sha256, current_proposal_verification_sha256,
     signed_configuration_sha256, signed_authorisation_sha256,
     authorisation_scope, maximum_capital_aud, owner_action_required,
     owner_decision_status, proposal_status, candidate_status,
     selection_decision, authorisation_consumed, activation_authority,
     execution_authority, warnings_json, proposal_canonical_json,
     persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?)
   ON CONFLICT DO NOTHING`;

const SELECT_OWNER_DECISION_PROPOSAL_SQL =
  `SELECT decision_proposal_sha256, decision_proposal_id, prepared_at_ms,
          receipt_sha256, receipt_verification_sha256,
          proposal_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_strategy_selection_owner_decision_proposals
   WHERE decision_proposal_sha256 = ?`;

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} is invalid`);
  }
}

export async function prepareStrategySelectionOwnerDecisionProposalPersistence(
  input: StrategySelectionOwnerDecisionProposalPersistenceInput,
): Promise<readonly SignedStrategyPersistenceStatement[]> {
  assertTimestamp(
    "strategy selection owner decision proposal persistence time",
    input.persistedAtMs,
  );
  if (input.persistedAtMs < input.proposal.preparedAtMs) {
    throw new Error("strategy selection owner decision proposal is backdated");
  }
  await verifyStrategySelectionOwnerDecisionProposal(
    input.proposal,
    input.verifiedReceipt,
  );
  if (
    input.proposal.preparedAtMs !==
      input.verifiedReceipt.ownerDecisionAtMs ||
    input.proposal.receiptSha256 !==
      input.verifiedReceipt.receipt.receiptSha256 ||
    input.proposal.receiptVerificationSha256 !==
      input.verifiedReceipt.receiptVerificationSha256
  ) {
    throw new Error(
      "strategy selection owner decision proposal binding is invalid",
    );
  }
  return [
    {
      sql: INSERT_STRATEGY_SELECTION_RECEIPT_VERIFICATION_SQL,
      params: [
        input.verifiedReceipt.receiptVerificationSha256,
        input.verifiedReceipt.schemaVersion,
        input.verifiedReceipt.receipt.receiptSha256,
        input.verifiedReceipt.ownerDecisionAtMs,
        input.verifiedReceipt.currentProposalVerificationSha256,
        input.verifiedReceipt.signedConfigurationSha256,
        input.verifiedReceipt.signedAuthorisationSha256,
        input.verifiedReceipt.authorisationScope,
        input.verifiedReceipt.maximumCapitalAud,
        input.verifiedReceipt.configurationSignerTrustAnchorSha256,
        input.verifiedReceipt.configurationSignerTrustRevocationSha256,
        input.verifiedReceipt.reviewerTrustAnchorSha256,
        input.verifiedReceipt.reviewerTrustRevocationSha256,
        input.verifiedReceipt.receiptStatus,
        input.verifiedReceipt.candidateStatus,
        input.verifiedReceipt.selectionDecision,
        input.verifiedReceipt.authorisationConsumed ? 1 : 0,
        input.verifiedReceipt.activationAuthority,
        input.verifiedReceipt.executionAuthority,
        canonicalIntelligenceJson(input.verifiedReceipt),
        input.persistedAtMs,
      ],
    },
    {
      sql: INSERT_STRATEGY_SELECTION_OWNER_DECISION_PROPOSAL_SQL,
      params: [
        input.proposal.decisionProposalSha256,
        input.proposal.schemaVersion,
        input.proposal.decisionProposalId,
        input.proposal.preparedAtMs,
        input.proposal.receiptSha256,
        input.proposal.receiptVerificationSha256,
        input.proposal.proposalSha256,
        input.proposal.currentProposalVerificationSha256,
        input.proposal.signedConfigurationSha256,
        input.proposal.signedAuthorisationSha256,
        input.proposal.authorisationScope,
        input.proposal.maximumCapitalAud,
        input.proposal.ownerActionRequired ? 1 : 0,
        input.proposal.ownerDecisionStatus,
        input.proposal.proposalStatus,
        input.proposal.candidateStatus,
        input.proposal.selectionDecision,
        input.proposal.authorisationConsumed ? 1 : 0,
        input.proposal.activationAuthority,
        input.proposal.executionAuthority,
        canonicalIntelligenceJson(input.proposal.warnings),
        canonicalIntelligenceJson(input.proposal),
        input.persistedAtMs,
      ],
    },
  ];
}

function rowMatches(
  row: PersistedOwnerDecisionProposalRow,
  proposal: StrategySelectionOwnerDecisionProposal,
  persistedAtMs: number,
): boolean {
  return (
    row.decision_proposal_sha256 === proposal.decisionProposalSha256 &&
    row.decision_proposal_id === proposal.decisionProposalId &&
    row.prepared_at_ms === proposal.preparedAtMs &&
    row.receipt_sha256 === proposal.receiptSha256 &&
    row.receipt_verification_sha256 ===
      proposal.receiptVerificationSha256 &&
    row.proposal_canonical_json === canonicalIntelligenceJson(proposal) &&
    row.persisted_at_ms >= proposal.preparedAtMs &&
    row.persisted_at_ms <= persistedAtMs
  );
}

export class StrategySelectionOwnerDecisionProposalRepository {
  private readonly db: D1Database;
  private readonly receiptRepository:
    StrategySelectionReviewReceiptRepository;

  constructor(db: D1Database) {
    this.db = db;
    this.receiptRepository =
      new StrategySelectionReviewReceiptRepository(db);
  }

  async persistAtTime(
    selector: StrategySelectionOwnerDecisionProposalSelector,
    persistedAtMs: number,
  ): Promise<StrategySelectionOwnerDecisionProposal> {
    const verifiedReceipt =
      await this.receiptRepository.loadPersistedAtTime(
        selector.receiptSha256,
        selector.ownerDecisionAtMs,
      );
    const proposal =
      await prepareStrategySelectionOwnerDecisionProposal({
        decisionProposalId: selector.decisionProposalId,
        preparedAtMs: selector.ownerDecisionAtMs,
        verifiedReceipt,
      });
    const statements =
      await prepareStrategySelectionOwnerDecisionProposalPersistence({
        verifiedReceipt,
        proposal,
        persistedAtMs,
      });
    for (const statement of statements) {
      await this.db.prepare(statement.sql)
        .bind(...statement.params)
        .run();
    }
    const row = await this.db.prepare(SELECT_OWNER_DECISION_PROPOSAL_SQL)
      .bind(proposal.decisionProposalSha256)
      .first<PersistedOwnerDecisionProposalRow>();
    if (row === null || !rowMatches(row, proposal, persistedAtMs)) {
      throw new Error(
        "persisted strategy selection owner decision proposal is invalid",
      );
    }
    return proposal;
  }
}
