import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
} from "../strategies/hourlyTrendBreakout.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const SIGNATURE_HEX = /^[0-9a-f]{128}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const RECORD_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const CANONICAL_PAIR = /^[A-Z0-9]{2,12}\/AUD$/u;
const P256_COORDINATE = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_CONFIGURATION_VALIDITY_MS = 366 * 86_400_000;
const MAXIMUM_AUTHORISATION_VALIDITY_MS = 31 * 86_400_000;
const MAXIMUM_CAPITAL_AUD = 1_000_000;
const MAXIMUM_BASIS_POINTS = 10_000;
const encoder = new TextEncoder();

export const REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS = [
  "complete-approved-capital-loss-is-possible",
  "five-year-objective-is-aspirational-not-a-forecast",
  "no-automatic-capital-top-up",
  "no-withdrawal-transfer-or-wallet-authority",
] as const;

interface CanonicalP256PublicKey {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
}

export interface HourlyTrendBreakoutFeeModel {
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
  readonly maximumSpreadBps: number;
  readonly maximumTakerSlippageBps: number;
  readonly maximumPriceImpactBps: number;
  readonly missedFillPolicy: "leave-unfilled";
}

export interface HourlyTrendBreakoutStrategyConfiguration {
  readonly strategyVersion:
    typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly venue: "kraken";
  readonly countryCode: "AU";
  readonly quoteCurrency: "AUD";
  readonly configuredPairs: readonly ["BTC/AUD", "ETH/AUD"];
  readonly decisionIntervalMinutes: 60;
  readonly spotOnly: true;
  readonly longOnly: true;
  readonly maximumOpenPositions: 1;
  readonly maximumGrossExposure: number;
  readonly maximumRebalancesPerDay: number;
  readonly maximumCapitalAud: number;
  readonly drawdownResponse: "exit-to-aud-cash";
  readonly feeModel: HourlyTrendBreakoutFeeModel;
  readonly strategyPolicySha256: string;
  readonly signedUniversePolicySha256: string;
  readonly riskPolicySha256: string;
  readonly completeEvaluationSha256: string;
  readonly readinessAssessmentSha256: string;
}

export interface UnsignedStrategyConfiguration {
  readonly configurationVersion: string;
  readonly configuration: HourlyTrendBreakoutStrategyConfiguration;
  readonly issuedAtMs: number;
  readonly effectiveFromMs: number;
  readonly expiresAtMs: number;
  readonly signerKeyId: string;
}

export interface SignedStrategyConfigurationInput
  extends UnsignedStrategyConfiguration {
  readonly verificationKeyJwk: JsonWebKey;
  readonly signatureHex: string;
}

export interface SignedStrategyConfiguration
  extends UnsignedStrategyConfiguration {
  readonly executionAuthority: "none";
  readonly verificationKeyJwkJson: string;
  readonly verificationKeySha256: string;
  readonly signatureHex: string;
  readonly signedPayloadJson: string;
  readonly signedPayloadSha256: string;
  readonly signedConfigurationSha256: string;
}

export type StrategyAuthorisationScope =
  | "paper"
  | "shadow"
  | "canary-live";

export interface UnsignedStrategyAuthorisation {
  readonly authorisationId: string;
  readonly authorisationScope: StrategyAuthorisationScope;
  readonly signedConfigurationSha256: string;
  readonly completeEvaluationSha256: string;
  readonly readinessAssessmentSha256: string;
  readonly maximumCapitalAud: number;
  readonly reviewedAtMs: number;
  readonly effectiveFromMs: number;
  readonly expiresAtMs: number;
  readonly riskAcknowledgements:
    typeof REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS;
  readonly authoriserKeyId: string;
}

export interface SignedStrategyAuthorisationInput
  extends UnsignedStrategyAuthorisation {
  readonly verificationKeyJwk: JsonWebKey;
  readonly signatureHex: string;
}

export interface SignedStrategyAuthorisation
  extends UnsignedStrategyAuthorisation {
  readonly standaloneExecutionAuthority: "none";
  readonly requiresSeparateActivationChecklist: true;
  readonly verificationKeyJwkJson: string;
  readonly verificationKeySha256: string;
  readonly signatureHex: string;
  readonly signedPayloadJson: string;
  readonly signedPayloadSha256: string;
  readonly signedAuthorisationSha256: string;
}

function assertCanonicalText(
  name: string,
  value: string,
  pattern: RegExp,
): void {
  if (value.trim() !== value || !pattern.test(value)) {
    throw new Error(`${name} is not canonical`);
  }
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and positive`);
  }
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) throw new Error(`${name} is not SHA-256`);
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
    throw new Error("verification key must be a public P-256 JWK");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

function signatureBytes(signatureHex: string): ArrayBuffer {
  if (!SIGNATURE_HEX.test(signatureHex)) {
    throw new Error("signature must be 64-byte lowercase hex");
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

async function verifySignature(
  payloadJson: string,
  signatureHex: string,
  key: CanonicalP256PublicKey,
): Promise<void> {
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { ...key, ext: true, key_ops: ["verify"] },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      signatureBytes(signatureHex),
      encoder.encode(payloadJson),
    ))
  ) {
    throw new Error("signature verification failed");
  }
}

function assertConfiguration(
  configuration: HourlyTrendBreakoutStrategyConfiguration,
): void {
  if (
    configuration.strategyVersion !==
      HOURLY_TREND_BREAKOUT_STRATEGY_VERSION ||
    configuration.venue !== "kraken" ||
    configuration.countryCode !== "AU" ||
    configuration.quoteCurrency !== "AUD" ||
    canonicalIntelligenceJson(configuration.configuredPairs) !==
      canonicalIntelligenceJson(["BTC/AUD", "ETH/AUD"]) ||
    configuration.configuredPairs.some((pair) =>
      !CANONICAL_PAIR.test(pair)
    ) ||
    configuration.decisionIntervalMinutes !== 60 ||
    configuration.spotOnly !== true ||
    configuration.longOnly !== true ||
    configuration.maximumOpenPositions !== 1 ||
    configuration.drawdownResponse !== "exit-to-aud-cash"
  ) {
    throw new Error("strategy configuration scope is invalid");
  }
  assertPositiveFinite(
    "configuration.maximumGrossExposure",
    configuration.maximumGrossExposure,
  );
  if (configuration.maximumGrossExposure > 1) {
    throw new Error("strategy configuration gross exposure exceeds spot");
  }
  if (
    !Number.isSafeInteger(configuration.maximumRebalancesPerDay) ||
    configuration.maximumRebalancesPerDay < 1 ||
    configuration.maximumRebalancesPerDay > 24
  ) {
    throw new Error("strategy configuration rebalance limit is invalid");
  }
  assertPositiveFinite(
    "configuration.maximumCapitalAud",
    configuration.maximumCapitalAud,
  );
  if (configuration.maximumCapitalAud > MAXIMUM_CAPITAL_AUD) {
    throw new Error("strategy configuration capital exceeds researched range");
  }
  const feeModel = configuration.feeModel;
  [
    ["makerFeeBps", feeModel.makerFeeBps],
    ["takerFeeBps", feeModel.takerFeeBps],
    ["maximumSpreadBps", feeModel.maximumSpreadBps],
    ["maximumTakerSlippageBps", feeModel.maximumTakerSlippageBps],
    ["maximumPriceImpactBps", feeModel.maximumPriceImpactBps],
  ].forEach(([name, value]) => {
    assertNonNegativeFinite(
      `configuration.feeModel.${name}`,
      value as number,
    );
    if ((value as number) > MAXIMUM_BASIS_POINTS) {
      throw new Error(`configuration.feeModel.${name} exceeds 100%`);
    }
  });
  if (feeModel.missedFillPolicy !== "leave-unfilled") {
    throw new Error("strategy configuration missed-fill policy is invalid");
  }
  ([
    ["strategyPolicySha256", configuration.strategyPolicySha256],
    ["signedUniversePolicySha256", configuration.signedUniversePolicySha256],
    ["riskPolicySha256", configuration.riskPolicySha256],
    ["completeEvaluationSha256", configuration.completeEvaluationSha256],
    ["readinessAssessmentSha256", configuration.readinessAssessmentSha256],
  ] satisfies ReadonlyArray<readonly [string, string]>).forEach(
    ([name, digest]) => assertDigest(`configuration.${name}`, digest),
  );
}

function assertConfigurationEnvelope(
  input: UnsignedStrategyConfiguration,
): void {
  assertCanonicalText(
    "configurationVersion",
    input.configurationVersion,
    VERSION,
  );
  assertCanonicalText("signerKeyId", input.signerKeyId, RECORD_ID);
  assertConfiguration(input.configuration);
  assertTimestamp("issuedAtMs", input.issuedAtMs);
  assertTimestamp("effectiveFromMs", input.effectiveFromMs);
  assertTimestamp("expiresAtMs", input.expiresAtMs);
  if (
    input.issuedAtMs > input.effectiveFromMs ||
    input.effectiveFromMs >= input.expiresAtMs ||
    input.expiresAtMs - input.effectiveFromMs >
      MAXIMUM_CONFIGURATION_VALIDITY_MS
  ) {
    throw new Error("strategy configuration chronology is invalid");
  }
}

export function strategyConfigurationSigningPayload(
  input: UnsignedStrategyConfiguration,
): string {
  assertConfigurationEnvelope(input);
  return canonicalIntelligenceJson({
    schemaVersion: "signed-strategy-configuration-v1",
    configurationVersion: input.configurationVersion,
    configuration: input.configuration,
    issuedAtMs: input.issuedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    signerKeyId: input.signerKeyId,
  });
}

export async function prepareSignedStrategyConfiguration(
  input: SignedStrategyConfigurationInput,
): Promise<SignedStrategyConfiguration> {
  const publicKey = canonicalP256PublicKey(input.verificationKeyJwk);
  const signedPayloadJson = strategyConfigurationSigningPayload(input);
  await verifySignature(signedPayloadJson, input.signatureHex, publicKey);
  const verificationKeyJwkJson = canonicalIntelligenceJson(publicKey);
  const verificationKeySha256 = await sha256CanonicalIntelligence(publicKey);
  const signedPayloadSha256 =
    await sha256CanonicalIntelligence(JSON.parse(signedPayloadJson));
  const envelope = {
    configurationVersion: input.configurationVersion,
    configuration: input.configuration,
    issuedAtMs: input.issuedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    signerKeyId: input.signerKeyId,
    executionAuthority: "none",
    verificationKeyJwkJson,
    verificationKeySha256,
    signatureHex: input.signatureHex,
    signedPayloadJson,
    signedPayloadSha256,
  } as const;
  return {
    ...envelope,
    signedConfigurationSha256: await sha256CanonicalIntelligence({
      schemaVersion: "signed-strategy-configuration-envelope-v1",
      signedPayloadSha256,
      verificationKeySha256,
      signatureHex: input.signatureHex,
      executionAuthority: "none",
    }),
  };
}

export async function verifySignedStrategyConfiguration(
  signed: SignedStrategyConfiguration,
): Promise<void> {
  let verificationKeyJwk: JsonWebKey;
  try {
    verificationKeyJwk = JSON.parse(
      signed.verificationKeyJwkJson,
    ) as JsonWebKey;
  } catch {
    throw new Error("strategy verification key JSON is invalid");
  }
  const prepared = await prepareSignedStrategyConfiguration({
    configurationVersion: signed.configurationVersion,
    configuration: signed.configuration,
    issuedAtMs: signed.issuedAtMs,
    effectiveFromMs: signed.effectiveFromMs,
    expiresAtMs: signed.expiresAtMs,
    signerKeyId: signed.signerKeyId,
    verificationKeyJwk,
    signatureHex: signed.signatureHex,
  });
  if (
    canonicalIntelligenceJson(prepared) !== canonicalIntelligenceJson(signed)
  ) {
    throw new Error("signed strategy configuration identity is invalid");
  }
}

function assertAuthorisationEnvelope(
  input: UnsignedStrategyAuthorisation,
  configuration: SignedStrategyConfiguration,
): void {
  assertCanonicalText(
    "authorisationId",
    input.authorisationId,
    RECORD_ID,
  );
  assertCanonicalText("authoriserKeyId", input.authoriserKeyId, RECORD_ID);
  if (
    !["paper", "shadow", "canary-live"].includes(input.authorisationScope)
  ) {
    throw new Error("strategy authorisation scope is invalid");
  }
  ([
    ["signedConfigurationSha256", input.signedConfigurationSha256],
    ["completeEvaluationSha256", input.completeEvaluationSha256],
    ["readinessAssessmentSha256", input.readinessAssessmentSha256],
  ] satisfies ReadonlyArray<readonly [string, string]>).forEach(
    ([name, digest]) => assertDigest(name, digest),
  );
  assertPositiveFinite("maximumCapitalAud", input.maximumCapitalAud);
  if (input.maximumCapitalAud > MAXIMUM_CAPITAL_AUD) {
    throw new Error("strategy authorisation capital exceeds researched range");
  }
  assertTimestamp("reviewedAtMs", input.reviewedAtMs);
  assertTimestamp("effectiveFromMs", input.effectiveFromMs);
  assertTimestamp("expiresAtMs", input.expiresAtMs);
  if (
    input.signedConfigurationSha256 !==
      configuration.signedConfigurationSha256 ||
    input.completeEvaluationSha256 !==
      configuration.configuration.completeEvaluationSha256 ||
    input.readinessAssessmentSha256 !==
      configuration.configuration.readinessAssessmentSha256 ||
    input.maximumCapitalAud >
      configuration.configuration.maximumCapitalAud ||
    input.reviewedAtMs < configuration.issuedAtMs ||
    input.reviewedAtMs > input.effectiveFromMs ||
    input.effectiveFromMs < configuration.effectiveFromMs ||
    input.effectiveFromMs >= input.expiresAtMs ||
    input.expiresAtMs > configuration.expiresAtMs ||
    input.expiresAtMs - input.effectiveFromMs >
      MAXIMUM_AUTHORISATION_VALIDITY_MS ||
    canonicalIntelligenceJson(input.riskAcknowledgements) !==
      canonicalIntelligenceJson(REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS)
  ) {
    throw new Error("strategy authorisation evidence is invalid");
  }
}

export function strategyAuthorisationSigningPayload(
  input: UnsignedStrategyAuthorisation,
  configuration: SignedStrategyConfiguration,
): string {
  assertAuthorisationEnvelope(input, configuration);
  return canonicalIntelligenceJson({
    schemaVersion: "signed-strategy-authorisation-v1",
    authorisationId: input.authorisationId,
    authorisationScope: input.authorisationScope,
    signedConfigurationSha256: input.signedConfigurationSha256,
    completeEvaluationSha256: input.completeEvaluationSha256,
    readinessAssessmentSha256: input.readinessAssessmentSha256,
    maximumCapitalAud: input.maximumCapitalAud,
    reviewedAtMs: input.reviewedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    riskAcknowledgements: input.riskAcknowledgements,
    authoriserKeyId: input.authoriserKeyId,
  });
}

export async function prepareSignedStrategyAuthorisation(
  input: SignedStrategyAuthorisationInput,
  configuration: SignedStrategyConfiguration,
): Promise<SignedStrategyAuthorisation> {
  await verifySignedStrategyConfiguration(configuration);
  const publicKey = canonicalP256PublicKey(input.verificationKeyJwk);
  const signedPayloadJson = strategyAuthorisationSigningPayload(
    input,
    configuration,
  );
  await verifySignature(signedPayloadJson, input.signatureHex, publicKey);
  const verificationKeyJwkJson = canonicalIntelligenceJson(publicKey);
  const verificationKeySha256 = await sha256CanonicalIntelligence(publicKey);
  const signedPayloadSha256 =
    await sha256CanonicalIntelligence(JSON.parse(signedPayloadJson));
  const envelope = {
    authorisationId: input.authorisationId,
    authorisationScope: input.authorisationScope,
    signedConfigurationSha256: input.signedConfigurationSha256,
    completeEvaluationSha256: input.completeEvaluationSha256,
    readinessAssessmentSha256: input.readinessAssessmentSha256,
    maximumCapitalAud: input.maximumCapitalAud,
    reviewedAtMs: input.reviewedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    riskAcknowledgements: input.riskAcknowledgements,
    authoriserKeyId: input.authoriserKeyId,
    standaloneExecutionAuthority: "none",
    requiresSeparateActivationChecklist: true,
    verificationKeyJwkJson,
    verificationKeySha256,
    signatureHex: input.signatureHex,
    signedPayloadJson,
    signedPayloadSha256,
  } as const;
  return {
    ...envelope,
    signedAuthorisationSha256: await sha256CanonicalIntelligence({
      schemaVersion: "signed-strategy-authorisation-envelope-v1",
      signedConfigurationSha256: input.signedConfigurationSha256,
      signedPayloadSha256,
      verificationKeySha256,
      signatureHex: input.signatureHex,
      standaloneExecutionAuthority: "none",
      requiresSeparateActivationChecklist: true,
    }),
  };
}

export async function verifySignedStrategyAuthorisation(
  signed: SignedStrategyAuthorisation,
  configuration: SignedStrategyConfiguration,
): Promise<void> {
  let verificationKeyJwk: JsonWebKey;
  try {
    verificationKeyJwk = JSON.parse(
      signed.verificationKeyJwkJson,
    ) as JsonWebKey;
  } catch {
    throw new Error("authorisation verification key JSON is invalid");
  }
  const prepared = await prepareSignedStrategyAuthorisation(
    {
      authorisationId: signed.authorisationId,
      authorisationScope: signed.authorisationScope,
      signedConfigurationSha256: signed.signedConfigurationSha256,
      completeEvaluationSha256: signed.completeEvaluationSha256,
      readinessAssessmentSha256: signed.readinessAssessmentSha256,
      maximumCapitalAud: signed.maximumCapitalAud,
      reviewedAtMs: signed.reviewedAtMs,
      effectiveFromMs: signed.effectiveFromMs,
      expiresAtMs: signed.expiresAtMs,
      riskAcknowledgements: signed.riskAcknowledgements,
      authoriserKeyId: signed.authoriserKeyId,
      verificationKeyJwk,
      signatureHex: signed.signatureHex,
    },
    configuration,
  );
  if (
    canonicalIntelligenceJson(prepared) !== canonicalIntelligenceJson(signed)
  ) {
    throw new Error("signed strategy authorisation identity is invalid");
  }
}
