import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL,
  INSERT_KRAKEN_LIFECYCLE_CAPTURE_RUN_SQL,
  INSERT_KRAKEN_LIFECYCLE_DOCUMENTS_JSON_SQL,
  KrakenLifecycleCaptureRepository,
  prepareKrakenLifecycleCapturePersistence,
  type LifecycleCaptureStatement,
} from "../src/storage/krakenLifecycleCapture.ts";
import {
  captureKrakenLifecycleSources,
  type KrakenLifecycleCaptureRun,
} from "../src/universe/krakenLifecycleCapture.ts";

const SOURCE =
  "https://support.kraken.com/articles/notice-of-test-delisting";

async function run(body = "first"): Promise<KrakenLifecycleCaptureRun> {
  return captureKrakenLifecycleSources(
    [{ sourceClass: "delisting-notice", sourceRef: SOURCE }],
    {
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/html", ETag: `\"${body}\"` },
        }),
      clock: () => 1_000,
    },
  );
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
    "migrations/0007_kraken_lifecycle_capture.sql",
  ]) {
    db.exec(readFileSync(migration, "utf8"));
  }
  return db;
}

function executeAtomically(
  db: DatabaseSync,
  statements: readonly LifecycleCaptureStatement[],
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

test("persists lifecycle runs atomically and retries idempotently", async () => {
  const db = database();
  const capture = await run();
  const prepared = prepareKrakenLifecycleCapturePersistence(capture);
  assert.equal(prepared.statements.length, 4);

  executeAtomically(db, prepared.statements);
  executeAtomically(db, prepared.statements);

  assert.equal(count(db, "kraken_lifecycle_capture_runs"), 1);
  assert.equal(count(db, "kraken_lifecycle_source_documents"), 1);
  assert.equal(count(db, "kraken_lifecycle_capture_run_documents"), 1);
  assert.equal(count(db, "kraken_lifecycle_capture_run_commits"), 1);
  const stored = db
    .prepare(
      `SELECT source_ref AS sourceRef, payload_text AS payloadText,
              byte_length AS byteLength
       FROM kraken_lifecycle_source_documents`,
    )
    .get() as { sourceRef: string; payloadText: string; byteLength: number };
  assert.equal(stored.sourceRef, SOURCE);
  assert.equal(stored.payloadText, "first");
  assert.equal(stored.byteLength, 5);
});

test("natural identity conflicts roll back the complete second run", async () => {
  const db = database();
  const first = prepareKrakenLifecycleCapturePersistence(await run("first"));
  executeAtomically(db, first.statements);
  const second = prepareKrakenLifecycleCapturePersistence(await run("second"));

  assert.throws(
    () => executeAtomically(db, second.statements),
    /natural identity conflict/,
  );
  assert.equal(count(db, "kraken_lifecycle_capture_runs"), 1);
  assert.equal(count(db, "kraken_lifecycle_source_documents"), 1);
  assert.equal(count(db, "kraken_lifecycle_capture_run_commits"), 1);
});

test("incomplete runs cannot receive a commit marker", () => {
  const db = database();
  const digest = "a".repeat(64);
  db.prepare(INSERT_KRAKEN_LIFECYCLE_CAPTURE_RUN_SQL).run(
    digest,
    1_000,
    1,
    1,
  );
  assert.throws(
    () => db.prepare(INSERT_KRAKEN_LIFECYCLE_CAPTURE_COMMIT_SQL).run(digest),
    /lifecycle capture run is incomplete/,
  );
});

test("documents, memberships, runs and commits are immutable", async () => {
  const db = database();
  executeAtomically(
    db,
    prepareKrakenLifecycleCapturePersistence(await run()).statements,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE kraken_lifecycle_source_documents SET payload_text = 'changed'",
        )
        .run(),
    /source documents are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM kraken_lifecycle_capture_run_documents").run(),
    /memberships are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM kraken_lifecycle_capture_run_commits").run(),
    /commit markers are immutable/,
  );
});

test("repository submits one fixed four-statement D1 batch", async () => {
  const prepared: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
  let calls = 0;
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
      calls += 1;
      assert.equal(statements.length, 4);
      return [];
    },
  };
  const capture = await run();
  await new KrakenLifecycleCaptureRepository(
    fakeDb as unknown as D1Database,
  ).persistRun(capture);
  assert.equal(calls, 1);
  assert.equal(prepared.length, 4);
});

test("database constraints reject malformed JSON-expanded documents", () => {
  const db = database();
  const malformed = JSON.stringify([
    {
      documentSha256: "b".repeat(64),
      sourceClass: "unknown",
      sourceRef: SOURCE,
      fetchedAtMs: 1_000,
      payloadSha256: "c".repeat(64),
      contentType: "text/html",
      byteLength: 1,
      payloadText: "x",
    },
  ]);
  assert.throws(
    () => db.prepare(INSERT_KRAKEN_LIFECYCLE_DOCUMENTS_JSON_SQL).run(malformed),
    /CHECK constraint failed/,
  );
});
