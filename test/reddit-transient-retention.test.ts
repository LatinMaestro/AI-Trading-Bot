import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type {
  RedditRetentionSweep,
  RedditTransientPostBatch,
  RedditTransientPostObservation,
} from "../src/intelligence/redditPostLifecycle.ts";
import {
  prepareExpiredRedditPurge,
  prepareRedditRetentionSweep,
  prepareRedditTransientPostBatch,
  type RedditTransientRetentionStatement,
} from "../src/storage/redditTransientRetention.ts";

const SOURCE_ID = "reddit-cryptocurrency-new";
const CONTRACT_SHA = "b".repeat(64);
const OPERATION_1 = "11111111-1111-4111-8111-111111111111";
const OPERATION_2 = "22222222-2222-4222-8222-222222222222";
const OPERATION_3 = "33333333-3333-4333-8333-333333333333";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    readFileSync("migrations/0012_reddit_transient_retention.sql", "utf8"),
  );
  return db;
}

function execute(
  db: DatabaseSync,
  statements: readonly RedditTransientRetentionStatement[],
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

function observation(
  id: string,
  overrides: Partial<RedditTransientPostObservation> = {},
): RedditTransientPostObservation {
  return {
    observationId: id.repeat(64),
    sourceId: SOURCE_ID,
    sourceContractSha256: CONTRACT_SHA,
    subreddit: "CryptoCurrency",
    fullname: `t3_${id}`,
    sourceRef:
      "https://oauth.reddit.com/r/CryptoCurrency/new?limit=100&raw_json=1",
    publishedAtMs: 1_000,
    receivedAtMs: 2_000,
    availableAtMs: 2_100,
    payloadSha256: "c".repeat(64),
    metadataSha256: id.repeat(64),
    deleteByMs: 3_000,
    contentPolicy: "metadata-only",
    payloadRetention: "transient-only",
    modelTrainingAllowed: false,
    ...overrides,
  };
}

function batch(
  observations: readonly RedditTransientPostObservation[],
): RedditTransientPostBatch {
  return {
    batchId: "d".repeat(64),
    sourceId: SOURCE_ID,
    sourceContractSha256: CONTRACT_SHA,
    captureId: "e".repeat(64),
    observations,
    ignoredUnavailableCount: 0,
    durableQueueAllowed: false,
  };
}

function count(db: DatabaseSync, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

test("persists only purgeable metadata and content-free watch state", () => {
  const db = database();
  const first = observation("a");
  const second = observation("b", {
    fullname: "t3_b",
    deleteByMs: 3_500,
  });
  const prepared = prepareRedditTransientPostBatch(
    batch([second, first]),
    2_200,
    OPERATION_1,
  );
  const encoded = String(prepared[0]?.params[0]);
  for (const forbidden of [
    "sourceRef",
    "payloadSha256",
    "title",
    "selftext",
    "author",
    "permalink",
  ]) {
    assert.equal(encoded.includes(forbidden), false);
  }
  execute(db, prepared);

  assert.equal(count(db, "reddit_transient_post_observations"), 2);
  const state = db
    .prepare("SELECT * FROM reddit_transient_watch_state")
    .get() as Record<string, unknown>;
  assert.equal(state.status, "watch");
  assert.equal(state.active_observation_count, 2);
  assert.equal(state.valid_until_ms, 3_000);
  const event = db
    .prepare("SELECT * FROM reddit_watch_state_events")
    .get() as Record<string, unknown>;
  assert.equal(event.contains_reddit_post_data, 0);
  assert.equal(event.event_kind, "watch-refreshed");

  assert.throws(
    () =>
      db
        .prepare(
          "DELETE FROM reddit_transient_post_observations WHERE observation_id = ?",
        )
        .run(first.observationId),
    /requires purge authorization/,
  );
});

test("keeps the first deletion deadline across exact post refreshes", () => {
  const db = database();
  const first = observation("a");
  execute(
    db,
    prepareRedditTransientPostBatch(batch([first]), 2_200, OPERATION_1),
  );
  const refreshed = observation("a", {
    availableAtMs: 2_500,
    receivedAtMs: 2_400,
    deleteByMs: 4_000,
    payloadSha256: "f".repeat(64),
  });
  execute(
    db,
    prepareRedditTransientPostBatch(batch([refreshed]), 2_600, OPERATION_2),
  );
  const row = db
    .prepare(
      `SELECT first_seen_at_ms, last_seen_at_ms, delete_by_ms
       FROM reddit_transient_post_observations`,
    )
    .get() as Record<string, number>;
  assert.equal(row.first_seen_at_ms, 2_100);
  assert.equal(row.last_seen_at_ms, 2_500);
  assert.equal(row.delete_by_ms, 3_000);
  assert.equal(count(db, "reddit_transient_post_observations"), 1);
});

test("atomically purges unavailable posts and invalidates watch state", () => {
  const db = database();
  const first = observation("a");
  const second = observation("b", { fullname: "t3_b", deleteByMs: 4_000 });
  execute(
    db,
    prepareRedditTransientPostBatch(
      batch([first, second]),
      2_200,
      OPERATION_1,
    ),
  );
  const sweep: RedditRetentionSweep = {
    retained: [second],
    purges: [
      {
        observationId: first.observationId,
        reason: "provider-unavailable",
        purgeByMs: 2_500,
      },
    ],
    audit: {
      auditId: "f".repeat(64),
      sourceId: SOURCE_ID,
      observedAtMs: 2_500,
      checkedCount: 2,
      presentCount: 1,
      providerUnavailableCount: 1,
      retentionExpiredCount: 0,
      retainedCount: 1,
      nextSweepAtMs: 4_000,
      containsRedditPostData: false,
    },
    durableQueueAllowed: false,
  };
  execute(db, prepareRedditRetentionSweep(sweep, OPERATION_2));

  assert.equal(count(db, "reddit_transient_post_observations"), 1);
  assert.equal(count(db, "reddit_retention_audits"), 1);
  assert.equal(count(db, "reddit_transient_purge_authorizations"), 0);
  const state = db
    .prepare("SELECT * FROM reddit_transient_watch_state")
    .get() as Record<string, unknown>;
  assert.equal(state.status, "invalidated");
  assert.equal(state.active_observation_count, 1);
  assert.equal(state.invalidation_reason, "provider-unavailable");
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE reddit_retention_audits SET retained_count = 999",
        )
        .run(),
    /audits are immutable/,
  );
});

test("purges expired metadata even without a provider response", async () => {
  const db = database();
  const first = observation("a");
  execute(
    db,
    prepareRedditTransientPostBatch(batch([first]), 2_200, OPERATION_1),
  );
  execute(
    db,
    await prepareExpiredRedditPurge(
      SOURCE_ID,
      1,
      3_000,
      OPERATION_2,
    ),
  );
  assert.equal(count(db, "reddit_transient_post_observations"), 0);
  assert.equal(count(db, "reddit_transient_purge_authorizations"), 0);
  const state = db
    .prepare("SELECT * FROM reddit_transient_watch_state")
    .get() as Record<string, unknown>;
  assert.equal(state.status, "invalidated");
  assert.equal(state.active_observation_count, 0);
  assert.equal(state.invalidation_reason, "retention-expired");

  const replacement = observation("a", {
    availableAtMs: 4_000,
    receivedAtMs: 3_900,
    deleteByMs: 5_000,
  });
  execute(
    db,
    prepareRedditTransientPostBatch(
      batch([replacement]),
      4_100,
      OPERATION_3,
    ),
  );
  const refreshed = db
    .prepare("SELECT * FROM reddit_transient_watch_state")
    .get() as Record<string, unknown>;
  assert.equal(refreshed.status, "watch");
  assert.equal(refreshed.valid_until_ms, 5_000);
});

test("rejects identity conflicts, expired inserts and unsafe sweep evidence", () => {
  const db = database();
  const first = observation("a");
  execute(
    db,
    prepareRedditTransientPostBatch(batch([first]), 2_200, OPERATION_1),
  );
  const changed = observation("a", { metadataSha256: "9".repeat(64) });
  assert.throws(
    () =>
      execute(
        db,
        prepareRedditTransientPostBatch(
          batch([changed]),
          2_300,
          OPERATION_2,
        ),
      ),
    /observation conflict/,
  );
  assert.throws(
    () =>
      prepareRedditTransientPostBatch(
        batch([observation("c", { deleteByMs: 2_200 })]),
        2_200,
        OPERATION_2,
      ),
    /not persistable/,
  );
  assert.throws(
    () =>
      prepareRedditRetentionSweep(
        {
          retained: [],
          purges: [],
          audit: {
            auditId: "7".repeat(64),
            sourceId: SOURCE_ID,
            observedAtMs: 2_500,
            checkedCount: 1,
            presentCount: 0,
            providerUnavailableCount: 1,
            retentionExpiredCount: 0,
            retainedCount: 0,
            nextSweepAtMs: null,
            containsRedditPostData: false,
          },
          durableQueueAllowed: false,
        },
        OPERATION_3,
      ),
    /retention sweep is invalid/,
  );
});
