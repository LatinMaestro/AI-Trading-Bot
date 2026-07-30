import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  verifySignedStrategySelectionReviewReceipt,
  type SignedStrategySelectionReviewReceipt,
} from "../security/strategySelectionReviewReceipt.ts";
import type {
  ReviewedStrategySignerTrustAnchor,
  StrategySignerTrustRevocation,
} from "../security/strategySignerTrust.ts";
import {
  StrategySelectionProposalRepository,
  type VerifiedStrategySelectionProposalAtTime,
} from "./strategySelectionProposal.ts";
import type {
  SignedStrategyPersistenceStatement,
} from "./signedStrategyConfiguration.ts";

export interface StrategySelectionReviewReceiptPersistenceInput {
  readonly receipt: SignedStrategySelectionReviewReceipt;
  readonly verifiedProposal: VerifiedStrategySelectionProposalAtTime;
  readonly reviewerTrustAnchor: ReviewedStrategySignerTrustAnchor;
  readonly reviewerTrustRevocation: StrategySignerTrustRevocation | null;
  readonly persistedAtMs: number;
}

export interface VerifiedStrategySelectionReviewReceiptAtTime {
  readonly schemaVersion:
    "verified-strategy-selection-review-receipt-at-time-v1";
  readonly receipt: SignedStrategySelectionReviewReceipt;
  readonly ownerDecisionAtMs: number;
  readonly currentProposalVerificationSha256: string;
  readonly signedConfigurationSha256: string;
  readonly signedAuthorisationSha256: string;
  readonly authorisationScope: "paper" | "shadow" | "canary-live";
  readonly maximumCapitalAud: number;
  readonly configurationSignerTrustAnchorSha256: string;
  readonly configurationSignerTrustRevocationSha256: string | null;
  readonly reviewerTrustAnchorSha256: string;
  readonly reviewerTrustRevocationSha256: string | null;
  readonly receiptStatus: "verified-for-owner-decision";
  readonly candidateStatus: "unselected";
  readonly selectionDecision: "none";
  readonly authorisationConsumed: false;
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly receiptVerificationSha256: string;
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

interface PersistedReviewReceiptRow {
  readonly receipt_sha256: string;
  readonly receipt_id: string;
  readonly proposal_sha256: string;
  readonly proposal_verification_sha256: string;
  readonly reviewed_at_ms: number;
  readonly disposition: string;
  readonly review_evidence_sha256: string;
  readonly reviewer_key_id: string;
  readonly reviewer_trust_anchor_sha256: string;
  readonly reviewer_trust_revocation_sha256: string | null;
  readonly candidate_status: string;
  readonly selection_decision: string;
  readonly authorisation_consumed: number;
  readonly activation_authority: string;
  readonly execution_authority: string;
  readonly verification_key_jwk_json: string;
  readonly verification_key_sha256: string;
  readonly signature_hex: string;
  readonly signed_payload_json: string;
  readonly signed_payload_sha256: string;
  readonly receipt_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedProposalVerificationRow {
  readonly proposal_verification_sha256: string;
  readonly proposal_sha256: string;
  readonly reviewed_at_ms: number;
  readonly verification_canonical_json: string;
  readonly persisted_at_ms: number;
}

export const INSERT_STRATEGY_SELECTION_PROPOSAL_VERIFICATION_SQL =
  `INSERT INTO hourly_trend_breakout_strategy_selection_proposal_verifications
    (proposal_verification_sha256, schema_version, proposal_sha256,
     reviewed_at_ms, configuration_signer_trust_anchor_sha256,
     configuration_signer_trust_revocation_sha256,
     authoriser_trust_anchor_sha256,
     authoriser_trust_revocation_sha256, candidate_status,
     selection_decision, authorisation_consumed, activation_authority,
     execution_authority, verification_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

export const INSERT_STRATEGY_SELECTION_REVIEW_RECEIPT_SQL =
  `INSERT INTO hourly_trend_breakout_strategy_selection_review_receipts
    (receipt_sha256, schema_version, receipt_id, proposal_sha256,
     proposal_verification_sha256, reviewed_at_ms, disposition,
     review_evidence_sha256, reviewer_key_id,
     reviewer_trust_anchor_sha256,
     reviewer_trust_revocation_sha256, proposal_status,
     candidate_status, selection_decision, authorisation_consumed,
     activation_authority, execution_authority,
     verification_key_jwk_json, verification_key_sha256,
     signature_hex, signed_payload_json, signed_payload_sha256,
     receipt_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?)
   ON CONFLICT DO NOTHING`;

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

const SELECT_REVIEW_RECEIPT_SQL =
  `SELECT receipt_sha256, receipt_id, proposal_sha256,
          proposal_verification_sha256, reviewed_at_ms,
          disposition, review_evidence_sha256, reviewer_key_id,
          reviewer_trust_anchor_sha256,
          reviewer_trust_revocation_sha256, candidate_status,
          selection_decision, authorisation_consumed,
          activation_authority, execution_authority,
          verification_key_jwk_json, verification_key_sha256,
          signature_hex, signed_payload_json, signed_payload_sha256,
          receipt_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_strategy_selection_review_receipts
   WHERE receipt_sha256 = ?`;

const SELECT_PROPOSAL_VERIFICATION_SQL =
  `SELECT proposal_verification_sha256, proposal_sha256,
          reviewed_at_ms, verification_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_strategy_selection_proposal_verifications
   WHERE proposal_verification_sha256 = ?`;

const SHA256_HEX = /^[0-9a-f]{64}$/u;

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

function proposalVerificationContent(
  verified: VerifiedStrategySelectionProposalAtTime,
) {
  const {
    proposalVerificationSha256: _proposalVerificationSha256,
    ...content
  } = verified;
  return content;
}

export async function prepareStrategySelectionReviewReceiptPersistence(
  input: StrategySelectionReviewReceiptPersistenceInput,
): Promise<readonly SignedStrategyPersistenceStatement[]> {
  assertTimestamp(
    "strategy selection review receipt persistence time",
    input.persistedAtMs,
  );
  if (input.persistedAtMs < input.receipt.reviewedAtMs) {
    throw new Error("strategy selection review receipt is backdated");
  }
  if (
    !SHA256_HEX.test(input.receipt.receiptSha256) ||
    await sha256CanonicalIntelligence(
      proposalVerificationContent(input.verifiedProposal),
    ) !== input.verifiedProposal.proposalVerificationSha256 ||
    input.receipt.proposalVerificationSha256 !==
      input.verifiedProposal.proposalVerificationSha256 ||
    input.receipt.proposalSha256 !==
      input.verifiedProposal.proposal.proposalSha256 ||
    input.receipt.reviewedAtMs !== input.verifiedProposal.reviewedAtMs ||
    input.reviewerTrustAnchor.trustAnchorSha256 !==
      input.verifiedProposal.authoriserTrustAnchorSha256 ||
    (input.reviewerTrustRevocation?.revocationSha256 ?? null) !==
      input.verifiedProposal.authoriserTrustRevocationSha256
  ) {
    throw new Error("strategy selection review receipt binding is invalid");
  }
  await verifySignedStrategySelectionReviewReceipt(
    input.receipt,
    input.verifiedProposal,
    input.reviewerTrustAnchor,
    input.reviewerTrustRevocation,
  );
  return [
    {
      sql: INSERT_STRATEGY_SELECTION_PROPOSAL_VERIFICATION_SQL,
      params: [
        input.verifiedProposal.proposalVerificationSha256,
        input.verifiedProposal.schemaVersion,
        input.verifiedProposal.proposal.proposalSha256,
        input.verifiedProposal.reviewedAtMs,
        input.verifiedProposal.configurationSignerTrustAnchorSha256,
        input.verifiedProposal.configurationSignerTrustRevocationSha256,
        input.verifiedProposal.authoriserTrustAnchorSha256,
        input.verifiedProposal.authoriserTrustRevocationSha256,
        input.verifiedProposal.candidateStatus,
        input.verifiedProposal.selectionDecision,
        input.verifiedProposal.authorisationConsumed ? 1 : 0,
        input.verifiedProposal.activationAuthority,
        input.verifiedProposal.executionAuthority,
        canonicalIntelligenceJson(input.verifiedProposal),
        input.persistedAtMs,
      ],
    },
    {
      sql: INSERT_STRATEGY_SELECTION_REVIEW_RECEIPT_SQL,
      params: [
        input.receipt.receiptSha256,
        input.receipt.schemaVersion,
        input.receipt.receiptId,
        input.receipt.proposalSha256,
        input.receipt.proposalVerificationSha256,
        input.receipt.reviewedAtMs,
        input.receipt.disposition,
        input.receipt.reviewEvidenceSha256,
        input.receipt.reviewerKeyId,
        input.reviewerTrustAnchor.trustAnchorSha256,
        input.reviewerTrustRevocation?.revocationSha256 ?? null,
        input.receipt.proposalStatus,
        input.receipt.candidateStatus,
        input.receipt.selectionDecision,
        input.receipt.authorisationConsumed ? 1 : 0,
        input.receipt.activationAuthority,
        input.receipt.executionAuthority,
        input.receipt.verificationKeyJwkJson,
        input.receipt.verificationKeySha256,
        input.receipt.signatureHex,
        input.receipt.signedPayloadJson,
        input.receipt.signedPayloadSha256,
        canonicalIntelligenceJson(input.receipt),
        input.persistedAtMs,
      ],
    },
  ];
}

function receiptRowMatches(
  row: PersistedReviewReceiptRow,
  input: StrategySelectionReviewReceiptPersistenceInput,
): boolean {
  return (
    row.receipt_sha256 === input.receipt.receiptSha256 &&
    row.receipt_id === input.receipt.receiptId &&
    row.proposal_sha256 === input.receipt.proposalSha256 &&
    row.proposal_verification_sha256 ===
      input.receipt.proposalVerificationSha256 &&
    row.reviewed_at_ms === input.receipt.reviewedAtMs &&
    row.disposition === input.receipt.disposition &&
    row.review_evidence_sha256 ===
      input.receipt.reviewEvidenceSha256 &&
    row.reviewer_key_id === input.receipt.reviewerKeyId &&
    row.reviewer_trust_anchor_sha256 ===
      input.reviewerTrustAnchor.trustAnchorSha256 &&
    row.reviewer_trust_revocation_sha256 ===
      (input.reviewerTrustRevocation?.revocationSha256 ?? null) &&
    row.candidate_status === "unselected" &&
    row.selection_decision === "none" &&
    row.authorisation_consumed === 0 &&
    row.activation_authority === "none" &&
    row.execution_authority === "none" &&
    row.verification_key_jwk_json ===
      input.receipt.verificationKeyJwkJson &&
    row.verification_key_sha256 ===
      input.receipt.verificationKeySha256 &&
    row.signature_hex === input.receipt.signatureHex &&
    row.signed_payload_json === input.receipt.signedPayloadJson &&
    row.signed_payload_sha256 === input.receipt.signedPayloadSha256 &&
    row.receipt_canonical_json ===
      canonicalIntelligenceJson(input.receipt) &&
    row.persisted_at_ms >= input.receipt.reviewedAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

export class StrategySelectionReviewReceiptRepository {
  private readonly db: D1Database;
  private readonly proposalRepository: StrategySelectionProposalRepository;

  constructor(db: D1Database) {
    this.db = db;
    this.proposalRepository = new StrategySelectionProposalRepository(db);
  }

  private async loadReviewerTrust(
    trustAnchorSha256: string,
    reviewedAtMs: number,
  ): Promise<{
    readonly anchor: ReviewedStrategySignerTrustAnchor;
    readonly revocation: StrategySignerTrustRevocation | null;
  }> {
    const [anchorRow, revocationRow] = await Promise.all([
      this.db.prepare(SELECT_TRUST_ANCHOR_SQL)
        .bind(trustAnchorSha256, reviewedAtMs)
        .first<PersistedTrustAnchorRow>(),
      this.db.prepare(SELECT_TRUST_REVOCATION_SQL)
        .bind(trustAnchorSha256, reviewedAtMs, reviewedAtMs)
        .first<PersistedTrustRevocationRow>(),
    ]);
    if (anchorRow === null) {
      throw new Error("review receipt trust is unavailable");
    }
    const anchor = parseCanonicalJson<ReviewedStrategySignerTrustAnchor>(
      "review receipt trust",
      anchorRow.trust_anchor_canonical_json,
    );
    if (
      anchorRow.persisted_at_ms > reviewedAtMs ||
      anchor.trustAnchorSha256 !== anchorRow.trust_anchor_sha256 ||
      anchor.trustAnchorSha256 !== trustAnchorSha256
    ) {
      throw new Error("review receipt trust binding is invalid");
    }
    if (revocationRow === null) return { anchor, revocation: null };
    const revocation =
      parseCanonicalJson<StrategySignerTrustRevocation>(
        "review receipt trust revocation",
        revocationRow.revocation_canonical_json,
      );
    if (
      revocationRow.persisted_at_ms > reviewedAtMs ||
      revocation.revocationSha256 !== revocationRow.revocation_sha256 ||
      revocation.trustAnchorSha256 !==
        revocationRow.trust_anchor_sha256 ||
      revocation.trustAnchorSha256 !== trustAnchorSha256
    ) {
      throw new Error("review receipt trust revocation binding is invalid");
    }
    return { anchor, revocation };
  }

  async persistAtTime(
    receipt: SignedStrategySelectionReviewReceipt,
    persistedAtMs: number,
  ): Promise<SignedStrategySelectionReviewReceipt> {
    const verifiedProposal =
      await this.proposalRepository.loadPersistedAtTime(
        receipt.proposalSha256,
        receipt.reviewedAtMs,
      );
    const trust = await this.loadReviewerTrust(
      verifiedProposal.authoriserTrustAnchorSha256,
      receipt.reviewedAtMs,
    );
    const input = {
      receipt,
      verifiedProposal,
      reviewerTrustAnchor: trust.anchor,
      reviewerTrustRevocation: trust.revocation,
      persistedAtMs,
    };
    const statements =
      await prepareStrategySelectionReviewReceiptPersistence(input);
    for (const statement of statements) {
      await this.db.prepare(statement.sql)
        .bind(...statement.params)
        .run();
    }
    const row = await this.db.prepare(SELECT_REVIEW_RECEIPT_SQL)
      .bind(receipt.receiptSha256)
      .first<PersistedReviewReceiptRow>();
    if (row === null || !receiptRowMatches(row, input)) {
      throw new Error("persisted strategy selection review receipt is invalid");
    }
    return receipt;
  }

  async loadPersistedAtTime(
    receiptSha256: string,
    ownerDecisionAtMs: number,
  ): Promise<VerifiedStrategySelectionReviewReceiptAtTime> {
    if (!SHA256_HEX.test(receiptSha256)) {
      throw new Error("strategy selection review receipt selector is invalid");
    }
    assertTimestamp(
      "strategy selection review receipt owner-decision time",
      ownerDecisionAtMs,
    );
    const row = await this.db.prepare(SELECT_REVIEW_RECEIPT_SQL)
      .bind(receiptSha256)
      .first<PersistedReviewReceiptRow>();
    if (row === null) {
      throw new Error("strategy selection review receipt is unavailable");
    }
    if (row.persisted_at_ms > ownerDecisionAtMs) {
      throw new Error(
        "strategy selection review receipt was unavailable at owner-decision time",
      );
    }
    const receipt =
      parseCanonicalJson<SignedStrategySelectionReviewReceipt>(
        "strategy selection review receipt",
        row.receipt_canonical_json,
      );
    const proposalVerificationRow = await this.db
      .prepare(SELECT_PROPOSAL_VERIFICATION_SQL)
      .bind(receipt.proposalVerificationSha256)
      .first<PersistedProposalVerificationRow>();
    if (
      proposalVerificationRow === null ||
      proposalVerificationRow.persisted_at_ms > row.persisted_at_ms
    ) {
      throw new Error(
        "strategy selection proposal verification is unavailable",
      );
    }
    const verifiedAtReview =
      parseCanonicalJson<VerifiedStrategySelectionProposalAtTime>(
        "strategy selection proposal verification",
        proposalVerificationRow.verification_canonical_json,
      );
    const reconstructedAtReview =
      await this.proposalRepository.loadPersistedAtTime(
        receipt.proposalSha256,
        receipt.reviewedAtMs,
      );
    const reviewTrust = await this.loadReviewerTrust(
      verifiedAtReview.authoriserTrustAnchorSha256,
      receipt.reviewedAtMs,
    );
    const persistedInput = {
      receipt,
      verifiedProposal: verifiedAtReview,
      reviewerTrustAnchor: reviewTrust.anchor,
      reviewerTrustRevocation: reviewTrust.revocation,
      persistedAtMs: ownerDecisionAtMs,
    };
    if (
      proposalVerificationRow.proposal_verification_sha256 !==
        receipt.proposalVerificationSha256 ||
      proposalVerificationRow.proposal_sha256 !==
        receipt.proposalSha256 ||
      proposalVerificationRow.reviewed_at_ms !== receipt.reviewedAtMs ||
      canonicalIntelligenceJson(verifiedAtReview) !==
        canonicalIntelligenceJson(reconstructedAtReview) ||
      !receiptRowMatches(row, persistedInput)
    ) {
      throw new Error(
        "persisted strategy selection review receipt is invalid",
      );
    }
    await verifySignedStrategySelectionReviewReceipt(
      receipt,
      verifiedAtReview,
      reviewTrust.anchor,
      reviewTrust.revocation,
    );
    const currentProposalVerification =
      await this.proposalRepository.loadPersistedAtTime(
        receipt.proposalSha256,
        ownerDecisionAtMs,
      );
    const proposal = currentProposalVerification.proposal;
    const evidence = {
      schemaVersion:
        "verified-strategy-selection-review-receipt-at-time-v1",
      receipt,
      ownerDecisionAtMs,
      currentProposalVerificationSha256:
        currentProposalVerification.proposalVerificationSha256,
      signedConfigurationSha256: proposal.signedConfigurationSha256,
      signedAuthorisationSha256: proposal.signedAuthorisationSha256,
      authorisationScope: proposal.authorisationScope,
      maximumCapitalAud: proposal.maximumCapitalAud,
      configurationSignerTrustAnchorSha256:
        currentProposalVerification.configurationSignerTrustAnchorSha256,
      configurationSignerTrustRevocationSha256:
        currentProposalVerification.configurationSignerTrustRevocationSha256,
      reviewerTrustAnchorSha256:
        currentProposalVerification.authoriserTrustAnchorSha256,
      reviewerTrustRevocationSha256:
        currentProposalVerification.authoriserTrustRevocationSha256,
      receiptStatus: "verified-for-owner-decision",
      candidateStatus: "unselected",
      selectionDecision: "none",
      authorisationConsumed: false,
      activationAuthority: "none",
      executionAuthority: "none",
    } as const;
    return {
      ...evidence,
      receiptVerificationSha256:
        await sha256CanonicalIntelligence(evidence),
    };
  }
}
