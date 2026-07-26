import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  ACQUIRE_GLOBAL_LEASE_SQL,
  CLAIM_SCHEDULED_CYCLE_SQL,
  COMPLETE_SCHEDULED_CYCLE_SQL,
  FAIL_SCHEDULED_CYCLE_SQL,
  GLOBAL_CYCLE_LEASE_NAME,
  RELEASE_GLOBAL_LEASE_SQL,
  scheduleKeyFromTimestamp,
} from "../src/storage/cycleControl.ts";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_init.sql", "utf8"));
  db.exec(readFileSync("migrations/0002_cycle_and_order_idempotency.sql", "utf8"));
  return db;
}

test("schedule keys are deterministic and timestamp-specific", () => {
  assert.equal(
    scheduleKeyFromTimestamp(Date.UTC(2026, 6, 26, 6, 30)),
    "scheduled:2026-07-26T06:30:00.000Z",
  );
  assert.throws(() => scheduleKeyFromTimestamp(Number.NaN), /non-negative finite/);
});

test("global lease is exclusive and owner-guarded", () => {
  const db = database();
  const acquire = db.prepare(ACQUIRE_GLOBAL_LEASE_SQL);
  assert.equal(
    acquire.run(
      GLOBAL_CYCLE_LEASE_NAME,
      "holder-a",
      "2026-07-26T06:44:00.000Z",
      "2026-07-26T06:30:00.000Z",
    ).changes,
    1,
  );
  assert.equal(
    acquire.run(
      GLOBAL_CYCLE_LEASE_NAME,
      "holder-b",
      "2026-07-26T06:45:00.000Z",
      "2026-07-26T06:31:00.000Z",
    ).changes,
    0,
  );
  assert.equal(
    db.prepare(RELEASE_GLOBAL_LEASE_SQL).run(
      GLOBAL_CYCLE_LEASE_NAME,
      "holder-b",
    ).changes,
    0,
  );
  assert.equal(
    db.prepare(RELEASE_GLOBAL_LEASE_SQL).run(
      GLOBAL_CYCLE_LEASE_NAME,
      "holder-a",
    ).changes,
    1,
  );
});

test("expired global lease can be taken over", () => {
  const db = database();
  const acquire = db.prepare(ACQUIRE_GLOBAL_LEASE_SQL);
  acquire.run(
    GLOBAL_CYCLE_LEASE_NAME,
    "holder-a",
    "2026-07-26T06:44:00.000Z",
    "2026-07-26T06:30:00.000Z",
  );
  assert.equal(
    acquire.run(
      GLOBAL_CYCLE_LEASE_NAME,
      "holder-b",
      "2026-07-26T07:00:00.000Z",
      "2026-07-26T06:45:00.000Z",
    ).changes,
    1,
  );
});

test("completed schedule cannot be claimed twice", () => {
  const db = database();
  const claim = db.prepare(CLAIM_SCHEDULED_CYCLE_SQL);
  const key = "scheduled:2026-07-26T06:30:00.000Z";
  assert.equal(
    claim.run(
      key,
      "cycle-a",
      "holder-a",
      "2026-07-26T06:44:00.000Z",
      "2026-07-26T06:30:00.000Z",
    ).changes,
    1,
  );
  assert.equal(
    db.prepare(COMPLETE_SCHEDULED_CYCLE_SQL).run(
      "2026-07-26T06:31:00.000Z",
      "{\"outcome\":\"no-order\"}",
      key,
      "holder-a",
    ).changes,
    1,
  );
  assert.equal(
    claim.run(
      key,
      "cycle-b",
      "holder-b",
      "2026-07-26T07:14:00.000Z",
      "2026-07-26T07:00:00.000Z",
    ).changes,
    0,
  );
});

test("failed or expired running schedule can be retried", () => {
  const db = database();
  const claim = db.prepare(CLAIM_SCHEDULED_CYCLE_SQL);
  const failedKey = "scheduled:2026-07-26T06:30:00.000Z";
  claim.run(
    failedKey,
    "cycle-a",
    "holder-a",
    "2026-07-26T06:44:00.000Z",
    "2026-07-26T06:30:00.000Z",
  );
  assert.equal(
    db.prepare(FAIL_SCHEDULED_CYCLE_SQL).run(
      "2026-07-26T06:31:00.000Z",
      "{\"message\":\"provider unavailable\"}",
      failedKey,
      "holder-a",
    ).changes,
    1,
  );
  assert.equal(
    claim.run(
      failedKey,
      "cycle-b",
      "holder-b",
      "2026-07-26T06:46:00.000Z",
      "2026-07-26T06:32:00.000Z",
    ).changes,
    1,
  );
  const failedAttemptCount = db
    .prepare("SELECT attempt_count FROM cycle_runs WHERE schedule_key = ?")
    .get(failedKey) as { attempt_count: number };
  assert.equal(failedAttemptCount.attempt_count, 2);

  const expiredKey = "scheduled:2026-07-26T06:45:00.000Z";
  claim.run(
    expiredKey,
    "cycle-c",
    "holder-c",
    "2026-07-26T06:59:00.000Z",
    "2026-07-26T06:45:00.000Z",
  );
  assert.equal(
    claim.run(
      expiredKey,
      "cycle-d",
      "holder-d",
      "2026-07-26T07:14:00.000Z",
      "2026-07-26T07:00:00.000Z",
    ).changes,
    1,
  );
});
