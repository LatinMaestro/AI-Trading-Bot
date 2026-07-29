import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { canonicalIntelligenceJson } from "../src/intelligence/canonical.ts";
import {
  prepareSignedUniversePolicy,
  prepareUniverseSnapshotManifest,
  verifySignedUniversePolicy,
  verifyUniverseSnapshotManifest,
  type SignedUniversePolicy,
  type SignedUniversePolicyInput,
  type UniverseSnapshotManifest,
} from "../src/universe/signedPolicySnapshot.ts";
import type {
  UniversePolicy,
  UniverseSnapshot,
} from "../src/universe/types.ts";
import {
  prepareUniversePolicySnapshotPersistence,
  UniversePolicySnapshotRepository,
} from "../src/storage/universePolicySnapshot.ts";

const APPROVED_AT_MS = Date.parse("2026-07-29T01:30:00.000Z");
const EFFECTIVE_FROM_MS = APPROVED_AT_MS + 60_000;
const EXPIRES_AT_MS = EFFECTIVE_FROM_MS + 365 * 86_400_000;
const AS_OF_MS = EFFECTIVE_FROM_MS + 3_600_000;
const INGESTION_BATCH_SHA256 = "d".repeat(64);
const SOURCE_DIGESTS = ["a".repeat(64), "b".repeat(64)] as const;
const CALIBRATION_DIGESTS = ["1".repeat(64), "2".repeat(64)] as const;

const POLICY: UniversePolicy = {
  venue: "kraken",
  countryCode: "AU",
  candidateOrderAud: 200,
  maximumObservationAgeMs: 900_000,
  newListingMaximumAgeMs: 30 * 86_400_000,
  newListingMinimumHourlyCandles: 72,
  establishedMinimumAgeMs: 180 * 86_400_000,
  establishedMinimumDailyCandles: 220,
  establishedMinimumHourlyCandles: 1_000,
  highVolatilityAnnualisedThreshold: 0.8,
  tierLimits: {
    established: {
      minimumQuoteTurnoverAud24h: 1_000_000,
      minimumAvailableQuoteVolumeAud: 10_000,
      maximumSpreadBps: 30,
      maximumEstimatedImpactBps: 20,
    },
    "high-volatility": {
      minimumQuoteTurnoverAud24h: 500_000,
      minimumAvailableQuoteVolumeAud: 5_000,
      maximumSpreadBps: 50,
      maximumEstimatedImpactBps: 35,
    },
    "new-listing": {
      minimumQuoteTurnoverAud24h: 250_000,
      minimumAvailableQuoteVolumeAud: 2_500,
      maximumSpreadBps: 80,
      maximumEstimatedImpactBps: 50,
    },
  },
};

const SNAPSHOT: UniverseSnapshot = {
  asOfMs: AS_OF_MS,
  venue: "kraken",
  countryCode: "AU",
  candidates: [
    {
      venue: "kraken",
      canonicalPair: "BTC/AUD",
      exchangePair: "XBTAUD",
      eligible: true,
      tier: "established",
      reasons: [],
      definitionId: "btc-definition",
      observationId: "btc-observation",
      lifecycle: {
        listedAtMs: AS_OF_MS - 365 * 86_400_000,
        online: true,
        availableInAustralia: true,
        latestTradingEvent: "trading-online",
        latestAustraliaEvent: "au-enabled",
      },
      listingAgeMs: 365 * 86_400_000,
    },
    {
      venue: "kraken",
      canonicalPair: "ETH/AUD",
      exchangePair: "ETHAUD",
      eligible: false,
      reasons: ["insufficient-execution-depth"],
      definitionId: "eth-definition",
      observationId: "eth-observation",
      lifecycle: {
        listedAtMs: AS_OF_MS - 365 * 86_400_000,
        online: true,
        availableInAustralia: true,
        latestTradingEvent: "trading-online",
        latestAustraliaEvent: "au-enabled",
      },
      listingAgeMs: 365 * 86_400_000,
    },
  ],
  eligiblePairs: ["BTC/AUD"],
};

interface SigningFixture {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
}

let signingFixture: Promise<SigningFixture> | undefined;

async function keys(): Promise<SigningFixture> {
  signingFixture ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    return {
      privateKey: pair.privateKey,
      publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
    };
  })();
  return signingFixture;
}

function unsignedPayload(
  input: Omit<SignedUniversePolicyInput, "verificationKeyJwk" | "signatureHex">,
): Readonly<Record<string, unknown>> {
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

async function signedPolicy(
  overrides: Partial<
    Omit<SignedUniversePolicyInput, "verificationKeyJwk" | "signatureHex">
  > = {},
): Promise<SignedUniversePolicy> {
  const fixture = await keys();
  const input = {
    policyVersion: "kraken-au-v1",
    policy: POLICY,
    calibrationSha256s: CALIBRATION_DIGESTS,
    approvedAtMs: APPROVED_AT_MS,
    effectiveFromMs: EFFECTIVE_FROM_MS,
    expiresAtMs: EXPIRES_AT_MS,
    signerKeyId: "owner-policy-key-v1",
    ...overrides,
  };
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      fixture.privateKey,
      new TextEncoder().encode(
        canonicalIntelligenceJson(unsignedPayload(input)),
      ),
    ),
  );
  const signatureHex = [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return prepareSignedUniversePolicy({
    ...input,
    verificationKeyJwk: fixture.publicJwk,
    signatureHex,
  });
}

async function manifest(
  policy?: SignedUniversePolicy,
  snapshot = SNAPSHOT,
): Promise<UniverseSnapshotManifest> {
  const effectivePolicy = policy ?? (await signedPolicy());
  return prepareUniverseSnapshotManifest({
    signedPolicy: effectivePolicy,
    ingestionBatchSha256: INGESTION_BATCH_SHA256,
    sourceDigests: SOURCE_DIGESTS,
    snapshot,
  });
}

class SQLiteD1 {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(sql: string) {
    let params: Array<string | number | null> = [];
    const prepared = this.sqlite.prepare(sql);
    const statement = {
      bind: (...values: Array<string | number | null>) => {
        params = values;
        return statement;
      },
      run: () => prepared.run(...params),
    };
    return statement;
  }

  batch(
    statements: readonly { run(): unknown }[],
  ): readonly unknown[] {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

async function database(): Promise<{
  readonly sqlite: DatabaseSync;
  readonly repository: UniversePolicySnapshotRepository;
}> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    `PRAGMA foreign_keys = ON;
     CREATE TABLE universe_ingestion_batch_commits (
       batch_sha256 TEXT PRIMARY KEY
     );
     CREATE TABLE universe_ingestion_batch_sources (
       batch_sha256 TEXT NOT NULL,
       source_digest TEXT NOT NULL,
       PRIMARY KEY (batch_sha256, source_digest)
     );
     INSERT INTO universe_ingestion_batch_commits (batch_sha256)
     VALUES ('${INGESTION_BATCH_SHA256}');
     INSERT INTO universe_ingestion_batch_sources
       (batch_sha256, source_digest)
     VALUES
       ('${INGESTION_BATCH_SHA256}', '${SOURCE_DIGESTS[0]}'),
       ('${INGESTION_BATCH_SHA256}', '${SOURCE_DIGESTS[1]}');`,
  );
  sqlite.exec(
    readFileSync(
      new URL(
        "../migrations/0017_signed_universe_policy_snapshots.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return {
    sqlite,
    repository: new UniversePolicySnapshotRepository(
      new SQLiteD1(sqlite) as unknown as D1Database,
    ),
  };
}

test("verifies an expiring P-256 signed universe policy", async () => {
  const signed = await signedPolicy();
  await verifySignedUniversePolicy(signed);
  assert.match(signed.signedPayloadSha256, /^[0-9a-f]{64}$/u);
  assert.match(signed.verificationKeySha256, /^[0-9a-f]{64}$/u);
  assert.match(signed.signedPolicySha256, /^[0-9a-f]{64}$/u);
  assert.equal(signed.signatureHex.length, 128);
  assert.equal(signed.verificationKeyJwkJson.includes('"d"'), false);
});

test("binds one exact committed evidence set to an immutable snapshot", async () => {
  const signed = await signedPolicy();
  const first = await manifest(signed);
  const second = await manifest(signed);
  assert.deepEqual(first, second);
  assert.equal(first.signedPolicySha256, signed.signedPolicySha256);
  assert.equal(first.snapshot.eligiblePairs.length, 1);
  await verifyUniverseSnapshotManifest(first, signed);
});

test("rejects signature, approval and calibration tampering", async () => {
  const signed = await signedPolicy();
  await assert.rejects(
    verifySignedUniversePolicy({
      ...signed,
      signatureHex: `${
        signed.signatureHex.startsWith("00") ? "01" : "00"
      }${signed.signatureHex.slice(2)}`,
    }),
    /signature verification failed|identity is invalid/u,
  );
  await assert.rejects(
    signedPolicy({ expiresAtMs: EFFECTIVE_FROM_MS }),
    /chronology/u,
  );
  await assert.rejects(
    signedPolicy({
      calibrationSha256s: [
        CALIBRATION_DIGESTS[1],
        CALIBRATION_DIGESTS[0],
      ],
    }),
    /sorted and unique/u,
  );
});

test("rejects inconsistent, unsorted and out-of-validity snapshots", async () => {
  const signed = await signedPolicy();
  const btcCandidate = SNAPSHOT.candidates[0]!;
  await assert.rejects(
    manifest(signed, { ...SNAPSHOT, eligiblePairs: ["ETH/AUD"] }),
    /eligiblePairs is inconsistent/u,
  );
  await assert.rejects(
    manifest(signed, {
      ...SNAPSHOT,
      candidates: [...SNAPSHOT.candidates].reverse(),
    }),
    /sorted and unique/u,
  );
  await assert.rejects(
    manifest(signed, {
      ...SNAPSHOT,
      candidates: [
        {
          ...btcCandidate,
          lifecycle: {
            ...btcCandidate.lifecycle,
            listedAtMs: AS_OF_MS + 1,
          },
          listingAgeMs: -1,
        },
        SNAPSHOT.candidates[1]!,
      ],
    }),
    /listing evidence is future/u,
  );
  await assert.rejects(
    manifest(signed, {
      ...SNAPSHOT,
      asOfMs: signed.expiresAtMs,
      candidates: [],
      eligiblePairs: [],
    }),
    /outside signed policy validity/u,
  );
});

test("persists exact retries and rejects policy or snapshot mutation", async () => {
  const { sqlite, repository } = await database();
  const signed = await signedPolicy();
  const snapshotManifest = await manifest(signed);
  const input = {
    signedPolicy: signed,
    manifest: snapshotManifest,
    persistedAtMs: AS_OF_MS + 1_000,
  };
  const statements = await prepareUniversePolicySnapshotPersistence(input);
  assert.equal(statements.length, 2);
  await repository.persist(input);
  await repository.persist({ ...input, persistedAtMs: AS_OF_MS + 2_000 });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM signed_universe_policies").get()
      ?.count,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM universe_policy_snapshots").get()
      ?.count,
    1,
  );
  assert.throws(
    () =>
      sqlite
        .prepare(
          `INSERT INTO universe_policy_snapshots
           SELECT snapshot_sha256, signed_policy_sha256,
                  ingestion_batch_sha256, as_of_ms, snapshot_json,
                  source_digests_json, candidate_count + 1,
                  eligible_pair_count, persisted_at_ms
           FROM universe_policy_snapshots`,
        )
        .run(),
    /conflict/u,
  );
  assert.throws(
    () =>
      sqlite
        .prepare(
          "UPDATE universe_policy_snapshots SET persisted_at_ms = persisted_at_ms + 1",
        )
        .run(),
    /immutable/u,
  );
  assert.throws(
    () =>
      sqlite.prepare("DELETE FROM signed_universe_policies").run(),
    /immutable/u,
  );
  sqlite.close();
});

test("fails closed on missing committed ingestion evidence and future persistence", async () => {
  const { sqlite, repository } = await database();
  const signed = await signedPolicy();
  const snapshotManifest = await manifest(signed);
  await assert.rejects(
    repository.persist({
      signedPolicy: signed,
      manifest: snapshotManifest,
      persistedAtMs: AS_OF_MS - 1,
    }),
    /persistence time/u,
  );
  const missing = await prepareUniverseSnapshotManifest({
    signedPolicy: signed,
    ingestionBatchSha256: "e".repeat(64),
    sourceDigests: SOURCE_DIGESTS,
    snapshot: SNAPSHOT,
  });
  await assert.rejects(
    repository.persist({
      signedPolicy: signed,
      manifest: missing,
      persistedAtMs: AS_OF_MS + 1_000,
    }),
    /evidence is not exactly committed/u,
  );
  const changedSources = await prepareUniverseSnapshotManifest({
    signedPolicy: signed,
    ingestionBatchSha256: INGESTION_BATCH_SHA256,
    sourceDigests: [SOURCE_DIGESTS[0]],
    snapshot: SNAPSHOT,
  });
  await assert.rejects(
    repository.persist({
      signedPolicy: signed,
      manifest: changedSources,
      persistedAtMs: AS_OF_MS + 1_000,
    }),
    /evidence is not exactly committed/u,
  );
  sqlite.close();
});
