import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  prepareHourlyTrendBreakoutReadinessAssessment,
  type HourlyTrendBreakoutReadinessAssessment,
  type HourlyTrendBreakoutReadinessInput,
} from "../research/hourlyTrendBreakoutReadiness.ts";
import {
  verifySignedStrategyAuthorisation,
  verifySignedStrategyConfiguration,
  type SignedStrategyAuthorisation,
  type SignedStrategyConfiguration,
} from "../security/signedStrategyConfiguration.ts";
import {
  resolveReviewedStrategySignerKey,
  type ReviewedStrategySignerTrustAnchor,
  type StrategySignerTrustRevocation,
} from "../security/strategySignerTrust.ts";

type D1BindValue = string | number | null;

export interface SignedStrategyConfigurationPersistenceInput {
  readonly configuration: SignedStrategyConfiguration;
  readonly signerTrustAnchor: ReviewedStrategySignerTrustAnchor;
  readonly signerTrustRevocation: StrategySignerTrustRevocation | null;
  readonly persistedAtMs: number;
}

export interface SignedStrategyAuthorisationPersistenceInput {
  readonly authorisation: SignedStrategyAuthorisation;
  readonly configuration: SignedStrategyConfiguration;
  readonly configurationSignerTrustAnchor:
    ReviewedStrategySignerTrustAnchor;
  readonly configurationSignerTrustRevocation:
    StrategySignerTrustRevocation | null;
  readonly authoriserTrustAnchor: ReviewedStrategySignerTrustAnchor;
  readonly authoriserTrustRevocation:
    StrategySignerTrustRevocation | null;
  readonly persistedAtMs: number;
}

export interface SignedStrategyPersistenceStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export interface VerifiedStrategyConfigurationPersistenceInput {
  readonly verification: VerifiedStrategyConfigurationAtTime;
  readonly persistedAtMs: number;
}

interface PersistedConfigurationRow {
  readonly signed_configuration_sha256: string;
  readonly complete_evaluation_sha256: string;
  readonly readiness_assessment_sha256: string;
  readonly verification_key_sha256: string;
  readonly signer_trust_anchor_sha256: string;
  readonly configuration_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedAuthorisationRow {
  readonly signed_authorisation_sha256: string;
  readonly signed_configuration_sha256: string;
  readonly complete_evaluation_sha256: string;
  readonly readiness_assessment_sha256: string;
  readonly verification_key_sha256: string;
  readonly authoriser_trust_anchor_sha256: string;
  readonly authorisation_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedTrustAnchorAtTimeRow {
  readonly trust_anchor_sha256: string;
  readonly key_id: string;
  readonly verification_key_sha256: string;
  readonly trust_anchor_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedTrustRevocationAtTimeRow {
  readonly revocation_sha256: string;
  readonly trust_anchor_sha256: string;
  readonly revocation_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedReadinessAtTimeRow {
  readonly assessment_sha256: string;
  readonly evidence_input_sha256: string;
  readonly assessed_at_ms: number;
  readonly research_status: string;
  readonly promotion_status: string;
  readonly gate_count: number;
  readonly input_canonical_json: string;
  readonly assessment_canonical_json: string;
  readonly persisted_at_ms: number;
}

interface PersistedReadinessGateAtTimeRow {
  readonly gate_index: number;
  readonly gate_id: string;
  readonly stage: string;
  readonly review_gate: string;
  readonly status: string;
  readonly artifact_sha256s_json: string;
}

interface PersistedReadinessBindingAtTimeRow {
  readonly assessment_sha256: string;
  readonly complete_evaluation_sha256: string | null;
  readonly execution_calibration_sha256: string | null;
  readonly execution_stress_manifest_sha256: string | null;
  readonly persisted_at_ms: number;
}

interface PersistedCompleteEvaluationAtTimeRow {
  readonly evaluation_sha256: string;
  readonly schema_version: string;
  readonly strategy_version: string;
  readonly report_sha256: string;
  readonly persisted_at_ms: number;
}

interface PersistedReportCommitAtTimeRow {
  readonly report_sha256: string;
  readonly chunk_count: number;
  readonly canonical_byte_length: number;
  readonly persisted_at_ms: number;
}

interface PersistedStressManifestAtTimeRow {
  readonly manifest_sha256: string;
  readonly calibration_sha256: string;
  readonly persisted_at_ms: number;
}

interface PersistedStressBindingAtTimeRow {
  readonly evaluation_sha256: string;
  readonly report_sha256: string;
  readonly stress_manifest_sha256: string;
  readonly persisted_at_ms: number;
}

interface PersistedVerifiedConfigurationAtTimeRow {
  readonly verification_evidence_sha256: string;
  readonly signed_configuration_sha256: string;
  readonly decision_at_ms: number;
  readonly signer_trust_anchor_sha256: string;
  readonly signer_trust_revocation_sha256: string | null;
  readonly readiness_assessment_sha256: string;
  readonly complete_evaluation_sha256: string;
  readonly research_report_sha256: string;
  readonly execution_calibration_sha256: string;
  readonly execution_stress_manifest_sha256: string;
  readonly evidence_canonical_json: string;
  readonly persisted_at_ms: number;
}

export interface VerifiedStrategyConfigurationAtTime {
  readonly schemaVersion:
    "verified-strategy-configuration-at-time-v1";
  readonly configuration: SignedStrategyConfiguration;
  readonly decisionAtMs: number;
  readonly signerTrustAnchorSha256: string;
  readonly signerTrustRevocationSha256: string | null;
  readonly readinessAssessmentSha256: string;
  readonly completeEvaluationSha256: string;
  readonly researchReportSha256: string;
  readonly executionCalibrationSha256: string;
  readonly executionStressManifestSha256: string;
  readonly selectionAuthority: "none";
  readonly executionAuthority: "none";
  readonly verificationEvidenceSha256: string;
}

export const INSERT_SIGNED_STRATEGY_CONFIGURATION_SQL =
  `INSERT INTO hourly_trend_breakout_signed_configurations
    (signed_configuration_sha256, schema_version, configuration_version,
     strategy_version, execution_authority, complete_evaluation_sha256,
     readiness_assessment_sha256, signer_key_id,
     verification_key_sha256, signer_trust_anchor_sha256, issued_at_ms,
     effective_from_ms, expires_at_ms, configuration_canonical_json,
     persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

export const INSERT_SIGNED_STRATEGY_AUTHORISATION_SQL =
  `INSERT INTO hourly_trend_breakout_strategy_authorisations
    (signed_authorisation_sha256, schema_version, authorisation_id,
     authorisation_scope, standalone_execution_authority,
     requires_separate_activation_checklist,
     signed_configuration_sha256, complete_evaluation_sha256,
     readiness_assessment_sha256, maximum_capital_aud,
     authoriser_key_id, verification_key_sha256,
     authoriser_trust_anchor_sha256, reviewed_at_ms, effective_from_ms,
     expires_at_ms, authorisation_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

export const INSERT_VERIFIED_STRATEGY_CONFIGURATION_AT_TIME_SQL =
  `INSERT INTO hourly_trend_breakout_verified_configurations
    (verification_evidence_sha256, schema_version,
     signed_configuration_sha256, decision_at_ms,
     signer_trust_anchor_sha256, signer_trust_revocation_sha256,
     readiness_assessment_sha256, complete_evaluation_sha256,
     research_report_sha256, execution_calibration_sha256,
     execution_stress_manifest_sha256, selection_authority,
     execution_authority, evidence_canonical_json, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`;

const SELECT_SIGNED_CONFIGURATION_SQL =
  `SELECT signed_configuration_sha256, complete_evaluation_sha256,
          readiness_assessment_sha256, verification_key_sha256,
          signer_trust_anchor_sha256, configuration_canonical_json,
          persisted_at_ms
   FROM hourly_trend_breakout_signed_configurations
   WHERE signed_configuration_sha256 = ?`;

const SELECT_SIGNED_AUTHORISATION_SQL =
  `SELECT signed_authorisation_sha256, signed_configuration_sha256,
          complete_evaluation_sha256, readiness_assessment_sha256,
          verification_key_sha256, authoriser_trust_anchor_sha256,
          authorisation_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_strategy_authorisations
   WHERE signed_authorisation_sha256 = ?`;

const SELECT_TRUST_ANCHOR_AT_TIME_SQL =
  `SELECT trust_anchor_sha256, key_id, verification_key_sha256,
          trust_anchor_canonical_json, persisted_at_ms
   FROM strategy_signer_trust_anchors
   WHERE trust_anchor_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_TRUST_REVOCATION_AT_TIME_SQL =
  `SELECT revocation_sha256, trust_anchor_sha256,
          revocation_canonical_json, persisted_at_ms
   FROM strategy_signer_trust_revocations
   WHERE trust_anchor_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_READINESS_AT_TIME_SQL =
  `SELECT assessment_sha256, evidence_input_sha256, assessed_at_ms,
          research_status, promotion_status, gate_count,
          input_canonical_json, assessment_canonical_json, persisted_at_ms
   FROM hourly_trend_breakout_readiness_assessments
   WHERE assessment_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_READINESS_GATES_AT_TIME_SQL =
  `SELECT gate_index, gate_id, stage, review_gate, status,
          artifact_sha256s_json
   FROM hourly_trend_breakout_readiness_gates
   WHERE assessment_sha256 = ?
   ORDER BY gate_index`;

const SELECT_READINESS_BINDING_AT_TIME_SQL =
  `SELECT assessment_sha256, complete_evaluation_sha256,
          execution_calibration_sha256, execution_stress_manifest_sha256,
          persisted_at_ms
   FROM hourly_trend_breakout_readiness_bindings
   WHERE assessment_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_COMPLETE_EVALUATION_AT_TIME_SQL =
  `SELECT evaluation_sha256, schema_version, strategy_version,
          report_sha256, persisted_at_ms
   FROM hourly_trend_breakout_complete_evaluations
   WHERE evaluation_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_REPORT_COMMIT_AT_TIME_SQL =
  `SELECT report_sha256, chunk_count, canonical_byte_length,
          persisted_at_ms
   FROM research_report_commits
   WHERE report_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_STRESS_MANIFEST_AT_TIME_SQL =
  `SELECT manifest_sha256, calibration_sha256, persisted_at_ms
   FROM hourly_trend_breakout_execution_stress_manifests
   WHERE manifest_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_STRESS_BINDING_AT_TIME_SQL =
  `SELECT evaluation_sha256, report_sha256, stress_manifest_sha256,
          persisted_at_ms
   FROM hourly_trend_breakout_complete_evaluation_stress_bindings
   WHERE evaluation_sha256 = ?
     AND persisted_at_ms <= ?`;

const SELECT_VERIFIED_CONFIGURATION_AT_TIME_SQL =
  `SELECT verification_evidence_sha256, signed_configuration_sha256,
          decision_at_ms, signer_trust_anchor_sha256,
          signer_trust_revocation_sha256, readiness_assessment_sha256,
          complete_evaluation_sha256, research_report_sha256,
          execution_calibration_sha256,
          execution_stress_manifest_sha256, evidence_canonical_json,
          persisted_at_ms
   FROM hourly_trend_breakout_verified_configurations
   WHERE verification_evidence_sha256 = ?`;

const SHA256_HEX = /^[0-9a-f]{64}$/u;

function assertPersistenceTimestamp(
  name: string,
  value: number,
  minimum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} chronology is invalid`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) throw new Error(`${name} is not SHA-256`);
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

function exactReadinessGateRows(
  rows: readonly PersistedReadinessGateAtTimeRow[],
  assessment: HourlyTrendBreakoutReadinessAssessment,
): boolean {
  return (
    rows.length === assessment.gates.length &&
    rows.every((row, index) => {
      const gate = assessment.gates[index];
      return gate !== undefined &&
        row.gate_index === index &&
        row.gate_id === gate.gateId &&
        row.stage === gate.stage &&
        row.review_gate === gate.reviewGate &&
        row.status === gate.status &&
        row.artifact_sha256s_json ===
          canonicalIntelligenceJson(gate.artifactSha256s);
    })
  );
}

function assertKnownByDecision(
  name: string,
  persistedAtMs: number,
  decisionAtMs: number,
): void {
  if (
    !Number.isSafeInteger(persistedAtMs) ||
    persistedAtMs < 0 ||
    persistedAtMs > decisionAtMs
  ) {
    throw new Error(`${name} was unavailable at the decision time`);
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

export async function prepareVerifiedStrategyConfigurationPersistence(
  input: VerifiedStrategyConfigurationPersistenceInput,
): Promise<SignedStrategyPersistenceStatement> {
  const evidence = verificationEvidence(input.verification);
  const reproducedSha256 =
    await sha256CanonicalIntelligence(evidence);
  if (
    reproducedSha256 !==
      input.verification.verificationEvidenceSha256 ||
    input.verification.schemaVersion !==
      "verified-strategy-configuration-at-time-v1" ||
    input.verification.selectionAuthority !== "none" ||
    input.verification.executionAuthority !== "none"
  ) {
    throw new Error("verified strategy configuration identity is invalid");
  }
  assertPersistenceTimestamp(
    "verified strategy configuration persistence",
    input.persistedAtMs,
    input.verification.decisionAtMs,
  );
  return {
    sql: INSERT_VERIFIED_STRATEGY_CONFIGURATION_AT_TIME_SQL,
    params: [
      input.verification.verificationEvidenceSha256,
      input.verification.schemaVersion,
      input.verification.configuration.signedConfigurationSha256,
      input.verification.decisionAtMs,
      input.verification.signerTrustAnchorSha256,
      input.verification.signerTrustRevocationSha256,
      input.verification.readinessAssessmentSha256,
      input.verification.completeEvaluationSha256,
      input.verification.researchReportSha256,
      input.verification.executionCalibrationSha256,
      input.verification.executionStressManifestSha256,
      input.verification.selectionAuthority,
      input.verification.executionAuthority,
      canonicalIntelligenceJson(evidence),
      input.persistedAtMs,
    ],
  };
}

function verifiedConfigurationRowMatches(
  row: PersistedVerifiedConfigurationAtTimeRow,
  input: VerifiedStrategyConfigurationPersistenceInput,
): boolean {
  const evidence = verificationEvidence(input.verification);
  return (
    row.verification_evidence_sha256 ===
      input.verification.verificationEvidenceSha256 &&
    row.signed_configuration_sha256 ===
      input.verification.configuration.signedConfigurationSha256 &&
    row.decision_at_ms === input.verification.decisionAtMs &&
    row.signer_trust_anchor_sha256 ===
      input.verification.signerTrustAnchorSha256 &&
    row.signer_trust_revocation_sha256 ===
      input.verification.signerTrustRevocationSha256 &&
    row.readiness_assessment_sha256 ===
      input.verification.readinessAssessmentSha256 &&
    row.complete_evaluation_sha256 ===
      input.verification.completeEvaluationSha256 &&
    row.research_report_sha256 ===
      input.verification.researchReportSha256 &&
    row.execution_calibration_sha256 ===
      input.verification.executionCalibrationSha256 &&
    row.execution_stress_manifest_sha256 ===
      input.verification.executionStressManifestSha256 &&
    row.evidence_canonical_json === canonicalIntelligenceJson(evidence) &&
    row.persisted_at_ms >= input.verification.decisionAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

export async function prepareSignedStrategyConfigurationPersistence(
  input: SignedStrategyConfigurationPersistenceInput,
): Promise<SignedStrategyPersistenceStatement> {
  const reviewedKey = await resolveReviewedStrategySignerKey({
    anchor: input.signerTrustAnchor,
    revocation: input.signerTrustRevocation,
    expectedRole: "strategy-configuration-signer",
    artifactTimeMs: input.configuration.issuedAtMs,
    checkedAtMs: input.persistedAtMs,
  });
  await verifySignedStrategyConfiguration(
    input.configuration,
    reviewedKey,
  );
  assertPersistenceTimestamp(
    "signed strategy configuration persistence",
    input.persistedAtMs,
    input.configuration.issuedAtMs,
  );
  return {
    sql: INSERT_SIGNED_STRATEGY_CONFIGURATION_SQL,
    params: [
      input.configuration.signedConfigurationSha256,
      "signed-strategy-configuration-envelope-v1",
      input.configuration.configurationVersion,
      input.configuration.configuration.strategyVersion,
      input.configuration.executionAuthority,
      input.configuration.configuration.completeEvaluationSha256,
      input.configuration.configuration.readinessAssessmentSha256,
      input.configuration.signerKeyId,
      input.configuration.verificationKeySha256,
      input.signerTrustAnchor.trustAnchorSha256,
      input.configuration.issuedAtMs,
      input.configuration.effectiveFromMs,
      input.configuration.expiresAtMs,
      canonicalIntelligenceJson(input.configuration),
      input.persistedAtMs,
    ],
  };
}

export async function prepareSignedStrategyAuthorisationPersistence(
  input: SignedStrategyAuthorisationPersistenceInput,
): Promise<SignedStrategyPersistenceStatement> {
  const configurationReviewedKey =
    await resolveReviewedStrategySignerKey({
      anchor: input.configurationSignerTrustAnchor,
      revocation: input.configurationSignerTrustRevocation,
      expectedRole: "strategy-configuration-signer",
      artifactTimeMs: input.configuration.issuedAtMs,
      checkedAtMs: input.persistedAtMs,
    });
  const authorisationReviewedKey =
    await resolveReviewedStrategySignerKey({
      anchor: input.authoriserTrustAnchor,
      revocation: input.authoriserTrustRevocation,
      expectedRole: "external-strategy-authoriser",
      artifactTimeMs: input.authorisation.reviewedAtMs,
      checkedAtMs: input.persistedAtMs,
    });
  await verifySignedStrategyAuthorisation(
    input.authorisation,
    input.configuration,
    configurationReviewedKey,
    authorisationReviewedKey,
  );
  assertPersistenceTimestamp(
    "signed strategy authorisation persistence",
    input.persistedAtMs,
    input.authorisation.reviewedAtMs,
  );
  return {
    sql: INSERT_SIGNED_STRATEGY_AUTHORISATION_SQL,
    params: [
      input.authorisation.signedAuthorisationSha256,
      "signed-strategy-authorisation-envelope-v1",
      input.authorisation.authorisationId,
      input.authorisation.authorisationScope,
      input.authorisation.standaloneExecutionAuthority,
      input.authorisation.requiresSeparateActivationChecklist ? 1 : 0,
      input.authorisation.signedConfigurationSha256,
      input.authorisation.completeEvaluationSha256,
      input.authorisation.readinessAssessmentSha256,
      input.authorisation.maximumCapitalAud,
      input.authorisation.authoriserKeyId,
      input.authorisation.verificationKeySha256,
      input.authoriserTrustAnchor.trustAnchorSha256,
      input.authorisation.reviewedAtMs,
      input.authorisation.effectiveFromMs,
      input.authorisation.expiresAtMs,
      canonicalIntelligenceJson(input.authorisation),
      input.persistedAtMs,
    ],
  };
}

function configurationRowMatches(
  row: PersistedConfigurationRow,
  input: SignedStrategyConfigurationPersistenceInput,
): boolean {
  return (
    row.signed_configuration_sha256 ===
      input.configuration.signedConfigurationSha256 &&
    row.complete_evaluation_sha256 ===
      input.configuration.configuration.completeEvaluationSha256 &&
    row.readiness_assessment_sha256 ===
      input.configuration.configuration.readinessAssessmentSha256 &&
    row.verification_key_sha256 ===
      input.configuration.verificationKeySha256 &&
    row.signer_trust_anchor_sha256 ===
      input.signerTrustAnchor.trustAnchorSha256 &&
    row.configuration_canonical_json ===
      canonicalIntelligenceJson(input.configuration) &&
    row.persisted_at_ms >= input.configuration.issuedAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

function authorisationRowMatches(
  row: PersistedAuthorisationRow,
  input: SignedStrategyAuthorisationPersistenceInput,
): boolean {
  return (
    row.signed_authorisation_sha256 ===
      input.authorisation.signedAuthorisationSha256 &&
    row.signed_configuration_sha256 ===
      input.configuration.signedConfigurationSha256 &&
    row.complete_evaluation_sha256 ===
      input.configuration.configuration.completeEvaluationSha256 &&
    row.readiness_assessment_sha256 ===
      input.configuration.configuration.readinessAssessmentSha256 &&
    row.verification_key_sha256 ===
      input.authorisation.verificationKeySha256 &&
    row.authoriser_trust_anchor_sha256 ===
      input.authoriserTrustAnchor.trustAnchorSha256 &&
    row.authorisation_canonical_json ===
      canonicalIntelligenceJson(input.authorisation) &&
    row.persisted_at_ms >= input.authorisation.reviewedAtMs &&
    row.persisted_at_ms <= input.persistedAtMs
  );
}

export class SignedStrategyConfigurationRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistConfiguration(
    input: SignedStrategyConfigurationPersistenceInput,
  ): Promise<SignedStrategyConfiguration> {
    const statement =
      await prepareSignedStrategyConfigurationPersistence(input);
    await this.db
      .prepare(statement.sql)
      .bind(...statement.params)
      .run();
    const row = await this.db
      .prepare(SELECT_SIGNED_CONFIGURATION_SQL)
      .bind(input.configuration.signedConfigurationSha256)
      .first<PersistedConfigurationRow>();
    if (row === null || !configurationRowMatches(row, input)) {
      throw new Error("persisted signed strategy configuration is invalid");
    }
    return input.configuration;
  }

  async persistAuthorisation(
    input: SignedStrategyAuthorisationPersistenceInput,
  ): Promise<SignedStrategyAuthorisation> {
    const statement =
      await prepareSignedStrategyAuthorisationPersistence(input);
    await this.db
      .prepare(statement.sql)
      .bind(...statement.params)
      .run();
    const row = await this.db
      .prepare(SELECT_SIGNED_AUTHORISATION_SQL)
      .bind(input.authorisation.signedAuthorisationSha256)
      .first<PersistedAuthorisationRow>();
    if (row === null || !authorisationRowMatches(row, input)) {
      throw new Error("persisted signed strategy authorisation is invalid");
    }
    return input.authorisation;
  }

  async loadVerifiedConfigurationAtTime(
    signedConfigurationSha256: string,
    decisionAtMs: number,
  ): Promise<VerifiedStrategyConfigurationAtTime> {
    assertDigest(
      "signed strategy configuration selector",
      signedConfigurationSha256,
    );
    if (!Number.isSafeInteger(decisionAtMs) || decisionAtMs < 0) {
      throw new Error("strategy configuration decision time is invalid");
    }
    const configurationRow = await this.db
      .prepare(SELECT_SIGNED_CONFIGURATION_SQL)
      .bind(signedConfigurationSha256)
      .first<PersistedConfigurationRow>();
    if (configurationRow === null) {
      throw new Error("signed strategy configuration is unavailable");
    }
    assertKnownByDecision(
      "signed strategy configuration",
      configurationRow.persisted_at_ms,
      decisionAtMs,
    );
    const configuration = parseCanonicalJson<SignedStrategyConfiguration>(
      "signed strategy configuration",
      configurationRow.configuration_canonical_json,
    );
    if (
      configuration.signedConfigurationSha256 !==
        signedConfigurationSha256 ||
      configuration.configuration.completeEvaluationSha256 !==
        configurationRow.complete_evaluation_sha256 ||
      configuration.configuration.readinessAssessmentSha256 !==
        configurationRow.readiness_assessment_sha256 ||
      configuration.verificationKeySha256 !==
        configurationRow.verification_key_sha256 ||
      configuration.effectiveFromMs > decisionAtMs ||
      configuration.expiresAtMs <= decisionAtMs
    ) {
      throw new Error("signed strategy configuration binding is invalid");
    }

    const [anchorRow, revocationRow, readinessRow, gateResult, bindingRow] =
      await Promise.all([
        this.db
          .prepare(SELECT_TRUST_ANCHOR_AT_TIME_SQL)
          .bind(configurationRow.signer_trust_anchor_sha256, decisionAtMs)
          .first<PersistedTrustAnchorAtTimeRow>(),
        this.db
          .prepare(SELECT_TRUST_REVOCATION_AT_TIME_SQL)
          .bind(configurationRow.signer_trust_anchor_sha256, decisionAtMs)
          .first<PersistedTrustRevocationAtTimeRow>(),
        this.db
          .prepare(SELECT_READINESS_AT_TIME_SQL)
          .bind(
            configuration.configuration.readinessAssessmentSha256,
            decisionAtMs,
          )
          .first<PersistedReadinessAtTimeRow>(),
        this.db
          .prepare(SELECT_READINESS_GATES_AT_TIME_SQL)
          .bind(configuration.configuration.readinessAssessmentSha256)
          .all<PersistedReadinessGateAtTimeRow>(),
        this.db
          .prepare(SELECT_READINESS_BINDING_AT_TIME_SQL)
          .bind(
            configuration.configuration.readinessAssessmentSha256,
            decisionAtMs,
          )
          .first<PersistedReadinessBindingAtTimeRow>(),
      ]);
    if (anchorRow === null) {
      throw new Error("strategy configuration signer trust is unavailable");
    }
    assertKnownByDecision(
      "strategy configuration signer trust",
      anchorRow.persisted_at_ms,
      decisionAtMs,
    );
    const anchor = parseCanonicalJson<ReviewedStrategySignerTrustAnchor>(
      "strategy configuration signer trust",
      anchorRow.trust_anchor_canonical_json,
    );
    if (
      anchor.trustAnchorSha256 !== anchorRow.trust_anchor_sha256 ||
      anchor.trustAnchorSha256 !==
        configurationRow.signer_trust_anchor_sha256 ||
      anchor.keyId !== anchorRow.key_id ||
      anchor.verificationKeySha256 !==
        anchorRow.verification_key_sha256 ||
      anchor.keyId !== configuration.signerKeyId ||
      anchor.verificationKeySha256 !==
        configuration.verificationKeySha256
    ) {
      throw new Error("strategy configuration signer trust binding is invalid");
    }
    const revocation = revocationRow === null
      ? null
      : parseCanonicalJson<StrategySignerTrustRevocation>(
        "strategy configuration signer revocation",
        revocationRow.revocation_canonical_json,
      );
    if (revocationRow !== null) {
      assertKnownByDecision(
        "strategy configuration signer revocation",
        revocationRow.persisted_at_ms,
        decisionAtMs,
      );
      if (
        revocation === null ||
        revocation.revocationSha256 !== revocationRow.revocation_sha256 ||
        revocation.trustAnchorSha256 !==
          revocationRow.trust_anchor_sha256 ||
        revocation.trustAnchorSha256 !== anchor.trustAnchorSha256
      ) {
        throw new Error(
          "strategy configuration signer revocation binding is invalid",
        );
      }
    }
    const reviewedKey = await resolveReviewedStrategySignerKey({
      anchor,
      revocation,
      expectedRole: "strategy-configuration-signer",
      artifactTimeMs: configuration.issuedAtMs,
      checkedAtMs: decisionAtMs,
    });
    await verifySignedStrategyConfiguration(configuration, reviewedKey);

    if (readinessRow === null || bindingRow === null) {
      throw new Error("strategy configuration readiness is unavailable");
    }
    assertKnownByDecision(
      "strategy configuration readiness",
      readinessRow.persisted_at_ms,
      decisionAtMs,
    );
    assertKnownByDecision(
      "strategy configuration readiness binding",
      bindingRow.persisted_at_ms,
      decisionAtMs,
    );
    const readinessInput =
      parseCanonicalJson<HourlyTrendBreakoutReadinessInput>(
        "strategy configuration readiness input",
        readinessRow.input_canonical_json,
      );
    const readiness =
      parseCanonicalJson<HourlyTrendBreakoutReadinessAssessment>(
        "strategy configuration readiness assessment",
        readinessRow.assessment_canonical_json,
      );
    const reproducedReadiness =
      await prepareHourlyTrendBreakoutReadinessAssessment(readinessInput);
    if (
      canonicalIntelligenceJson(reproducedReadiness) !==
        canonicalIntelligenceJson(readiness) ||
      readiness.assessmentSha256 !==
        configuration.configuration.readinessAssessmentSha256 ||
      readiness.assessmentSha256 !== readinessRow.assessment_sha256 ||
      readiness.evidenceInputSha256 !== readinessRow.evidence_input_sha256 ||
      readiness.assessedAtMs !== readinessRow.assessed_at_ms ||
      readiness.assessedAtMs > decisionAtMs ||
      readinessInput.evidence.some((item) =>
        item.validUntilMs !== null && item.validUntilMs < decisionAtMs
      ) ||
      readinessRow.research_status !== "evidence-complete-for-review" ||
      readinessRow.promotion_status !== "external-review-required" ||
      readiness.gates.length !== readinessRow.gate_count ||
      !exactReadinessGateRows(gateResult.results ?? [], readiness) ||
      bindingRow.assessment_sha256 !== readiness.assessmentSha256 ||
      bindingRow.complete_evaluation_sha256 !==
        configuration.configuration.completeEvaluationSha256 ||
      bindingRow.execution_calibration_sha256 === null ||
      bindingRow.execution_stress_manifest_sha256 === null
    ) {
      throw new Error("strategy configuration readiness binding is invalid");
    }

    const [evaluationRow, stressManifestRow, stressBindingRow] =
      await Promise.all([
        this.db
          .prepare(SELECT_COMPLETE_EVALUATION_AT_TIME_SQL)
          .bind(
            configuration.configuration.completeEvaluationSha256,
            decisionAtMs,
          )
          .first<PersistedCompleteEvaluationAtTimeRow>(),
        this.db
          .prepare(SELECT_STRESS_MANIFEST_AT_TIME_SQL)
          .bind(
            bindingRow.execution_stress_manifest_sha256,
            decisionAtMs,
          )
          .first<PersistedStressManifestAtTimeRow>(),
        this.db
          .prepare(SELECT_STRESS_BINDING_AT_TIME_SQL)
          .bind(
            configuration.configuration.completeEvaluationSha256,
            decisionAtMs,
          )
          .first<PersistedStressBindingAtTimeRow>(),
      ]);
    if (
      evaluationRow === null ||
      stressManifestRow === null ||
      stressBindingRow === null
    ) {
      throw new Error("strategy configuration evaluation is unavailable");
    }
    assertKnownByDecision(
      "strategy configuration evaluation",
      evaluationRow.persisted_at_ms,
      decisionAtMs,
    );
    assertKnownByDecision(
      "strategy configuration stress manifest",
      stressManifestRow.persisted_at_ms,
      decisionAtMs,
    );
    assertKnownByDecision(
      "strategy configuration stress binding",
      stressBindingRow.persisted_at_ms,
      decisionAtMs,
    );
    if (
      evaluationRow.evaluation_sha256 !==
        configuration.configuration.completeEvaluationSha256 ||
      evaluationRow.schema_version !==
        "hourly-trend-breakout-complete-evaluation-v1" ||
      evaluationRow.strategy_version !==
        configuration.configuration.strategyVersion ||
      stressManifestRow.manifest_sha256 !==
        bindingRow.execution_stress_manifest_sha256 ||
      stressManifestRow.calibration_sha256 !==
        bindingRow.execution_calibration_sha256 ||
      stressBindingRow.evaluation_sha256 !==
        evaluationRow.evaluation_sha256 ||
      stressBindingRow.report_sha256 !== evaluationRow.report_sha256 ||
      stressBindingRow.stress_manifest_sha256 !==
        stressManifestRow.manifest_sha256
    ) {
      throw new Error("strategy configuration evaluation binding is invalid");
    }
    assertDigest("research report identity", evaluationRow.report_sha256);
    // The commit is the bounded runtime proof that persistence previously
    // verified every immutable report chunk. Loading up to 90 chunks here
    // would make a per-cycle safety check depend on tens of MiB of payload.
    const reportCommit = await this.db
      .prepare(SELECT_REPORT_COMMIT_AT_TIME_SQL)
      .bind(evaluationRow.report_sha256, decisionAtMs)
      .first<PersistedReportCommitAtTimeRow>();
    if (
      reportCommit === null ||
      reportCommit.report_sha256 !== evaluationRow.report_sha256 ||
      !Number.isSafeInteger(reportCommit.chunk_count) ||
      reportCommit.chunk_count < 1 ||
      reportCommit.chunk_count > 90 ||
      !Number.isSafeInteger(reportCommit.canonical_byte_length) ||
      reportCommit.canonical_byte_length < 1 ||
      reportCommit.canonical_byte_length > 47_185_920
    ) {
      throw new Error("strategy configuration research report is unavailable");
    }
    assertKnownByDecision(
      "strategy configuration research report",
      reportCommit.persisted_at_ms,
      decisionAtMs,
    );

    const evidence = {
      schemaVersion: "verified-strategy-configuration-at-time-v1",
      signedConfigurationSha256,
      decisionAtMs,
      signerTrustAnchorSha256: anchor.trustAnchorSha256,
      signerTrustRevocationSha256:
        revocation?.revocationSha256 ?? null,
      readinessAssessmentSha256: readiness.assessmentSha256,
      completeEvaluationSha256: evaluationRow.evaluation_sha256,
      researchReportSha256: evaluationRow.report_sha256,
      executionCalibrationSha256:
        bindingRow.execution_calibration_sha256,
      executionStressManifestSha256:
        bindingRow.execution_stress_manifest_sha256,
      selectionAuthority: "none",
      executionAuthority: "none",
    } as const;
    return {
      ...evidence,
      configuration,
      verificationEvidenceSha256:
        await sha256CanonicalIntelligence(evidence),
    };
  }

  async persistVerifiedConfigurationAtTime(
    signedConfigurationSha256: string,
    decisionAtMs: number,
    persistedAtMs: number,
  ): Promise<VerifiedStrategyConfigurationAtTime> {
    const verification = await this.loadVerifiedConfigurationAtTime(
      signedConfigurationSha256,
      decisionAtMs,
    );
    const input = { verification, persistedAtMs };
    const statement =
      await prepareVerifiedStrategyConfigurationPersistence(input);
    await this.db
      .prepare(statement.sql)
      .bind(...statement.params)
      .run();
    const row = await this.db
      .prepare(SELECT_VERIFIED_CONFIGURATION_AT_TIME_SQL)
      .bind(verification.verificationEvidenceSha256)
      .first<PersistedVerifiedConfigurationAtTimeRow>();
    if (row === null || !verifiedConfigurationRowMatches(row, input)) {
      throw new Error(
        "persisted verified strategy configuration is invalid",
      );
    }
    return verification;
  }
}
