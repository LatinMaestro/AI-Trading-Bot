import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareStrategySelectionProposal,
  verifyStrategySelectionProposal,
} from "../src/research/strategySelectionProposal.ts";
import {
  deriveP256VerificationKeySha256,
  prepareSignedStrategyAuthorisation,
  prepareSignedStrategyConfiguration,
  REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS,
  strategyAuthorisationSigningPayload,
  strategyConfigurationSigningPayload,
  type SignedStrategyAuthorisation,
  type SignedStrategyConfiguration,
  type UnsignedStrategyAuthorisation,
  type UnsignedStrategyConfiguration,
} from "../src/security/signedStrategyConfiguration.ts";
import {
  prepareReviewedStrategySignerTrustAnchor,
  prepareStrategySignerTrustRevocation,
  type ReviewedStrategySignerTrustAnchor,
} from "../src/security/strategySignerTrust.ts";
import type {
  VerifiedStrategyConfigurationAtTime,
} from "../src/storage/signedStrategyConfiguration.ts";
import {
  sha256CanonicalIntelligence,
} from "../src/intelligence/canonical.ts";

interface Keys {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
}

interface Fixture {
  readonly input: Parameters<typeof prepareStrategySelectionProposal>[0];
  readonly configuration: SignedStrategyConfiguration;
  readonly authorisation: SignedStrategyAuthorisation;
  readonly configurationKeys: Keys;
  readonly authorisationKeys: Keys;
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

async function trustAnchor(
  role:
    | "strategy-configuration-signer"
    | "external-strategy-authoriser",
  keyId: string,
  publicJwk: JsonWebKey,
  suffix: string,
): Promise<ReviewedStrategySignerTrustAnchor> {
  return prepareReviewedStrategySignerTrustAnchor({
    trustAnchorId: `proposal-${suffix}-trust-v1`,
    role,
    keyId,
    verificationKeySha256:
      await deriveP256VerificationKeySha256(publicJwk),
    reviewEvidenceSha256: suffix.repeat(64),
    reviewedAtMs: 9_000,
    validFromMs: 9_500,
    validUntilMs: 50_000,
    predecessorTrustAnchorSha256: null,
  });
}

async function fixture(): Promise<Fixture> {
  const configurationKeys = await keys();
  const authorisationKeys = await keys();
  const unsignedConfiguration: UnsignedStrategyConfiguration = {
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
    issuedAtMs: 10_000,
    effectiveFromMs: 11_000,
    expiresAtMs: 40_000,
    signerKeyId: "strategy-review-key-v1",
  };
  const configurationAnchor = await trustAnchor(
    "strategy-configuration-signer",
    unsignedConfiguration.signerKeyId,
    configurationKeys.publicJwk,
    "a",
  );
  const configuration = await prepareSignedStrategyConfiguration(
    {
      ...unsignedConfiguration,
      verificationKeyJwk: configurationKeys.publicJwk,
      signatureHex: await sign(
        strategyConfigurationSigningPayload(unsignedConfiguration),
        configurationKeys.privateKey,
      ),
    },
    {
      keyId: configurationAnchor.keyId,
      verificationKeySha256: configurationAnchor.verificationKeySha256,
    },
  );
  const unsignedAuthorisation: UnsignedStrategyAuthorisation = {
    authorisationId: "owner-review-record-v1",
    authorisationScope: "canary-live",
    signedConfigurationSha256: configuration.signedConfigurationSha256,
    completeEvaluationSha256:
      configuration.configuration.completeEvaluationSha256,
    readinessAssessmentSha256:
      configuration.configuration.readinessAssessmentSha256,
    maximumCapitalAud: 200,
    reviewedAtMs: 11_500,
    effectiveFromMs: 12_000,
    expiresAtMs: 30_000,
    riskAcknowledgements: REQUIRED_STRATEGY_RISK_ACKNOWLEDGEMENTS,
    authoriserKeyId: "external-owner-authoriser-v1",
  };
  const authoriserAnchor = await trustAnchor(
    "external-strategy-authoriser",
    unsignedAuthorisation.authoriserKeyId,
    authorisationKeys.publicJwk,
    "b",
  );
  const authorisation = await prepareSignedStrategyAuthorisation(
    {
      ...unsignedAuthorisation,
      verificationKeyJwk: authorisationKeys.publicJwk,
      signatureHex: await sign(
        strategyAuthorisationSigningPayload(
          unsignedAuthorisation,
          configuration,
        ),
        authorisationKeys.privateKey,
      ),
    },
    configuration,
    {
      keyId: configurationAnchor.keyId,
      verificationKeySha256: configurationAnchor.verificationKeySha256,
    },
    {
      keyId: authoriserAnchor.keyId,
      verificationKeySha256: authoriserAnchor.verificationKeySha256,
    },
  );
  const verificationContent = {
    schemaVersion: "verified-strategy-configuration-at-time-v1",
    signedConfigurationSha256: configuration.signedConfigurationSha256,
    decisionAtMs: 12_500,
    signerTrustAnchorSha256: configurationAnchor.trustAnchorSha256,
    signerTrustRevocationSha256: null,
    readinessAssessmentSha256:
      configuration.configuration.readinessAssessmentSha256,
    completeEvaluationSha256:
      configuration.configuration.completeEvaluationSha256,
    researchReportSha256: "6".repeat(64),
    executionCalibrationSha256: "7".repeat(64),
    executionStressManifestSha256: "8".repeat(64),
    selectionAuthority: "none",
    executionAuthority: "none",
  } as const;
  const verifiedConfiguration: VerifiedStrategyConfigurationAtTime = {
    ...verificationContent,
    configuration,
    verificationEvidenceSha256:
      await sha256CanonicalIntelligence(verificationContent),
  };
  return {
    configuration,
    authorisation,
    configurationKeys,
    authorisationKeys,
    input: {
      proposalId: "hourly-trend-breakout-review-proposal-v1",
      proposedAtMs: 13_000,
      verifiedConfiguration,
      configurationSignerTrustAnchor: configurationAnchor,
      configurationSignerTrustRevocation: null,
      authorisation,
      authoriserTrustAnchor: authoriserAnchor,
      authoriserTrustRevocation: null,
    },
  };
}

test("creates a content-addressed non-activating review proposal", async () => {
  const value = await fixture();
  const proposal = await prepareStrategySelectionProposal(value.input);
  assert.equal(proposal.candidateStatus, "unselected");
  assert.equal(proposal.selectionDecision, "none");
  assert.equal(proposal.activationAuthority, "none");
  assert.equal(proposal.executionAuthority, "none");
  assert.equal(proposal.authorisationScope, "canary-live");
  assert.equal(proposal.maximumCapitalAud, 200);
  assert.equal("selectedStrategy" in proposal, false);
  await verifyStrategySelectionProposal(proposal, value.input);
  await assert.rejects(
    verifyStrategySelectionProposal(
      { ...proposal, maximumCapitalAud: 201 },
      value.input,
    ),
    /identity is invalid/u,
  );
  await assert.rejects(
    verifyStrategySelectionProposal(
      {
        ...proposal,
        warnings: proposal.warnings.slice(0, 3) as never,
      },
      value.input,
    ),
    /identity is invalid/u,
  );
  await assert.rejects(
    verifyStrategySelectionProposal(
      { ...proposal, selectionDecision: "approved" as never },
      value.input,
    ),
    /identity is invalid/u,
  );
});

test("rejects changed verification and mismatched authorisation", async () => {
  const value = await fixture();
  await assert.rejects(
    prepareStrategySelectionProposal({
      ...value.input,
      verifiedConfiguration: {
        ...value.input.verifiedConfiguration,
        completeEvaluationSha256: "9".repeat(64),
      },
    }),
    /identity is invalid/u,
  );
  await assert.rejects(
    prepareStrategySelectionProposal({
      ...value.input,
      authorisation: {
        ...value.authorisation,
        signedConfigurationSha256: "9".repeat(64),
      },
    }),
    /authorisation evidence is invalid/u,
  );
});

test("rejects expired or revoked signer trust at proposal time", async () => {
  const value = await fixture();
  await assert.rejects(
    prepareStrategySelectionProposal({
      ...value.input,
      proposedAtMs: value.authorisation.expiresAtMs,
    }),
    /authorisation evidence is invalid/u,
  );
  const revocation = await prepareStrategySignerTrustRevocation(
    {
      revocationId: "external-authoriser-revocation-v1",
      trustAnchorSha256:
        value.input.authoriserTrustAnchor.trustAnchorSha256,
      reason: "review-withdrawn",
      effectiveAtMs: 12_900,
      reviewedAtMs: 12_800,
      reviewEvidenceSha256: "c".repeat(64),
    },
    value.input.authoriserTrustAnchor,
  );
  await assert.rejects(
    prepareStrategySelectionProposal({
      ...value.input,
      authoriserTrustRevocation: revocation,
    }),
    /trust is revoked/u,
  );
});

test("rejects role drift and self-authorisation", async () => {
  const value = await fixture();
  await assert.rejects(
    prepareStrategySelectionProposal({
      ...value.input,
      authoriserTrustAnchor:
        value.input.configurationSignerTrustAnchor,
    }),
    /trust is not active/u,
  );
  const selfAuthoriserAnchor = await trustAnchor(
    "external-strategy-authoriser",
    value.authorisation.authoriserKeyId,
    value.configurationKeys.publicJwk,
    "d",
  );
  await assert.rejects(
    prepareStrategySelectionProposal({
      ...value.input,
      authoriserTrustAnchor: selfAuthoriserAnchor,
    }),
    /self-authorisation|does not match reviewed trust/u,
  );
});
