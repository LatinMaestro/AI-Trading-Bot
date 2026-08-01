import assert from "node:assert/strict";
import test from "node:test";
import {
  createKrakenMaintenancePaperActivationManifest,
} from "../src/intelligence/krakenMaintenanceActivationManifest.ts";
import {
  KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
  KRAKEN_STATUS_API_REF,
} from "../src/intelligence/krakenScheduledMaintenanceIntelligence.ts";
import {
  EXTERNAL_INTELLIGENCE_MINUTE_CRON,
  EXTERNAL_INTELLIGENCE_QUEUE_NAME,
} from "../src/intelligence/externalIntelligenceRuntime.ts";

const APPROVED_AT_MS = Date.parse("2026-07-28T13:30:00.000Z");
const EFFECTIVE_FROM_MS = Date.parse("2026-07-29T00:00:00.000Z");
const EXPIRES_AT_MS = Date.parse("2027-01-29T00:00:00.000Z");

function input() {
  return {
    licenceSha256: "a".repeat(64),
    approvedAtMs: APPROVED_AT_MS,
    effectiveFromMs: EFFECTIVE_FROM_MS,
    expiresAtMs: EXPIRES_AT_MS,
  };
}

test("builds one exact non-activating paper Kraken maintenance manifest", async () => {
  const manifest =
    await createKrakenMaintenancePaperActivationManifest(input());
  assert.equal(
    manifest.schemaVersion,
    "kraken-maintenance-paper-activation-manifest-v1",
  );
  assert.equal(manifest.deploymentTarget, "paper");
  assert.equal(manifest.runtimeEnabledValue, "true");
  assert.equal(manifest.minuteCron, EXTERNAL_INTELLIGENCE_MINUTE_CRON);
  assert.equal(manifest.queueName, EXTERNAL_INTELLIGENCE_QUEUE_NAME);
  assert.equal(
    manifest.sourceContract.sourceId,
    KRAKEN_ACTIVE_MAINTENANCE_SOURCE_ID,
  );
  assert.equal(manifest.sourceContract.sourceKind, "official-exchange");
  assert.equal(manifest.sourceContract.authority, "authoritative");
  assert.deepEqual(
    manifest.sourceContract.allowedAcquisitionModes,
    ["minute-poll"],
  );
  assert.equal(manifest.sourceContract.contentPolicy, "digest-only");
  assert.equal(manifest.sourceContract.licenceRef, KRAKEN_STATUS_API_REF);
  assert.equal(manifest.sourceContract.modelTrainingAllowed, false);
  assert.equal(manifest.sourceContract.enabled, true);
  assert.match(
    manifest.sourceContract.sourceContractSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(manifest.activationManifestSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    JSON.parse(manifest.sourceContractJson),
    manifest.sourceContract,
  );
});

test("is deterministic and changes identity with reviewed evidence", async () => {
  const first =
    await createKrakenMaintenancePaperActivationManifest(input());
  const retry =
    await createKrakenMaintenancePaperActivationManifest(input());
  const changed =
    await createKrakenMaintenancePaperActivationManifest({
      ...input(),
      licenceSha256: "b".repeat(64),
    });
  assert.deepEqual(first, retry);
  assert.notEqual(
    first.sourceContract.sourceContractSha256,
    changed.sourceContract.sourceContractSha256,
  );
  assert.notEqual(
    first.activationManifestSha256,
    changed.activationManifestSha256,
  );
});

test("rejects invalid evidence digests and chronology", async () => {
  await assert.rejects(
    createKrakenMaintenancePaperActivationManifest({
      ...input(),
      licenceSha256: "not-a-digest",
    }),
    /lowercase SHA-256/u,
  );
  await assert.rejects(
    createKrakenMaintenancePaperActivationManifest({
      ...input(),
      approvedAtMs: EFFECTIVE_FROM_MS + 1,
    }),
    /chronology/u,
  );
  await assert.rejects(
    createKrakenMaintenancePaperActivationManifest({
      ...input(),
      expiresAtMs: EFFECTIVE_FROM_MS,
    }),
    /chronology/u,
  );
});

test("requires review renewal within 366 days", async () => {
  await assert.rejects(
    createKrakenMaintenancePaperActivationManifest({
      ...input(),
      expiresAtMs:
        EFFECTIVE_FROM_MS + 366 * 24 * 60 * 60 * 1_000 + 1,
    }),
    /cannot exceed 366 days/u,
  );
});
