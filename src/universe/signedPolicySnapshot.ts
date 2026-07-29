import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import type {
  MarketLifecycleEventType,
  UniversePolicy,
  UniverseSnapshot,
  UniverseTier,
  UniverseTierLimits,
} from "./types.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const SIGNATURE_HEX = /^[0-9a-f]{128}$/u;
const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const SIGNER_KEY_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const P256_COORDINATE = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_CALIBRATION_DIGESTS = 100;
const MAXIMUM_POLICY_VALIDITY_MS = 366 * 86_400_000;
const encoder = new TextEncoder();
const TIERS: readonly UniverseTier[] = [
  "established",
  "high-volatility",
  "new-listing",
];
const LIFECYCLE_EVENTS = new Set<MarketLifecycleEventType>([
  "listed",
  "trading-online",
  "trading-suspended",
  "trading-resumed",
  "delisted",
  "au-enabled",
  "au-disabled",
]);

interface CanonicalP256PublicKey {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
}

export interface SignedUniversePolicyInput {
  readonly policyVersion: string;
  readonly policy: UniversePolicy;
  readonly calibrationSha256s: readonly string[];
  readonly approvedAtMs: number;
  readonly effectiveFromMs: number;
  readonly expiresAtMs: number;
  readonly signerKeyId: string;
  readonly verificationKeyJwk: JsonWebKey;
  readonly signatureHex: string;
}

export interface SignedUniversePolicy {
  readonly policyVersion: string;
  readonly policy: UniversePolicy;
  readonly calibrationSha256s: readonly string[];
  readonly approvedAtMs: number;
  readonly effectiveFromMs: number;
  readonly expiresAtMs: number;
  readonly signerKeyId: string;
  readonly verificationKeyJwkJson: string;
  readonly verificationKeySha256: string;
  readonly signatureHex: string;
  readonly signedPayloadJson: string;
  readonly signedPayloadSha256: string;
  readonly signedPolicySha256: string;
}

export interface UniverseSnapshotManifest {
  readonly signedPolicySha256: string;
  readonly ingestionBatchSha256: string;
  readonly sourceDigests: readonly string[];
  readonly snapshot: UniverseSnapshot;
  readonly snapshotSha256: string;
}

function assertCanonicalText(
  name: string,
  value: string,
  pattern?: RegExp,
): void {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new Error(`${name} is not canonical`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) throw new Error(`${name} is not SHA-256`);
}

function assertSafeTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function assertTierLimits(
  tier: UniverseTier,
  limits: UniverseTierLimits,
): void {
  assertNonNegativeFinite(
    `${tier}.minimumQuoteTurnoverAud24h`,
    limits.minimumQuoteTurnoverAud24h,
  );
  assertNonNegativeFinite(
    `${tier}.minimumAvailableQuoteVolumeAud`,
    limits.minimumAvailableQuoteVolumeAud,
  );
  assertNonNegativeFinite(
    `${tier}.maximumSpreadBps`,
    limits.maximumSpreadBps,
  );
  assertNonNegativeFinite(
    `${tier}.maximumEstimatedImpactBps`,
    limits.maximumEstimatedImpactBps,
  );
}

function assertPolicy(policy: UniversePolicy): void {
  assertCanonicalText("policy.venue", policy.venue);
  if (policy.countryCode !== "AU") {
    throw new Error("signed universe policy must use AU country scope");
  }
  if (!Number.isFinite(policy.candidateOrderAud) || policy.candidateOrderAud <= 0) {
    throw new Error("policy.candidateOrderAud must be finite and positive");
  }
  for (const [name, value] of [
    ["maximumObservationAgeMs", policy.maximumObservationAgeMs],
    ["newListingMaximumAgeMs", policy.newListingMaximumAgeMs],
    [
      "newListingMinimumHourlyCandles",
      policy.newListingMinimumHourlyCandles,
    ],
    ["establishedMinimumAgeMs", policy.establishedMinimumAgeMs],
    [
      "establishedMinimumDailyCandles",
      policy.establishedMinimumDailyCandles,
    ],
    [
      "establishedMinimumHourlyCandles",
      policy.establishedMinimumHourlyCandles,
    ],
  ] as const) {
    assertSafeTime(`policy.${name}`, value);
  }
  assertNonNegativeFinite(
    "policy.highVolatilityAnnualisedThreshold",
    policy.highVolatilityAnnualisedThreshold,
  );
  if (policy.establishedMinimumAgeMs < policy.newListingMaximumAgeMs) {
    throw new Error("signed universe policy has overlapping tier ages");
  }
  TIERS.forEach((tier) => assertTierLimits(tier, policy.tierLimits[tier]));
}

function assertSortedUniqueDigests(
  name: string,
  values: readonly string[],
  maximum: number,
): void {
  if (values.length < 1 || values.length > maximum) {
    throw new Error(`${name} count is outside bounds`);
  }
  values.forEach((value, index) => {
    assertDigest(`${name}[${index}]`, value);
    if (index > 0 && values[index - 1]!.localeCompare(value) >= 0) {
      throw new Error(`${name} must be sorted and unique`);
    }
  });
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
    throw new Error("universe policy signature must be 64-byte lowercase hex");
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

function unsignedPayload(input: {
  readonly policyVersion: string;
  readonly policy: UniversePolicy;
  readonly calibrationSha256s: readonly string[];
  readonly approvedAtMs: number;
  readonly effectiveFromMs: number;
  readonly expiresAtMs: number;
  readonly signerKeyId: string;
}): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "signed-universe-policy-v1",
    policyVersion: input.policyVersion,
    policy: input.policy,
    calibrationSha256s: input.calibrationSha256s,
    approvedAtMs: input.approvedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    signerKeyId: input.signerKeyId,
  };
}

function assertPolicyEnvelope(input: SignedUniversePolicyInput): void {
  assertCanonicalText(
    "policyVersion",
    input.policyVersion,
    POLICY_VERSION,
  );
  assertCanonicalText("signerKeyId", input.signerKeyId, SIGNER_KEY_ID);
  assertPolicy(input.policy);
  assertSortedUniqueDigests(
    "calibrationSha256s",
    input.calibrationSha256s,
    MAXIMUM_CALIBRATION_DIGESTS,
  );
  assertSafeTime("approvedAtMs", input.approvedAtMs);
  assertSafeTime("effectiveFromMs", input.effectiveFromMs);
  assertSafeTime("expiresAtMs", input.expiresAtMs);
  if (
    input.approvedAtMs > input.effectiveFromMs ||
    input.effectiveFromMs >= input.expiresAtMs ||
    input.expiresAtMs - input.effectiveFromMs >
      MAXIMUM_POLICY_VALIDITY_MS
  ) {
    throw new Error("universe policy approval chronology is invalid");
  }
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
    throw new Error("universe policy signature verification failed");
  }
}

export async function prepareSignedUniversePolicy(
  input: SignedUniversePolicyInput,
): Promise<SignedUniversePolicy> {
  assertPolicyEnvelope(input);
  const publicKey = canonicalP256PublicKey(input.verificationKeyJwk);
  const verificationKeyJwkJson = canonicalIntelligenceJson(publicKey);
  const signedPayloadJson = canonicalIntelligenceJson(unsignedPayload(input));
  await verifySignature(signedPayloadJson, input.signatureHex, publicKey);
  const verificationKeySha256 = await sha256CanonicalIntelligence(publicKey);
  const signedPayloadSha256 =
    await sha256CanonicalIntelligence(unsignedPayload(input));
  const signedPolicySha256 = await sha256CanonicalIntelligence({
    schemaVersion: "signed-universe-policy-envelope-v1",
    signedPayloadSha256,
    verificationKeySha256,
    signatureHex: input.signatureHex,
  });
  return {
    policyVersion: input.policyVersion,
    policy: input.policy,
    calibrationSha256s: [...input.calibrationSha256s],
    approvedAtMs: input.approvedAtMs,
    effectiveFromMs: input.effectiveFromMs,
    expiresAtMs: input.expiresAtMs,
    signerKeyId: input.signerKeyId,
    verificationKeyJwkJson,
    verificationKeySha256,
    signatureHex: input.signatureHex,
    signedPayloadJson,
    signedPayloadSha256,
    signedPolicySha256,
  };
}

export async function verifySignedUniversePolicy(
  signed: SignedUniversePolicy,
): Promise<void> {
  let verificationKeyJwk: JsonWebKey;
  try {
    verificationKeyJwk = JSON.parse(signed.verificationKeyJwkJson) as JsonWebKey;
  } catch {
    throw new Error("signed universe policy verification key JSON is invalid");
  }
  const prepared = await prepareSignedUniversePolicy({
    policyVersion: signed.policyVersion,
    policy: signed.policy,
    calibrationSha256s: signed.calibrationSha256s,
    approvedAtMs: signed.approvedAtMs,
    effectiveFromMs: signed.effectiveFromMs,
    expiresAtMs: signed.expiresAtMs,
    signerKeyId: signed.signerKeyId,
    verificationKeyJwk,
    signatureHex: signed.signatureHex,
  });
  if (
    canonicalIntelligenceJson(prepared) !== canonicalIntelligenceJson(signed)
  ) {
    throw new Error("signed universe policy identity is invalid");
  }
}

function assertSnapshot(snapshot: UniverseSnapshot, policy: UniversePolicy): void {
  assertSafeTime("snapshot.asOfMs", snapshot.asOfMs);
  if (
    snapshot.venue !== policy.venue ||
    snapshot.countryCode !== policy.countryCode
  ) {
    throw new Error("universe snapshot scope does not match signed policy");
  }
  const pairs = snapshot.candidates.map((candidate) => candidate.canonicalPair);
  if (
    new Set(pairs).size !== pairs.length ||
    pairs.some((pair, index) => {
      assertCanonicalText(`candidate[${index}].canonicalPair`, pair);
      return index > 0 && pairs[index - 1]!.localeCompare(pair) >= 0;
    })
  ) {
    throw new Error("universe snapshot candidates must be sorted and unique");
  }
  for (const candidate of snapshot.candidates) {
    if (candidate.venue !== policy.venue) {
      throw new Error("universe candidate venue does not match signed policy");
    }
    assertCanonicalText("candidate.exchangePair", candidate.exchangePair);
    assertCanonicalText("candidate.definitionId", candidate.definitionId);
    if (candidate.observationId !== undefined) {
      assertCanonicalText("candidate.observationId", candidate.observationId);
    }
    if (new Set(candidate.reasons).size !== candidate.reasons.length) {
      throw new Error("universe candidate reasons must be unique");
    }
    candidate.reasons.forEach((reason) =>
      assertCanonicalText("candidate.reason", reason),
    );
    if (
      (candidate.eligible &&
        (candidate.tier === undefined || candidate.reasons.length !== 0)) ||
      (!candidate.eligible && candidate.reasons.length === 0)
    ) {
      throw new Error("universe candidate eligibility evidence is invalid");
    }
    if (candidate.tier !== undefined && !TIERS.includes(candidate.tier)) {
      throw new Error("universe candidate tier is invalid");
    }
    for (const event of [
      candidate.lifecycle.latestTradingEvent,
      candidate.lifecycle.latestAustraliaEvent,
    ]) {
      if (event !== undefined && !LIFECYCLE_EVENTS.has(event)) {
        throw new Error("universe candidate lifecycle event is invalid");
      }
    }
    if (candidate.lifecycle.listedAtMs !== undefined) {
      assertSafeTime(
        "candidate.lifecycle.listedAtMs",
        candidate.lifecycle.listedAtMs,
      );
      if (
        candidate.lifecycle.listedAtMs > snapshot.asOfMs ||
        candidate.listingAgeMs === undefined
      ) {
        throw new Error("universe candidate listing evidence is future or incomplete");
      }
      assertSafeTime("candidate.listingAgeMs", candidate.listingAgeMs);
      if (candidate.listingAgeMs !== snapshot.asOfMs - candidate.lifecycle.listedAtMs) {
        throw new Error("universe candidate listing age is inconsistent");
      }
    } else if (candidate.listingAgeMs !== undefined) {
      throw new Error("universe candidate listing age lacks listing evidence");
    }
    if (candidate.lifecycle.delistedAtMs !== undefined) {
      assertSafeTime(
        "candidate.lifecycle.delistedAtMs",
        candidate.lifecycle.delistedAtMs,
      );
      if (candidate.lifecycle.delistedAtMs > snapshot.asOfMs) {
        throw new Error("universe candidate delisting evidence is future");
      }
    }
  }
  const eligiblePairs = snapshot.candidates
    .filter((candidate) => candidate.eligible)
    .map((candidate) => candidate.canonicalPair);
  if (
    canonicalIntelligenceJson(eligiblePairs) !==
    canonicalIntelligenceJson(snapshot.eligiblePairs)
  ) {
    throw new Error("universe snapshot eligiblePairs is inconsistent");
  }
}

export async function prepareUniverseSnapshotManifest(input: {
  readonly signedPolicy: SignedUniversePolicy;
  readonly ingestionBatchSha256: string;
  readonly sourceDigests: readonly string[];
  readonly snapshot: UniverseSnapshot;
}): Promise<UniverseSnapshotManifest> {
  await verifySignedUniversePolicy(input.signedPolicy);
  assertDigest("ingestionBatchSha256", input.ingestionBatchSha256);
  assertSortedUniqueDigests("sourceDigests", input.sourceDigests, 500);
  assertSnapshot(input.snapshot, input.signedPolicy.policy);
  if (
    input.snapshot.asOfMs < input.signedPolicy.effectiveFromMs ||
    input.snapshot.asOfMs >= input.signedPolicy.expiresAtMs
  ) {
    throw new Error("universe snapshot is outside signed policy validity");
  }
  const manifest = {
    signedPolicySha256: input.signedPolicy.signedPolicySha256,
    ingestionBatchSha256: input.ingestionBatchSha256,
    sourceDigests: [...input.sourceDigests],
    snapshot: input.snapshot,
  };
  return {
    ...manifest,
    snapshotSha256: await sha256CanonicalIntelligence({
      schemaVersion: "universe-snapshot-manifest-v1",
      ...manifest,
    }),
  };
}

export async function verifyUniverseSnapshotManifest(
  manifest: UniverseSnapshotManifest,
  signedPolicy: SignedUniversePolicy,
): Promise<void> {
  const prepared = await prepareUniverseSnapshotManifest({
    signedPolicy,
    ingestionBatchSha256: manifest.ingestionBatchSha256,
    sourceDigests: manifest.sourceDigests,
    snapshot: manifest.snapshot,
  });
  if (
    canonicalIntelligenceJson(prepared) !==
    canonicalIntelligenceJson(manifest)
  ) {
    throw new Error("universe snapshot manifest identity is invalid");
  }
}
