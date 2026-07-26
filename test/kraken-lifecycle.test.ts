import assert from "node:assert/strict";
import test from "node:test";
import { prepareKrakenLifecycleNotice } from "../src/universe/krakenLifecycle.ts";

const DAY = 86_400_000;
const PUBLISHED = Date.UTC(2026, 4, 14, 12);
const FETCHED = PUBLISHED + 60_000;

function supportNotice() {
  return {
    noticeId: "scheduled-delistings-2026-05",
    sourceClass: "support-article" as const,
    sourceUrl:
      "https://support.kraken.com/hc/en-us/articles/notice-of-scheduled-asset-delistings-may-2026",
    fetchedAtMs: FETCHED,
    publishedAtMs: PUBLISHED,
    payloadText: "Official notice body captured exactly as fetched.",
    events: [
      {
        canonicalPair: "TEST/AUD",
        eventType: "delisted" as const,
        effectiveAtMs: PUBLISHED + 15 * DAY,
      },
      {
        canonicalPair: "TEST/AUD",
        eventType: "trading-suspended" as const,
        effectiveAtMs: PUBLISHED + 15 * DAY,
      },
    ],
  };
}

test("prepares deterministic official support evidence including future-effective events", async () => {
  const first = await prepareKrakenLifecycleNotice(supportNotice());
  const second = await prepareKrakenLifecycleNotice({
    ...supportNotice(),
    events: [...supportNotice().events].reverse(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.source.sourceKind, "official-lifecycle-announcement");
  assert.equal(first.source.fetchedAtMs, FETCHED);
  assert.match(first.source.payloadSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.announcements.length, 2);
  assert.ok(
    first.announcements.every(
      (announcement) => announcement.effectiveAtMs > announcement.publishedAtMs,
    ),
  );
});

test("limits status incidents to explicit suspension and resumption evidence", async () => {
  const prepared = await prepareKrakenLifecycleNotice({
    noticeId: "incident-api-2026-07-27",
    sourceClass: "status-incident",
    sourceUrl: "https://status.kraken.com/incidents/example-record",
    fetchedAtMs: FETCHED,
    publishedAtMs: PUBLISHED,
    payloadText: "Investigating degraded spot trading.",
    events: [
      {
        canonicalPair: "BTC/AUD",
        eventType: "trading-suspended",
        effectiveAtMs: PUBLISHED,
      },
      {
        canonicalPair: "BTC/AUD",
        eventType: "trading-resumed",
        effectiveAtMs: FETCHED,
      },
    ],
  });
  assert.deepEqual(
    prepared.announcements.map((event) => event.eventType),
    ["trading-suspended", "trading-resumed"],
  );

  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      sourceClass: "status-incident",
      sourceUrl: "https://status.kraken.com/incidents/example-record",
      events: [
        {
          canonicalPair: "TEST/AUD",
          eventType: "delisted",
          effectiveAtMs: PUBLISHED,
        },
      ],
    }),
    /only establish suspension or resumption/,
  );
});

test("rejects unofficial, non-canonical and duplicate lifecycle evidence", async () => {
  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      sourceUrl: "https://example.com/hc/en-us/articles/fake",
    }),
    /support\.kraken\.com/,
  );
  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      sourceUrl:
        "https://support.kraken.com/hc/en-us/articles/notice?tracking=untrusted",
    }),
    /without credentials, query or fragment/,
  );
  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      events: [
        supportNotice().events[0]!,
        supportNotice().events[0]!,
      ],
    }),
    /Duplicate Kraken lifecycle event/,
  );
  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      events: [
        {
          canonicalPair: "test/aud",
          eventType: "listed",
          effectiveAtMs: PUBLISHED,
        },
      ],
    }),
    /canonical uppercase BASE\/QUOTE pair/,
  );
});

test("rejects impossible source chronology and empty evidence", async () => {
  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      fetchedAtMs: PUBLISHED - 1,
    }),
    /fetched before publication/,
  );
  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      payloadText: "   ",
    }),
    /must not be empty/,
  );
  await assert.rejects(
    prepareKrakenLifecycleNotice({
      ...supportNotice(),
      events: [],
    }),
    /at least one explicit event/,
  );
});
