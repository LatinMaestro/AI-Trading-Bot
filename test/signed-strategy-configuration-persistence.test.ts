import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareHourlyTrendBreakoutReadinessAssessment,
  REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES,
  type HourlyTrendBreakoutReadinessEvidence,
} from "../src/research/hourlyTrendBreakoutReadiness.ts";
import {
  deriveP256VerificationKeySha256,
  prepareSignedStrategyAuthorisation,
  prepareSignedStrategyConfiguration,
  REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS,
  strategyAuthorisationSigningPayload,
  strategyConfigurationSigningPayload,
  type ReviewedP256VerificationKey,
  type SignedStrategyAuthorisation,
  type SignedStrategyConfiguration,
  type StrategyAuthorisationScope,
} from "../src/security/signedStrategyConfiguration.ts";
import {
  prepareReviewedStrategySignerTrustAnchor,
  prepareStrategySignerTrustRevocation,
  type ReviewedStrategySignerTrustAnchor,
  type StrategySignerRole,
} from "../src/security/strategySignerTrust.ts";
import {
  prepareHourlyTrendBreakoutReadinessPersistence,
} from "../src/storage/hourlyTrendBreakoutReadiness.ts";
import {
  prepareSignedStrategyAuthorisationPersistence,
  prepareSignedStrategyConfigurationPersistence,
  prepareVerifiedStrategyConfigurationPersistence,
  SignedStrategyConfigurationRepository,
  type SignedStrategyPersistenceStatement,
} from "../src/storage/signedStrategyConfiguration.ts";
import {
  prepareStrategySignerTrustAnchorPersistence,
  prepareStrategySignerTrustRevocationPersistence,
} from "../src/storage/strategySignerTrust.ts";
import {
  prepareStrategySelectionProposalPersistence,
  StrategySelectionProposalRepository,
  type StrategySelectionProposalSelector,
} from "../src/storage/strategySelectionProposal.ts";

const ASSESSED_AT_MS = 10_000;
const READINESS_PERSISTED_AT_MS = 10_001;
const CONFIGURATION_ISSUED_AT_MS = 10_002;
const CONFIGURATION_EFFECTIVE_AT_MS = 10_003;
const CONFIGURATION_EXPIRES_AT_MS =
  CONFIGURATION_EFFECTIVE_AT_MS + 30 * 86_400_000;
const AUTHORISATION_REVIEWED_AT_MS = 10_004;
const AUTHORISATION_EFFECTIVE_AT_MS = 10_005;
const AUTHORISATION_EXPIRES_AT_MS =
  AUTHORISATION_EFFECTIVE_AT_MS + 7 * 86_400_000;
const EVALUATION_SHA256 = "a".repeat(64);
const CALIBRATION_SHA256 = "b".repeat(64);
const STRESS_SHA256 = "c".repeat(64);
const REPORT_SHA256 = "d".repeat(64);

interface KeyFixture {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
  readonly reviewedKey: ReviewedP256VerificationKey;
}

interface ConfigurationFixture {
  readonly configuration: SignedStrategyConfiguration;
  readonly reviewedKey: ReviewedP256VerificationKey;
  readonly trustAnchor: ReviewedStrategySignerTrustAnchor;
}

interface AuthorisationFixture {
  readonly authorisation: SignedStrategyAuthorisation;
  readonly reviewedKey: ReviewedP256VerificationKey;
  readonly trustAnchor: ReviewedStrategySignerTrustAnchor;
}

function digestForGate(
  gateId: HourlyTrendBreakoutReadinessEvidence["gateId"],
): string {
  if (gateId === "complete-after-cost-evaluation") {
    return EVALUATION_SHA256;
  }
  if (gateId === "live-like-execution-calibration") {
    return CALIBRATION_SHA256;
  }
  if (gateId === "capacity-path-stress") return STRESS_SHA256;
  return gateId.length.toString(16).padStart(64, "0");
}

function evidence(
  gateId: HourlyTrendBreakoutReadinessEvidence["gateId"],
): HourlyTrendBreakoutReadinessEvidence {
  return {
    gateId,
    evidenceClass: "authoritative",
    completeness: "complete",
    observedAtMs: 7_000,
    availableAtMs: 8_000,
    validUntilMs: 20_000,
    artifactSha256s: [digestForGate(gateId)],
  };
}

function execute(
  db: DatabaseSync,
  statement: SignedStrategyPersistenceStatement,
): void {
  db.prepare(statement.sql).run(...statement.params);
}

function d1Database(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let params: readonly (string | number | null)[] = [];
      const prepared = {
        bind(...values: readonly (string | number | null)[]) {
          params = values;
          return prepared;
        },
        async first<T>() {
          return (db.prepare(sql).get(...params) ?? null) as T | null;
        },
        async all<T>() {
          return {
            success: true,
            results: db.prepare(sql).all(...params) as T[],
            meta: {},
          };
        },
        async run() {
          db.prepare(sql).run(...params);
          return { success: true, meta: {} };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
}

async function trustAnchor(
  reviewedKey: ReviewedP256VerificationKey,
  role: StrategySignerRole,
): Promise<ReviewedStrategySignerTrustAnchor> {
  return prepareReviewedStrategySignerTrustAnchor({
    trustAnchorId: `${reviewedKey.keyId}-trust-v1`,
    role,
    keyId: reviewedKey.keyId,
    verificationKeySha256: reviewedKey.verificationKeySha256,
    reviewEvidenceSha256:
      (role === "strategy-configuration-signer" ? "4" : "5").repeat(64),
    reviewedAtMs: 9_500,
    validFromMs: 9_600,
    validUntilMs: 100_000,
    predecessorTrustAnchorSha256: null,
  });
}

async function persistTrustAnchor(
  db: DatabaseSync,
  anchor: ReviewedStrategySignerTrustAnchor,
): Promise<void> {
  execute(
    db,
    await prepareStrategySignerTrustAnchorPersistence(anchor, 9_700),
  );
}

async function database(
  completeReadiness = true,
): Promise<{
  readonly db: DatabaseSync;
  readonly readinessAssessmentSha256: string;
}> {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE hourly_trend_breakout_complete_evaluations (
      evaluation_sha256 TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      report_sha256 TEXT NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE research_report_commits (
      report_sha256 TEXT PRIMARY KEY,
      chunk_count INTEGER NOT NULL,
      canonical_byte_length INTEGER NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE hourly_trend_breakout_execution_calibrations (
      calibration_sha256 TEXT PRIMARY KEY,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE hourly_trend_breakout_execution_stress_manifests (
      manifest_sha256 TEXT PRIMARY KEY,
      calibration_sha256 TEXT NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
    CREATE TABLE hourly_trend_breakout_complete_evaluation_stress_bindings (
      evaluation_sha256 TEXT PRIMARY KEY,
      report_sha256 TEXT NOT NULL,
      stress_manifest_sha256 TEXT NOT NULL,
      persisted_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0024_hourly_trend_breakout_readiness.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db.prepare(
    "INSERT INTO hourly_trend_breakout_complete_evaluations VALUES (?, ?, ?, ?, ?)",
  ).run(
    EVALUATION_SHA256,
    "hourly-trend-breakout-complete-evaluation-v1",
    "hourly-trend-breakout-v0.1.0",
    REPORT_SHA256,
    9_000,
  );
  db.prepare(
    "INSERT INTO research_report_commits VALUES (?, ?, ?, ?)",
  ).run(REPORT_SHA256, 1, 1_024, 9_000);
  db.prepare(
    "INSERT INTO hourly_trend_breakout_execution_calibrations VALUES (?, ?)",
  ).run(CALIBRATION_SHA256, 9_000);
  db.prepare(
    "INSERT INTO hourly_trend_breakout_execution_stress_manifests VALUES (?, ?, ?)",
  ).run(STRESS_SHA256, CALIBRATION_SHA256, 9_000);
  db.prepare(
    "INSERT INTO hourly_trend_breakout_complete_evaluation_stress_bindings VALUES (?, ?, ?, ?)",
  ).run(EVALUATION_SHA256, REPORT_SHA256, STRESS_SHA256, 9_000);
  const readinessInput = {
    assessedAtMs: ASSESSED_AT_MS,
    evidence: completeReadiness
      ? REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.map((gate) =>
        evidence(gate.id)
      )
      : [],
  };
  const assessment =
    await prepareHourlyTrendBreakoutReadinessAssessment(readinessInput);
  const statements =
    await prepareHourlyTrendBreakoutReadinessPersistence({
      input: readinessInput,
      assessment,
      persistedAtMs: READINESS_PERSISTED_AT_MS,
    });
  for (const statement of statements) {
    db.prepare(statement.sql).run(...statement.params);
  }
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0025_signed_strategy_configuration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0026_strategy_signer_trust.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0027_verified_strategy_configuration_at_time.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0028_strategy_selection_proposals.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return {
    db,
    readinessAssessmentSha256: assessment.assessmentSha256,
  };
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signingKey(keyId: string): Promise<KeyFixture> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk,
    reviewedKey: {
      keyId,
      verificationKeySha256:
        await deriveP256VerificationKeySha256(publicJwk),
    },
  };
}

async function sign(payload: string, privateKey: CryptoKey): Promise<string> {
  return hex(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(payload),
    ),
  );
}

async function configurationFixture(
  readinessAssessmentSha256: string,
  completeEvaluationSha256 = EVALUATION_SHA256,
  keyId = "strategy-review-key-v1",
): Promise<ConfigurationFixture> {
  const key = await signingKey(keyId);
  const unsigned = {
    configurationVersion: "hourly-trend-breakout-config-v1",
    configuration: {
      strategyVersion: "hourly-trend-breakout-v0.1.0" as const,
      venue: "kraken" as const,
      countryCode: "AU" as const,
      quoteCurrency: "AUD" as const,
      configuredPairs: ["BTC/AUD", "ETH/AUD"] as const,
      decisionIntervalMinutes: 60 as const,
      spotOnly: true as const,
      longOnly: true as const,
      maximumOpenPositions: 1 as const,
      maximumGrossExposure: 0.9,
      maximumRebalancesPerDay: 24,
      maximumCapitalAud: 200,
      drawdownResponse: "exit-to-aud-cash" as const,
      feeModel: {
        makerFeeBps: 10,
        takerFeeBps: 20,
        maximumSpreadBps: 50,
        maximumTakerSlippageBps: 20,
        maximumPriceImpactBps: 35,
        missedFillPolicy: "leave-unfilled" as const,
      },
      strategyPolicySha256: "1".repeat(64),
      signedUniversePolicySha256: "2".repeat(64),
      riskPolicySha256: "3".repeat(64),
      completeEvaluationSha256,
      readinessAssessmentSha256,
    },
    issuedAtMs: CONFIGURATION_ISSUED_AT_MS,
    effectiveFromMs: CONFIGURATION_EFFECTIVE_AT_MS,
    expiresAtMs: CONFIGURATION_EXPIRES_AT_MS,
    signerKeyId: keyId,
  };
  return {
    configuration: await prepareSignedStrategyConfiguration(
      {
        ...unsigned,
        verificationKeyJwk: key.publicJwk,
        signatureHex: await sign(
          strategyConfigurationSigningPayload(unsigned),
          key.privateKey,
        ),
      },
      key.reviewedKey,
    ),
    reviewedKey: key.reviewedKey,
    trustAnchor: await trustAnchor(
      key.reviewedKey,
      "strategy-configuration-signer",
    ),
  };
}

async function authorisationFixture(
  configuration: SignedStrategyConfiguration,
  configurationReviewedKey: ReviewedP256VerificationKey,
  authorisationId = "owner-review-record-v1",
  authorisationScope: StrategyAuthorisationScope = "canary-live",
  keyId = "external-owner-authoriser-v1",
): Promise<AuthorisationFixture> {
  const key = await signingKey(keyId);
  const unsigned = {
    authorisationId,
    authorisationScope,
    signedConfigurationSha256:
      configuration.signedConfigurationSha256,
    completeEvaluationSha256:
      configuration.configuration.completeEvaluationSha256,
    readinessAssessmentSha256:
      configuration.configuration.readinessAssessmentSha256,
    maximumCapitalAud: 200,
    reviewedAtMs: AUTHORISATION_REVIEWED_AT_MS,
    effectiveFromMs: AUTHORISATION_EFFECTIVE_AT_MS,
    expiresAtMs: AUTHORISATION_EXPIRES_AT_MS,
    riskAcknowledgements: REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS,
    authoriserKeyId: keyId,
  };
  return {
    authorisation: await prepareSignedStrategyAuthorisation(
      {
        ...unsigned,
        verificationKeyJwk: key.publicJwk,
        signatureHex: await sign(
          strategyAuthorisationSigningPayload(unsigned, configuration),
          key.privateKey,
        ),
      },
      configuration,
      configurationReviewedKey,
      key.reviewedKey,
    ),
    reviewedKey: key.reviewedKey,
    trustAnchor: await trustAnchor(
      key.reviewedKey,
      "external-strategy-authoriser",
    ),
  };
}

test("persists exact signed configuration and authorisation immutably", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const configuration =
    await configurationFixture(readinessAssessmentSha256);
  const authorisation = await authorisationFixture(
    configuration.configuration,
    configuration.reviewedKey,
  );
  await persistTrustAnchor(db, configuration.trustAnchor);
  await persistTrustAnchor(db, authorisation.trustAnchor);
  const configurationStatement =
    await prepareSignedStrategyConfigurationPersistence({
      configuration: configuration.configuration,
      signerTrustAnchor: configuration.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    });
  const authorisationStatement =
    await prepareSignedStrategyAuthorisationPersistence({
      authorisation: authorisation.authorisation,
      configuration: configuration.configuration,
      configurationSignerTrustAnchor: configuration.trustAnchor,
      configurationSignerTrustRevocation: null,
      authoriserTrustAnchor: authorisation.trustAnchor,
      authoriserTrustRevocation: null,
      persistedAtMs: 10_007,
    });
  execute(db, configurationStatement);
  execute(db, configurationStatement);
  execute(db, authorisationStatement);
  execute(db, authorisationStatement);
  const configurationRow = db.prepare(
    `SELECT execution_authority, configuration_canonical_json
     FROM hourly_trend_breakout_signed_configurations`,
  ).get() as Record<string, unknown>;
  const authorisationRow = db.prepare(
    `SELECT standalone_execution_authority,
            requires_separate_activation_checklist,
            authorisation_canonical_json
     FROM hourly_trend_breakout_strategy_authorisations`,
  ).get() as Record<string, unknown>;
  assert.equal(configurationRow.execution_authority, "none");
  assert.equal(authorisationRow.standalone_execution_authority, "none");
  assert.equal(authorisationRow.requires_separate_activation_checklist, 1);
  assert.equal(
    JSON.parse(configurationRow.configuration_canonical_json as string)
      .verificationKeyJwkJson.includes("\"d\""),
    false,
  );
  assert.throws(
    () => db.prepare(
      "DELETE FROM hourly_trend_breakout_signed_configurations",
    ).run(),
    /immutable/u,
  );
  assert.throws(
    () => db.prepare(
      "UPDATE hourly_trend_breakout_strategy_authorisations SET maximum_capital_aud = 1",
    ).run(),
    /immutable/u,
  );
});

test("rejects configuration without research-complete readiness evidence", async () => {
  const { db, readinessAssessmentSha256 } = await database(false);
  const configuration =
    await configurationFixture(readinessAssessmentSha256);
  await persistTrustAnchor(db, configuration.trustAnchor);
  const statement = await prepareSignedStrategyConfigurationPersistence({
    configuration: configuration.configuration,
    signerTrustAnchor: configuration.trustAnchor,
    signerTrustRevocation: null,
    persistedAtMs: 10_006,
  });
  assert.throws(
    () => execute(db, statement),
    /Signed strategy configuration evidence is invalid/u,
  );
});

test("rejects a configuration bound to a different evaluation", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const differentEvaluationSha256 = "e".repeat(64);
  db.prepare(
    "INSERT INTO hourly_trend_breakout_complete_evaluations VALUES (?, ?, ?, ?, ?)",
  ).run(
    differentEvaluationSha256,
    "hourly-trend-breakout-complete-evaluation-v1",
    "hourly-trend-breakout-v0.1.0",
    REPORT_SHA256,
    9_000,
  );
  const configuration = await configurationFixture(
    readinessAssessmentSha256,
    differentEvaluationSha256,
  );
  await persistTrustAnchor(db, configuration.trustAnchor);
  const statement = await prepareSignedStrategyConfigurationPersistence({
    configuration: configuration.configuration,
    signerTrustAnchor: configuration.trustAnchor,
    signerTrustRevocation: null,
    persistedAtMs: 10_006,
  });
  assert.throws(
    () => execute(db, statement),
    /Signed strategy configuration evidence is invalid/u,
  );
});

test("rejects authorisation before the exact configuration is stored", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const configuration =
    await configurationFixture(readinessAssessmentSha256);
  const authorisation = await authorisationFixture(
    configuration.configuration,
    configuration.reviewedKey,
  );
  await persistTrustAnchor(db, configuration.trustAnchor);
  await persistTrustAnchor(db, authorisation.trustAnchor);
  const statement = await prepareSignedStrategyAuthorisationPersistence({
    authorisation: authorisation.authorisation,
    configuration: configuration.configuration,
    configurationSignerTrustAnchor: configuration.trustAnchor,
    configurationSignerTrustRevocation: null,
    authoriserTrustAnchor: authorisation.trustAnchor,
    authoriserTrustRevocation: null,
    persistedAtMs: 10_007,
  });
  assert.throws(
    () => execute(db, statement),
    /Signed strategy authorisation evidence is invalid/u,
  );
});

test("rejects unreviewed signer trust and changed signed identity", async () => {
  const { readinessAssessmentSha256 } = await database();
  const configuration =
    await configurationFixture(readinessAssessmentSha256);
  await assert.rejects(
    prepareSignedStrategyConfigurationPersistence({
      configuration: configuration.configuration,
      signerTrustAnchor: {
        ...configuration.trustAnchor,
        verificationKeySha256: "0".repeat(64),
      },
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    }),
    /trust anchor identity is invalid/u,
  );
  await assert.rejects(
    prepareSignedStrategyConfigurationPersistence({
      configuration: {
        ...configuration.configuration,
        executionAuthority: "paper" as never,
      },
      signerTrustAnchor: configuration.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    }),
    /identity is invalid/u,
  );
});

test("rejects known effective signer revocation in application and D1", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const configuration =
    await configurationFixture(readinessAssessmentSha256);
  await persistTrustAnchor(db, configuration.trustAnchor);
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "strategy-signer-revocation-v1",
      trustAnchorSha256: configuration.trustAnchor.trustAnchorSha256,
      reason: "suspected-compromise",
      effectiveAtMs: 10_005,
      reviewedAtMs: 10_005,
      reviewEvidenceSha256: "6".repeat(64),
    },
    configuration.trustAnchor,
  );
  execute(
    db,
    await prepareStrategySignerTrustRevocationPersistence(
      revocation,
      configuration.trustAnchor,
      10_005,
    ),
  );
  await assert.rejects(
    prepareSignedStrategyConfigurationPersistence({
      configuration: configuration.configuration,
      signerTrustAnchor: configuration.trustAnchor,
      signerTrustRevocation: revocation,
      persistedAtMs: 10_006,
    }),
    /trust is revoked/u,
  );
  const omittedRevocationStatement =
    await prepareSignedStrategyConfigurationPersistence({
      configuration: configuration.configuration,
      signerTrustAnchor: configuration.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    });
  assert.throws(
    () => execute(db, omittedRevocationStatement),
    /configuration signer trust is invalid/u,
  );
});

test("loads an exact configuration only from evidence known at decision time", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture = await configurationFixture(readinessAssessmentSha256);
  await persistTrustAnchor(db, fixture.trustAnchor);
  execute(
    db,
    await prepareSignedStrategyConfigurationPersistence({
      configuration: fixture.configuration,
      signerTrustAnchor: fixture.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    }),
  );
  const repository =
    new SignedStrategyConfigurationRepository(d1Database(db));
  const loaded = await repository.loadVerifiedConfigurationAtTime(
    fixture.configuration.signedConfigurationSha256,
    10_010,
  );
  assert.equal(
    loaded.configuration.signedConfigurationSha256,
    fixture.configuration.signedConfigurationSha256,
  );
  assert.equal(loaded.signerTrustAnchorSha256, fixture.trustAnchor.trustAnchorSha256);
  assert.equal(loaded.signerTrustRevocationSha256, null);
  assert.equal(loaded.readinessAssessmentSha256, readinessAssessmentSha256);
  assert.equal(loaded.completeEvaluationSha256, EVALUATION_SHA256);
  assert.equal(loaded.researchReportSha256, REPORT_SHA256);
  assert.equal(loaded.executionCalibrationSha256, CALIBRATION_SHA256);
  assert.equal(loaded.executionStressManifestSha256, STRESS_SHA256);
  assert.equal(loaded.selectionAuthority, "none");
  assert.equal(loaded.executionAuthority, "none");
  assert.match(loaded.verificationEvidenceSha256, /^[0-9a-f]{64}$/u);

  await assert.rejects(
    repository.loadVerifiedConfigurationAtTime(
      fixture.configuration.signedConfigurationSha256,
      10_005,
    ),
    /unavailable at the decision time/u,
  );
  await assert.rejects(
    repository.loadVerifiedConfigurationAtTime(
      fixture.configuration.signedConfigurationSha256,
      20_001,
    ),
    /readiness binding is invalid/u,
  );
});

test("point-in-time loading observes only known revocations and exact evidence", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture = await configurationFixture(readinessAssessmentSha256);
  await persistTrustAnchor(db, fixture.trustAnchor);
  execute(
    db,
    await prepareSignedStrategyConfigurationPersistence({
      configuration: fixture.configuration,
      signerTrustAnchor: fixture.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    }),
  );
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "point-in-time-strategy-revocation-v1",
      trustAnchorSha256: fixture.trustAnchor.trustAnchorSha256,
      reason: "review-withdrawn",
      effectiveAtMs: 10_011,
      reviewedAtMs: 10_011,
      reviewEvidenceSha256: "7".repeat(64),
    },
    fixture.trustAnchor,
  );
  execute(
    db,
    await prepareStrategySignerTrustRevocationPersistence(
      revocation,
      fixture.trustAnchor,
      10_012,
    ),
  );
  const repository =
    new SignedStrategyConfigurationRepository(d1Database(db));
  const beforeRevocation = await repository.loadVerifiedConfigurationAtTime(
    fixture.configuration.signedConfigurationSha256,
    10_010,
  );
  assert.equal(beforeRevocation.signerTrustRevocationSha256, null);
  await assert.rejects(
    repository.loadVerifiedConfigurationAtTime(
      fixture.configuration.signedConfigurationSha256,
      10_012,
    ),
    /trust is revoked/u,
  );

  db.prepare(
    `UPDATE hourly_trend_breakout_complete_evaluations
     SET report_sha256 = ?`,
  ).run("f".repeat(64));
  await assert.rejects(
    repository.loadVerifiedConfigurationAtTime(
      fixture.configuration.signedConfigurationSha256,
      10_010,
    ),
    /evaluation binding is invalid/u,
  );
});

test("persists point-in-time verification immutably and idempotently", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture = await configurationFixture(readinessAssessmentSha256);
  await persistTrustAnchor(db, fixture.trustAnchor);
  execute(
    db,
    await prepareSignedStrategyConfigurationPersistence({
      configuration: fixture.configuration,
      signerTrustAnchor: fixture.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    }),
  );
  const repository =
    new SignedStrategyConfigurationRepository(d1Database(db));
  const first = await repository.persistVerifiedConfigurationAtTime(
    fixture.configuration.signedConfigurationSha256,
    10_010,
    10_013,
  );
  const retry = await repository.persistVerifiedConfigurationAtTime(
    fixture.configuration.signedConfigurationSha256,
    10_010,
    10_014,
  );
  assert.equal(
    retry.verificationEvidenceSha256,
    first.verificationEvidenceSha256,
  );
  const row = db.prepare(
    `SELECT selection_authority, execution_authority, persisted_at_ms
     FROM hourly_trend_breakout_verified_configurations`,
  ).get() as Record<string, unknown>;
  assert.equal(row.selection_authority, "none");
  assert.equal(row.execution_authority, "none");
  assert.equal(row.persisted_at_ms, 10_013);
  assert.throws(
    () => db.prepare(
      "DELETE FROM hourly_trend_breakout_verified_configurations",
    ).run(),
    /immutable/u,
  );
  assert.throws(
    () => db.prepare(
      `UPDATE hourly_trend_breakout_verified_configurations
       SET persisted_at_ms = 10014`,
    ).run(),
    /immutable/u,
  );
  await assert.rejects(
    prepareVerifiedStrategyConfigurationPersistence({
      verification: {
        ...first,
        executionAuthority: "paper" as never,
      },
      persistedAtMs: 10_014,
    }),
    /identity is invalid/u,
  );
});

test("database rejects a verification that omits then-known revocation", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture = await configurationFixture(readinessAssessmentSha256);
  await persistTrustAnchor(db, fixture.trustAnchor);
  execute(
    db,
    await prepareSignedStrategyConfigurationPersistence({
      configuration: fixture.configuration,
      signerTrustAnchor: fixture.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    }),
  );
  const repository =
    new SignedStrategyConfigurationRepository(d1Database(db));
  const stale = await repository.loadVerifiedConfigurationAtTime(
    fixture.configuration.signedConfigurationSha256,
    10_010,
  );
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "known-future-effective-revocation-v1",
      trustAnchorSha256: fixture.trustAnchor.trustAnchorSha256,
      reason: "planned-rotation",
      effectiveAtMs: 10_011,
      reviewedAtMs: 10_008,
      reviewEvidenceSha256: "8".repeat(64),
    },
    fixture.trustAnchor,
  );
  execute(
    db,
    await prepareStrategySignerTrustRevocationPersistence(
      revocation,
      fixture.trustAnchor,
      10_009,
    ),
  );
  const staleStatement =
    await prepareVerifiedStrategyConfigurationPersistence({
      verification: stale,
      persistedAtMs: 10_013,
    });
  assert.throws(
    () => execute(db, staleStatement),
    /evidence is invalid/u,
  );
  const persisted = await repository.persistVerifiedConfigurationAtTime(
    fixture.configuration.signedConfigurationSha256,
    10_010,
    10_013,
  );
  assert.equal(
    persisted.signerTrustRevocationSha256,
    revocation.revocationSha256,
  );
  await assert.rejects(
    repository.persistVerifiedConfigurationAtTime(
      fixture.configuration.signedConfigurationSha256,
      10_012,
      10_013,
    ),
    /trust is revoked/u,
  );
});

test("rejects configuration conflicts and authorisation ID reuse", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const configuration =
    await configurationFixture(readinessAssessmentSha256);
  await persistTrustAnchor(db, configuration.trustAnchor);
  const configurationStatement =
    await prepareSignedStrategyConfigurationPersistence({
      configuration: configuration.configuration,
      signerTrustAnchor: configuration.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    });
  execute(db, configurationStatement);
  const changedConfigurationParams = [...configurationStatement.params];
  const canonicalConfigurationIndex =
    changedConfigurationParams.length - 2;
  changedConfigurationParams[canonicalConfigurationIndex] =
    `${changedConfigurationParams[canonicalConfigurationIndex] as string} `;
  assert.throws(
    () => db.prepare(configurationStatement.sql).run(
      ...changedConfigurationParams,
    ),
    /configuration conflict/u,
  );
  const reusedConfigurationVersion =
    await configurationFixture(
      readinessAssessmentSha256,
      EVALUATION_SHA256,
      "strategy-review-key-v2",
    );
  await persistTrustAnchor(db, reusedConfigurationVersion.trustAnchor);
  const reusedConfigurationVersionStatement =
    await prepareSignedStrategyConfigurationPersistence({
      configuration: reusedConfigurationVersion.configuration,
      signerTrustAnchor: reusedConfigurationVersion.trustAnchor,
      signerTrustRevocation: null,
      persistedAtMs: 10_006,
    });
  assert.throws(
    () => execute(db, reusedConfigurationVersionStatement),
    /configuration version conflict/u,
  );

  const first = await authorisationFixture(
    configuration.configuration,
    configuration.reviewedKey,
  );
  const second = await authorisationFixture(
    configuration.configuration,
    configuration.reviewedKey,
    first.authorisation.authorisationId,
    "paper",
    "external-owner-authoriser-v2",
  );
  await persistTrustAnchor(db, first.trustAnchor);
  await persistTrustAnchor(db, second.trustAnchor);
  const firstStatement =
    await prepareSignedStrategyAuthorisationPersistence({
      authorisation: first.authorisation,
      configuration: configuration.configuration,
      configurationSignerTrustAnchor: configuration.trustAnchor,
      configurationSignerTrustRevocation: null,
      authoriserTrustAnchor: first.trustAnchor,
      authoriserTrustRevocation: null,
      persistedAtMs: 10_007,
    });
  const secondStatement =
    await prepareSignedStrategyAuthorisationPersistence({
      authorisation: second.authorisation,
      configuration: configuration.configuration,
      configurationSignerTrustAnchor: configuration.trustAnchor,
      configurationSignerTrustRevocation: null,
      authoriserTrustAnchor: second.trustAnchor,
      authoriserTrustRevocation: null,
      persistedAtMs: 10_007,
    });
  execute(db, firstStatement);
  assert.throws(
    () => execute(db, secondStatement),
    /authorisation identity conflict/u,
  );
});

async function proposalFixture(
  db: DatabaseSync,
  readinessAssessmentSha256: string,
): Promise<{
  readonly configuration: ConfigurationFixture;
  readonly authorisation: AuthorisationFixture;
  readonly repository: StrategySelectionProposalRepository;
  readonly selector: StrategySelectionProposalSelector;
}> {
  const configuration =
    await configurationFixture(readinessAssessmentSha256);
  const authorisation = await authorisationFixture(
    configuration.configuration,
    configuration.reviewedKey,
  );
  await persistTrustAnchor(db, configuration.trustAnchor);
  await persistTrustAnchor(db, authorisation.trustAnchor);
  const d1 = d1Database(db);
  const configurationRepository =
    new SignedStrategyConfigurationRepository(d1);
  await configurationRepository.persistConfiguration({
    configuration: configuration.configuration,
    signerTrustAnchor: configuration.trustAnchor,
    signerTrustRevocation: null,
    persistedAtMs: 10_006,
  });
  await configurationRepository.persistAuthorisation({
    authorisation: authorisation.authorisation,
    configuration: configuration.configuration,
    configurationSignerTrustAnchor: configuration.trustAnchor,
    configurationSignerTrustRevocation: null,
    authoriserTrustAnchor: authorisation.trustAnchor,
    authoriserTrustRevocation: null,
    persistedAtMs: 10_007,
  });
  const verification =
    await configurationRepository.persistVerifiedConfigurationAtTime(
      configuration.configuration.signedConfigurationSha256,
      10_010,
      10_011,
    );
  return {
    configuration,
    authorisation,
    repository: new StrategySelectionProposalRepository(d1),
    selector: {
      proposalId: "hourly-trend-breakout-review-proposal-v1",
      proposedAtMs: 10_012,
      verificationEvidenceSha256:
        verification.verificationEvidenceSha256,
      signedAuthorisationSha256:
        authorisation.authorisation.signedAuthorisationSha256,
    },
  };
}

test("persists an exact non-activating proposal immutably", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture =
    await proposalFixture(db, readinessAssessmentSha256);
  const first = await fixture.repository.persistAtTime(
    fixture.selector,
    10_013,
  );
  const retry = await fixture.repository.persistAtTime(
    fixture.selector,
    10_014,
  );
  assert.equal(retry.proposalSha256, first.proposalSha256);
  const row = db.prepare(
    `SELECT candidate_status, selection_decision,
            activation_authority, execution_authority, persisted_at_ms
     FROM hourly_trend_breakout_strategy_selection_proposals`,
  ).get() as Record<string, unknown>;
  assert.equal(row.candidate_status, "unselected");
  assert.equal(row.selection_decision, "none");
  assert.equal(row.activation_authority, "none");
  assert.equal(row.execution_authority, "none");
  assert.equal(row.persisted_at_ms, 10_013);
  assert.throws(
    () => db.prepare(
      "DELETE FROM hourly_trend_breakout_strategy_selection_proposals",
    ).run(),
    /immutable/u,
  );
  assert.throws(
    () => db.prepare(
      `UPDATE hourly_trend_breakout_strategy_selection_proposals
       SET persisted_at_ms = 10014`,
    ).run(),
    /immutable/u,
  );
});

test("database rejects a proposal omitting then-known revocation", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture =
    await proposalFixture(db, readinessAssessmentSha256);
  const staleProposal =
    await fixture.repository.prepareAtTime(fixture.selector);
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "proposal-authoriser-rotation-v1",
      trustAnchorSha256:
        fixture.authorisation.trustAnchor.trustAnchorSha256,
      reason: "planned-rotation",
      effectiveAtMs: 10_014,
      reviewedAtMs: 10_011,
      reviewEvidenceSha256: "9".repeat(64),
    },
    fixture.authorisation.trustAnchor,
  );
  execute(
    db,
    await prepareStrategySignerTrustRevocationPersistence(
      revocation,
      fixture.authorisation.trustAnchor,
      10_011,
    ),
  );
  const staleStatement =
    await prepareStrategySelectionProposalPersistence({
      proposal: staleProposal,
      persistedAtMs: 10_013,
    });
  assert.throws(
    () => execute(db, staleStatement),
    /proposal evidence is invalid/u,
  );
  const current = await fixture.repository.persistAtTime(
    fixture.selector,
    10_013,
  );
  assert.equal(
    current.authoriserTrustRevocationSha256,
    revocation.revocationSha256,
  );
});

test("proposal loading rejects unavailable and effectively revoked evidence", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture =
    await proposalFixture(db, readinessAssessmentSha256);
  await assert.rejects(
    fixture.repository.prepareAtTime({
      ...fixture.selector,
      signedAuthorisationSha256: "f".repeat(64),
    }),
    /authorisation is unavailable/u,
  );
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "proposal-authoriser-withdrawal-v1",
      trustAnchorSha256:
        fixture.authorisation.trustAnchor.trustAnchorSha256,
      reason: "review-withdrawn",
      effectiveAtMs: 10_012,
      reviewedAtMs: 10_011,
      reviewEvidenceSha256: "8".repeat(64),
    },
    fixture.authorisation.trustAnchor,
  );
  execute(
    db,
    await prepareStrategySignerTrustRevocationPersistence(
      revocation,
      fixture.authorisation.trustAnchor,
      10_011,
    ),
  );
  await assert.rejects(
    fixture.repository.prepareAtTime(fixture.selector),
    /trust is revoked/u,
  );
});

test("proposal IDs cannot be rebound to changed evidence", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture =
    await proposalFixture(db, readinessAssessmentSha256);
  await fixture.repository.persistAtTime(fixture.selector, 10_013);
  await assert.rejects(
    fixture.repository.persistAtTime(
      { ...fixture.selector, proposedAtMs: 10_013 },
      10_014,
    ),
    /proposal conflict/u,
  );
});

test("loads only the exact persisted proposal at review time", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture =
    await proposalFixture(db, readinessAssessmentSha256);
  const persisted = await fixture.repository.persistAtTime(
    fixture.selector,
    10_013,
  );
  const loaded = await fixture.repository.loadPersistedAtTime(
    persisted.proposalSha256,
    10_014,
  );
  assert.deepEqual(loaded.proposal, persisted);
  assert.equal(loaded.reviewedAtMs, 10_014);
  assert.equal(loaded.candidateStatus, "unselected");
  assert.equal(loaded.authorisationConsumed, false);
  assert.equal(loaded.activationAuthority, "none");
  assert.equal(loaded.executionAuthority, "none");
  assert.match(loaded.proposalVerificationSha256, /^[0-9a-f]{64}$/u);
  await assert.rejects(
    fixture.repository.loadPersistedAtTime(
      "f".repeat(64),
      10_014,
    ),
    /proposal is unavailable/u,
  );
  await assert.rejects(
    fixture.repository.loadPersistedAtTime(
      persisted.proposalSha256,
      10_011,
    ),
    /unavailable at proposal time/u,
  );
});

test("proposal review loading fails after known effective revocation", async () => {
  const { db, readinessAssessmentSha256 } = await database();
  const fixture =
    await proposalFixture(db, readinessAssessmentSha256);
  const persisted = await fixture.repository.persistAtTime(
    fixture.selector,
    10_013,
  );
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "review-loader-authoriser-revocation-v1",
      trustAnchorSha256:
        fixture.authorisation.trustAnchor.trustAnchorSha256,
      reason: "review-withdrawn",
      effectiveAtMs: 10_015,
      reviewedAtMs: 10_014,
      reviewEvidenceSha256: "e".repeat(64),
    },
    fixture.authorisation.trustAnchor,
  );
  execute(
    db,
    await prepareStrategySignerTrustRevocationPersistence(
      revocation,
      fixture.authorisation.trustAnchor,
      10_014,
    ),
  );
  await assert.rejects(
    fixture.repository.loadPersistedAtTime(
      persisted.proposalSha256,
      10_015,
    ),
    /trust is revoked/u,
  );
});
