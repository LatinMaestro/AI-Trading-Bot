import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
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

function assertPersistenceTimestamp(
  name: string,
  value: number,
  minimum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} chronology is invalid`);
  }
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
}
