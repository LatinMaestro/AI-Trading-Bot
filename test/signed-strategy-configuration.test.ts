import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareSignedStrategyAuthorisation,
  prepareSignedStrategyConfiguration,
  REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS,
  strategyAuthorisationSigningPayload,
  strategyConfigurationSigningPayload,
  verifySignedStrategyAuthorisation,
  verifySignedStrategyConfiguration,
  type SignedStrategyAuthorisation,
  type SignedStrategyConfiguration,
  type UnsignedStrategyAuthorisation,
  type UnsignedStrategyConfiguration,
} from "../src/security/signedStrategyConfiguration.ts";

const ISSUED_AT_MS = 10_000;
const EFFECTIVE_FROM_MS = 11_000;
const EXPIRES_AT_MS = EFFECTIVE_FROM_MS + 30 * 86_400_000;

interface Keys {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
}

async function keys(): Promise<Keys> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function unsignedConfiguration(): UnsignedStrategyConfiguration {
  return {
    configurationVersion: "hourly-trend-breakout-config-v1",
    configuration: {
      strategyVersion: "hourly-trend-breakout-v0.1.0",
      venue: "kraken",
      countryCode: "AU",
      quoteCurrency: "AUD",
      configuredPairs: ["BTC/AUD", "ETH/AUD"],
      decisionIntervalMinutes: 60,
      spotOnly: true,
      longOnly: true,
      maximumOpenPositions: 1,
      maximumGrossExposure: 0.9,
      maximumRebalancesPerDay: 24,
      maximumCapitalAud: 200,
      drawdownResponse: "exit-to-aud-cash",
      feeModel: {
        makerFeeBps: 10,
        takerFeeBps: 20,
        maximumSpreadBps: 50,
        maximumTakerSlippageBps: 20,
        maximumPriceImpactBps: 35,
        missedFillPolicy: "leave-unfilled",
      },
      strategyPolicySha256: "1".repeat(64),
      signedUniversePolicySha256: "2".repeat(64),
      riskPolicySha256: "3".repeat(64),
      completeEvaluationSha256: "4".repeat(64),
      readinessAssessmentSha256: "5".repeat(64),
    },
    issuedAtMs: ISSUED_AT_MS,
    effectiveFromMs: EFFECTIVE_FROM_MS,
    expiresAtMs: EXPIRES_AT_MS,
    signerKeyId: "strategy-review-key-v1",
  };
}

async function signedConfiguration(): Promise<SignedStrategyConfiguration> {
  const signingKeys = await keys();
  const input = unsignedConfiguration();
  return prepareSignedStrategyConfiguration({
    ...input,
    ...({ unexpectedTransportField: "discard-me" }),
    verificationKeyJwk: signingKeys.publicJwk,
    signatureHex: await sign(
      strategyConfigurationSigningPayload(input),
      signingKeys.privateKey,
    ),
  });
}

function unsignedAuthorisation(
  configuration: SignedStrategyConfiguration,
): UnsignedStrategyAuthorisation {
  return {
    authorisationId: "owner-review-record-v1",
    authorisationScope: "canary-live",
    signedConfigurationSha256:
      configuration.signedConfigurationSha256,
    completeEvaluationSha256:
      configuration.configuration.completeEvaluationSha256,
    readinessAssessmentSha256:
      configuration.configuration.readinessAssessmentSha256,
    maximumCapitalAud: 200,
    reviewedAtMs: EFFECTIVE_FROM_MS,
    effectiveFromMs: EFFECTIVE_FROM_MS + 1_000,
    expiresAtMs: EFFECTIVE_FROM_MS + 7 * 86_400_000,
    riskAcknowledgements: REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS,
    authoriserKeyId: "external-owner-authoriser-v1",
  };
}

async function signedAuthorisation(
  configuration: SignedStrategyConfiguration,
): Promise<SignedStrategyAuthorisation> {
  const authorisationKeys = await keys();
  const input = unsignedAuthorisation(configuration);
  return prepareSignedStrategyAuthorisation(
    {
      ...input,
      verificationKeyJwk: authorisationKeys.publicJwk,
      signatureHex: await sign(
        strategyAuthorisationSigningPayload(input, configuration),
        authorisationKeys.privateKey,
      ),
    },
    configuration,
  );
}

test("verifies an exact public-key-only signed strategy configuration", async () => {
  const signed = await signedConfiguration();
  await verifySignedStrategyConfiguration(signed);
  assert.equal(signed.executionAuthority, "none");
  assert.equal("verificationKeyJwk" in signed, false);
  assert.equal("unexpectedTransportField" in signed, false);
  assert.equal(JSON.parse(signed.verificationKeyJwkJson).d, undefined);
});

test("rejects configuration mutation and unsafe strategy scope", async () => {
  const signed = await signedConfiguration();
  await assert.rejects(
    verifySignedStrategyConfiguration({
      ...signed,
      configuration: {
        ...signed.configuration,
        maximumGrossExposure: 1,
      },
    }),
    /signature verification failed/u,
  );
  const input = unsignedConfiguration();
  assert.throws(
    () => strategyConfigurationSigningPayload({
      ...input,
      configuration: {
        ...input.configuration,
        maximumGrossExposure: 1.01,
      },
    }),
    /gross exposure exceeds spot/u,
  );
  assert.throws(
    () => strategyConfigurationSigningPayload({
      ...input,
      configuration: {
        ...input.configuration,
        maximumCapitalAud: 1_000_001,
      },
    }),
    /capital exceeds researched range/u,
  );
});

test("rejects private verification keys and invalid chronology", async () => {
  const signingKeys = await keys();
  const privateJwk = await crypto.subtle.exportKey(
    "jwk",
    signingKeys.privateKey,
  );
  const input = unsignedConfiguration();
  await assert.rejects(
    prepareSignedStrategyConfiguration({
      ...input,
      verificationKeyJwk: privateJwk,
      signatureHex: "0".repeat(128),
    }),
    /public P-256 JWK/u,
  );
  assert.throws(
    () => strategyConfigurationSigningPayload({
      ...input,
      effectiveFromMs: input.expiresAtMs,
    }),
    /chronology is invalid/u,
  );
});

test("verifies exact externally signed authorisation without activating", async () => {
  const configuration = await signedConfiguration();
  const authorisation = await signedAuthorisation(configuration);
  await verifySignedStrategyAuthorisation(authorisation, configuration);
  assert.equal(authorisation.standaloneExecutionAuthority, "none");
  assert.equal(authorisation.requiresSeparateActivationChecklist, true);
  assert.equal("activationEnabled" in authorisation, false);
});

test("rejects authorisation identity, capital and risk-evidence drift", async () => {
  const configuration = await signedConfiguration();
  const input = unsignedAuthorisation(configuration);
  assert.throws(
    () => strategyAuthorisationSigningPayload({
      ...input,
      maximumCapitalAud: 201,
    }, configuration),
    /evidence is invalid/u,
  );
  assert.throws(
    () => strategyAuthorisationSigningPayload({
      ...input,
      readinessAssessmentSha256: "f".repeat(64),
    }, configuration),
    /evidence is invalid/u,
  );
  assert.throws(
    () => strategyAuthorisationSigningPayload({
      ...input,
      riskAcknowledgements: [
        "complete-approved-capital-loss-is-possible",
      ] as unknown as typeof REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS,
    }, configuration),
    /evidence is invalid/u,
  );
  assert.throws(
    () => strategyAuthorisationSigningPayload({
      ...input,
      reviewedAtMs: configuration.issuedAtMs - 1,
    }, configuration),
    /evidence is invalid/u,
  );
});

test("rejects authorisation mutation and a mismatched configuration", async () => {
  const configuration = await signedConfiguration();
  const authorisation = await signedAuthorisation(configuration);
  await assert.rejects(
    verifySignedStrategyAuthorisation({
      ...authorisation,
      authorisationScope: "paper",
    }, configuration),
    /signature verification failed/u,
  );
  await assert.rejects(
    verifySignedStrategyAuthorisation(authorisation, {
      ...configuration,
      signedConfigurationSha256: "e".repeat(64),
    }),
    /identity is invalid|evidence is invalid/u,
  );
});
