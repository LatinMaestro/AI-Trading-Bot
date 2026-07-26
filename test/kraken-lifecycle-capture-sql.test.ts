import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL,
  INSERT_KRAKEN_LIFECYCLE_PAYLOAD_SQL,
  KrakenLifecycleCaptureRepository,
  prepareKrakenLifecycleCapturePersistence,
  type KrakenLifecycleCaptureStatement,
} from "../src/storage/krakenLifecycleCapture.ts";
import type { KrakenLifecycleSourceCapture } from "../src/universe/krakenLifecycleCapture.ts";

const NOW = Date.UTC(2026, 6, 27);
const digest = (value: string) => value.repeat(64).slice(0, 64);

function capture(
  id = digest("a"),
  sourceRef = "https://status.kraken.com/api/v2/incidents.json",
): KrakenLifecycleSourceCapture {
  return {
    captureId: id,
    sourceKind: "status-incidents",
    sourceRef,
    fetchedAtMs: NOW,
    payloadSha256: digest("b"),
    payloadByteLength: 7,
    payloadText: "{\"a\":1}",
    contentType: "application/json",
    etag: '"v1"',
    lastModified: null,
  };
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "migrations/0001_init.sql",
    "migrations/0002_cycle_and_order_idempotency.sql",
    "migrations/0003_market_candles.sql",
    "migrations/0004_market_universe.sql",
    "migrations/0005_universe_integer_hardening.sql",
    "migrations/0006_universe_ingestion_batches.sql",
    "migrations/0007_kraken_lifecycle_source_captures.sql",
  ]) {
    db.exec(readFileSync(migration, "utf8"));
  }
  return db;
}

function executeAtomically(
  db: DatabaseSync,
  statements: readonly KrakenLifecycleCaptureStatement[],
): void {
  db.exec("BEGIN");
  try {
    for (const statement of statements) {
      db.prepare(statement.sql).run(...statement.params);
    }
    db.exec("COMMIT");
  } catch (error: unknown) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function count(db: DatabaseSync, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

test("persists captures atomically while deduplicating identical payload bytes", () => {
  const db = database();
  const first = capture();
  const second = {
    ...capture(
      digest("d"),
      "https://status.kraken.com/api/v2/scheduled-maintenances.json",
    ),
    sourceKind: "status-maintenance" as const,
  };
  const statements = prepareKrakenLifecycleCapturePersistence(
    [first, second],
    NOW + 1,
  );
  executeAtomically(db, statements);
  executeAtomically(db, statements);

  assert.equal(statements.length, 6);
  assert.equal(count(db, "kraken_lifecycle_source_payloads"), 1);
  assert.equal(count(db, "kraken_lifecycle_source_captures"), 2);
  assert.equal(count(db, "kraken_lifecycle_source_capture_commits"), 2);
});

test("rejects changed payload, capture and natural identities atomically", () => {
  const db = database();
  const original = capture();
  executeAtomically(
    db,
    prepareKrakenLifecycleCapturePersistence([original], NOW + 1),
  );

  assert.throws(
    () =>
      db.prepare(INSERT_KRAKEN_LIFECYCLE_PAYLOAD_SQL).run(
        digest("6"),
        1,
        "é",
      ),
    /CHECK constraint failed/,
  );

  const payloadConflict = {
    ...capture(
      digest("7"),
      "https://status.kraken.com/api/v2/incidents.json",
    ),
    fetchedAtMs: NOW + 10,
    payloadText: "{\"a\":2}",
  };
  assert.throws(
    () =>
      executeAtomically(
        db,
        prepareKrakenLifecycleCapturePersistence([payloadConflict], NOW + 11),
      ),
    /source payload conflict/,
  );

  const changedCapture = {
    ...original,
    payloadSha256: digest("e"),
  };
  assert.throws(
    () =>
      executeAtomically(
        db,
        prepareKrakenLifecycleCapturePersistence([changedCapture], NOW + 1),
      ),
    /capture payload conflict/,
  );
  assert.equal(
    db
      .prepare(
        "SELECT payload_sha256 FROM kraken_lifecycle_source_payloads WHERE payload_sha256 = ?",
      )
      .get(digest("e")),
    undefined,
  );

  const naturalConflict = { ...original, captureId: digest("f") };
  assert.throws(
    () =>
      executeAtomically(
        db,
        prepareKrakenLifecycleCapturePersistence([naturalConflict], NOW + 1),
      ),
    /natural identity conflict/,
  );

  assert.throws(
    () =>
      db.prepare(INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL).run(
        digest("9"),
        NOW,
      ),
    /capture is incomplete/,
  );
});

test("rejects a commit time before the source fetch", () => {
  const db = database();
  const prepared = prepareKrakenLifecycleCapturePersistence(
    [capture()],
    NOW + 1,
  );
  executeAtomically(db, prepared.slice(0, -1));
  assert.throws(
    () =>
      db.prepare(INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL).run(
        capture().captureId,
        NOW - 1,
      ),
    /capture is incomplete/,
  );
});

test("prevents mutation of committed capture and payload evidence", () => {
  const db = database();
  executeAtomically(
    db,
    prepareKrakenLifecycleCapturePersistence([capture()], NOW + 1),
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE kraken_lifecycle_source_captures SET fetched_at_ms = fetched_at_ms + 1",
        )
        .run(),
    /captures are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM kraken_lifecycle_source_payloads").run(),
    /payloads are immutable/,
  );
  assert.throws(
    () =>
      db.prepare("DELETE FROM kraken_lifecycle_source_capture_commits").run(),
    /commits are immutable/,
  );
});

test("repository submits one transactional three-statement group per capture", async () => {
  const prepared: Array<{
    readonly sql: string;
    readonly values: readonly unknown[];
  }> = [];
  let batches = 0;
  const fakeDb = {
    prepare(sql: string) {
      return {
        bind(...values: readonly unknown[]) {
          const statement = { sql, values };
          prepared.push(statement);
          return statement;
        },
      };
    },
    async batch(statements: readonly unknown[]) {
      batches += 1;
      assert.equal(statements.length, 6);
      return [];
    },
  };
  await new KrakenLifecycleCaptureRepository(
    fakeDb as unknown as D1Database,
  ).persistCaptures(
    [
      capture(),
      {
        ...capture(
          digest("d"),
          "https://status.kraken.com/api/v2/scheduled-maintenances.json",
        ),
        sourceKind: "status-maintenance",
      },
    ],
    NOW + 1,
  );
  assert.equal(batches, 1);
  assert.equal(prepared.length, 6);
});
