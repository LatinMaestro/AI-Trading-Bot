import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import type {
  RedditRetentionAudit,
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

async function observation(
  id: string,
  overrides: Partial<RedditTransientPostObservation> = {},
): Promise<RedditTransientPostObservation> {
  const subreddit = String(overrides.subreddit ?? "CryptoCurrency");
  const fullname = String(overrides.fullname ?? `t3_${id}`);
  const publishedAtMs = Number(overrides.publishedAtMs ?? 1_000);
  const metadataSha256 = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-transient-post-metadata-v1",
    sourceId: SOURCE_ID,
    subreddit,
    fullname,
    publishedAtMs,
  });
  const observationId = await sha256CanonicalIntelligence({
    schemaVersion: "reddit-transient-post-observation-v1",
    sourceContractSha256: CONTRACT_SHA,
    sourceId: SOURCE_ID,
    subreddit,
    fullname,
    publishedAtMs,
    metadataSha256,
  });
  return {
    observationId,
    sourceId: SOURCE_ID,
    sourceContractSha256: CONTRACT_SHA,
    captureId: "c".repeat(64),
    subreddit,
    fullname,
    sourceRef:
      "https://oauth.reddit.com/r/CryptoCurrency/new?limit=100&raw_json=1",
    publishedAtMs,
    receivedAtMs: 2_000,
    availableAtMs: 2_100,
    payloadSha256: "c".repeat(64),
    metadataSha256,
    deleteByMs: 3_000,
    contentPolicy: "metadata-only",
    payloadRetention: "transient-only",
    modelTrainingAllowed: false,
    ...overrides,
  };
}

async function batch(
  observations: readonly RedditTransientPostObservation[],
): Promise<RedditTransientPostBatch> {
  const input = {
    schemaVersion: "reddit-transient-post-batch-v1",
    sourceId: SOURCE_ID,
    sourceContractSha256: CONTRACT_SHA,
    captureId: "e".repeat(64),
    observationIds: observations.map((entry) => entry.observationId),
    ignoredUnavailableCount: 0,
  };
  return {
    batchId: await sha256CanonicalIntelligence(input),
    sourceId: SOURCE_ID,
    sourceContractSha256: CONTRACT_SHA,
    captureId: "e".repeat(64),
    observations,
    ignoredUnavailableCount: 0,
    durableQueueAllowed: false,
  };
}

async function retentionAudit(
  input: Omit<RedditRetentionAudit, "auditId">,
): Promise<RedditRetentionAudit> {
  return {
    auditId: await sha256CanonicalIntelligence({
      schemaVersion: "reddit-retention-audit-v1",
      ...input,
    }),
    ...input,
  };
}

function count(db: DatabaseSync, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

test("persists only purgeable metadata and content-free watch state", async () => {
  const db = database();
  const first = await observation("a");
  const second = await observation("b", {
    fullname: "t3_b",
    deleteByMs: 3_500,
  });
  const prepared = await prepareRedditTransientPostBatch(
      await batch([second, first]),
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

test("keeps the first deletion deadline across exact post refreshes", async () => {
  const db = database();
  const first = await observation("a");
  execute(
    db,
    await prepareRedditTransientPostBatch(await batch([first]), 2_200, OPERATION_1),
  );
  const refreshed = await observation("a", {
    availableAtMs: 2_500,
    receivedAtMs: 2_400,
    deleteByMs: 4_000,
    payloadSha256: "f".repeat(64),
  });
  execute(
    db,
    await prepareRedditTransientPostBatch(await batch([refreshed]), 2_600, OPERATION_2),
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

test("atomically purges unavailable posts and invalidates watch state", async () => {
  const db = database();
  const first = await observation("a");
  const second = await observation("b", { fullname: "t3_b", deleteByMs: 4_000 });
  execute(
    db,
    await prepareRedditTransientPostBatch(
      await batch([first, second]),
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
    audit: await retentionAudit({
      sourceId: SOURCE_ID,
      observedAtMs: 2_500,
      checkedCount: 2,
      presentCount: 1,
      providerUnavailableCount: 1,
      retentionExpiredCount: 0,
      retainedCount: 1,
      nextSweepAtMs: 4_000,
      containsRedditPostData: false,
    }),
    durableQueueAllowed: false,
  };
  execute(db, await prepareRedditRetentionSweep(sweep, OPERATION_2));

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
  const first = await observation("a");
  execute(
    db,
    await prepareRedditTransientPostBatch(await batch([first]), 2_200, OPERATION_1),
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

  const replacement = await observation("a", {
    availableAtMs: 4_000,
    receivedAtMs: 3_900,
    deleteByMs: 5_000,
  });
  execute(
    db,
    await prepareRedditTransientPostBatch(
      await batch([replacement]),
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

test("rejects changed identities, expired inserts and unsafe sweep evidence", async () => {
  const db = database();
  const first = await observation("a");
  execute(
    db,
    await prepareRedditTransientPostBatch(
      await batch([first]),
      2_200,
      OPERATION_1,
    ),
  );

  const changed = await observation("a", {
    metadataSha256: "9".repeat(64),
  });
  await assert.rejects(
    async () =>
      prepareRedditTransientPostBatch(
        await batch([changed]),
        2_300,
        OPERATION_2,
      ),
    /identity is invalid/,
  );

  const wrongCapture = await observation("b", {
    captureId: "d".repeat(64),
  });
  await assert.rejects(
    async () =>
      prepareRedditTransientPostBatch(
        await batch([wrongCapture]),
        2_300,
        OPERATION_2,
      ),
    /wrong contract or capture/,
  );

  const expired = await observation("c", { deleteByMs: 2_200 });
  await assert.rejects(
    async () =>
      prepareRedditTransientPostBatch(
        await batch([expired]),
        2_200,
        OPERATION_2,
      ),
    /not persistable/,
  );

  await assert.rejects(
    async () =>
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
