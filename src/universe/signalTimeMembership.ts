import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  verifySignedUniversePolicy,
  verifyUniverseSnapshotManifest,
  type SignedUniversePolicy,
  type UniverseSnapshotManifest,
} from "./signedPolicySnapshot.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CANONICAL_AUD_PAIR = /^[A-Z0-9]{2,20}\/AUD$/u;

export interface UniverseSignalTimeMembership {
  readonly schemaVersion: "universe-signal-time-membership-v1";
  readonly decisionAtMs: number;
  readonly snapshotAsOfMs: number;
  readonly snapshotAvailableAtMs: number;
  readonly snapshotSha256: string;
  readonly signedPolicySha256: string;
  readonly eligiblePairs: readonly string[];
  readonly membershipSha256: string;
}

export interface PrepareUniverseSignalTimeMembershipInput {
  readonly decisionAtMs: number;
  readonly snapshotAvailableAtMs: number;
  readonly signedPolicy: SignedUniversePolicy;
  readonly manifest: UniverseSnapshotManifest;
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertEligiblePairs(values: readonly string[]): void {
  if (values.length > 500) {
    throw new Error("eligiblePairs exceeds the bounded universe");
  }
  values.forEach((pair, index) => {
    if (
      !CANONICAL_AUD_PAIR.test(pair) ||
      (index > 0 && values[index - 1]!.localeCompare(pair) >= 0)
    ) {
      throw new Error("eligiblePairs must be canonical, sorted and unique");
    }
  });
}

function canonicalMembership(
  input: Omit<UniverseSignalTimeMembership, "membershipSha256">,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: input.schemaVersion,
    decisionAtMs: input.decisionAtMs,
    snapshotAsOfMs: input.snapshotAsOfMs,
    snapshotAvailableAtMs: input.snapshotAvailableAtMs,
    snapshotSha256: input.snapshotSha256,
    signedPolicySha256: input.signedPolicySha256,
    eligiblePairs: input.eligiblePairs,
  };
}

function validateMembershipEnvelope(
  membership: Omit<UniverseSignalTimeMembership, "membershipSha256">,
): void {
  if (membership.schemaVersion !== "universe-signal-time-membership-v1") {
    throw new Error("universe signal-time membership schema is invalid");
  }
  assertTime("decisionAtMs", membership.decisionAtMs);
  assertTime("snapshotAsOfMs", membership.snapshotAsOfMs);
  assertTime("snapshotAvailableAtMs", membership.snapshotAvailableAtMs);
  assertDigest("snapshotSha256", membership.snapshotSha256);
  assertDigest("signedPolicySha256", membership.signedPolicySha256);
  assertEligiblePairs(membership.eligiblePairs);
  if (
    membership.snapshotAsOfMs > membership.snapshotAvailableAtMs ||
    membership.snapshotAvailableAtMs > membership.decisionAtMs
  ) {
    throw new Error(
      "universe snapshot was not available by the strategy decision",
    );
  }
}

export async function prepareUniverseSignalTimeMembership(
  input: PrepareUniverseSignalTimeMembershipInput,
): Promise<UniverseSignalTimeMembership> {
  await verifySignedUniversePolicy(input.signedPolicy);
  await verifyUniverseSnapshotManifest(input.manifest, input.signedPolicy);
  if (
    input.manifest.signedPolicySha256 !==
      input.signedPolicy.signedPolicySha256
  ) {
    throw new Error("universe snapshot and signed policy identity differ");
  }
  const membership = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs: input.decisionAtMs,
    snapshotAsOfMs: input.manifest.snapshot.asOfMs,
    snapshotAvailableAtMs: input.snapshotAvailableAtMs,
    snapshotSha256: input.manifest.snapshotSha256,
    signedPolicySha256: input.signedPolicy.signedPolicySha256,
    eligiblePairs: [...input.manifest.snapshot.eligiblePairs],
  } as const;
  validateMembershipEnvelope(membership);
  if (
    input.decisionAtMs < input.signedPolicy.effectiveFromMs ||
    input.decisionAtMs >= input.signedPolicy.expiresAtMs
  ) {
    throw new Error("signed universe policy is not valid at decision time");
  }
  if (
    input.decisionAtMs - input.manifest.snapshot.asOfMs >
    input.signedPolicy.policy.maximumObservationAgeMs
  ) {
    throw new Error("universe snapshot is stale at decision time");
  }
  return {
    ...membership,
    membershipSha256: await sha256CanonicalIntelligence(
      canonicalMembership(membership),
    ),
  };
}

export async function verifyUniverseSignalTimeMembership(
  membership: UniverseSignalTimeMembership,
): Promise<void> {
  const envelope = {
    schemaVersion: membership.schemaVersion,
    decisionAtMs: membership.decisionAtMs,
    snapshotAsOfMs: membership.snapshotAsOfMs,
    snapshotAvailableAtMs: membership.snapshotAvailableAtMs,
    snapshotSha256: membership.snapshotSha256,
    signedPolicySha256: membership.signedPolicySha256,
    eligiblePairs: membership.eligiblePairs,
  } as const;
  validateMembershipEnvelope(envelope);
  assertDigest("membershipSha256", membership.membershipSha256);
  const expected = await sha256CanonicalIntelligence(
    canonicalMembership(envelope),
  );
  if (
    expected !== membership.membershipSha256 ||
    canonicalIntelligenceJson(membership) !==
      canonicalIntelligenceJson({ ...envelope, membershipSha256: expected })
  ) {
    throw new Error("universe signal-time membership identity is invalid");
  }
}
