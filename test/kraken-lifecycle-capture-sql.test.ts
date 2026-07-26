import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL,
  INSERT_KRAKEN_LIFECYCLE_CAPTURE_SQL,
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
    contentType: "application/json",
    etag: '"v1"',
    lastModified: null,
    chunks: [
      {
        index: 0,
        sha256: digest("c"),
        byteLength: 7,
        text: "{\"a\":1}",
      },
    ],
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

test("persists complete captures atomically and retries exact content idempotently", () => {
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
  assert.equal(count(db, "kraken_lifecycle_source_captures"), 2);
  assert.equal(count(db, "kraken_lifecycle_source_capture_chunks"), 2);
  assert.equal(count(db, "kraken_lifecycle_source_capture_commits"), 2);
});

test("rejects incomplete, changed and naturally conflicting capture identities", () => {
  const db = database();
  const original = capture();
  executeAtomically(
    db,
    prepareKrakenLifecycleCapturePersistence([original], NOW + 1),
  );

  const changed = { ...original, payloadSha256: digest("e") };
  assert.throws(
    () =>
      executeAtomically(
        db,
        prepareKrakenLifecycleCapturePersistence([changed], NOW + 1),
      ),
    /capture payload conflict/,
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

  const incompleteId = digest("9");
  db.prepare(INSERT_KRAKEN_LIFECYCLE_CAPTURE_SQL).run(
    incompleteId,
    "status-incidents",
    "https://status.kraken.com/api/v2/incidents.json?incomplete=1",
    NOW + 2,
    digest("8"),
    7,
    1,
    "application/json",
    null,
    null,
  );
  assert.throws(
    () =>
      db.prepare(INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL).run(
        incompleteId,
        NOW + 3,
      ),
    /capture is incomplete/,
  );
});

test("prevents mutation of committed capture evidence", () => {
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
    () =>
      db.prepare("DELETE FROM kraken_lifecycle_source_capture_chunks").run(),
    /chunks are immutable/,
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