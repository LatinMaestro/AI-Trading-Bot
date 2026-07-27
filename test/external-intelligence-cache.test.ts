import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  D1ExternalIntelligenceCacheState,
  SELECT_EXTERNAL_INTELLIGENCE_CACHE_SQL,
  UPSERT_EXTERNAL_INTELLIGENCE_CACHE_SQL,
  validateExternalIntelligenceCacheValidators,
} from "../src/storage/externalIntelligenceCache.ts";

interface CacheRow {
  source_id: string;
  etag: string | null;
  last_modified: string | null;
  observed_at_ms: number;
}

class FakeStatement {
  private params: readonly unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly rows: Map<string, CacheRow>,
  ) {}

  bind(...params: readonly unknown[]): FakeStatement {
    this.params = params;
    return this;
  }

  async run(): Promise<void> {
    if (this.sql !== UPSERT_EXTERNAL_INTELLIGENCE_CACHE_SQL) {
      throw new Error("Unexpected fake D1 run statement");
    }
    const [sourceId, etag, lastModified, observedAtMs] = this.params as [
      string,
      string | null,
      string | null,
      number,
    ];
    const existing = this.rows.get(sourceId);
    if (existing !== undefined) {
      if (observedAtMs < existing.observed_at_ms) return;
      if (
        observedAtMs === existing.observed_at_ms &&
        (etag !== existing.etag || lastModified !== existing.last_modified)
      ) {
        throw new Error("External intelligence cache identity conflict");
      }
    }
    this.rows.set(sourceId, {
      source_id: sourceId,
      etag,
      last_modified: lastModified,
      observed_at_ms: observedAtMs,
    });
  }

  async first<T>(): Promise<T | null> {
    if (this.sql !== SELECT_EXTERNAL_INTELLIGENCE_CACHE_SQL) {
      throw new Error("Unexpected fake D1 first statement");
    }
    const [sourceId] = this.params as [string];
    return (this.rows.get(sourceId) ?? null) as T | null;
  }
}

class FakeD1 {
  private readonly rows = new Map<string, CacheRow>();

  prepare(sql: string): FakeStatement {
    return new FakeStatement(sql, this.rows);
  }
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0010_external_intelligence_cache.sql", "utf8"));
  return db;
}

test("cache migration preserves monotonic validators and exact retries", () => {
  const db = database();
  const write = db.prepare(
    `INSERT INTO external_intelligence_source_cache
      (source_id, etag, last_modified, observed_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       etag = excluded.etag,
       last_modified = excluded.last_modified,
       observed_at_ms = excluded.observed_at_ms`,
  );

  write.run("kraken-status", '"v1"', null, 1000);
  write.run("kraken-status", '"v1"', null, 1000);
  write.run("kraken-status", '"v2"', "Mon, 27 Jul 2026 04:00:00 GMT", 2000);

  assert.throws(
    () => write.run("kraken-status", '"stale"', null, 1500),
    /time cannot regress/,
  );
  assert.throws(
    () => write.run("kraken-status", '"conflict"', null, 2000),
    /identity conflict/,
  );

  assert.deepEqual(
    db.prepare(
      `SELECT source_id, etag, last_modified, observed_at_ms
       FROM external_intelligence_source_cache`,
    ).get(),
    {
      source_id: "kraken-status",
      etag: '"v2"',
      last_modified: "Mon, 27 Jul 2026 04:00:00 GMT",
      observed_at_ms: 2000,
    },
  );
});

test("D1 cache state loads, advances and rejects stale or conflicting saves", async () => {
  const cache = new D1ExternalIntelligenceCacheState(
    new FakeD1() as unknown as D1Database,
  );

  assert.equal(await cache.load("kraken-status"), undefined);
  await cache.save("kraken-status", { etag: '"v1"', lastModified: null }, 1000);
  assert.deepEqual(await cache.load("kraken-status"), {
    etag: '"v1"',
    lastModified: null,
  });

  await cache.save(
    "kraken-status",
    { etag: '"v2"', lastModified: "Mon, 27 Jul 2026 04:00:00 GMT" },
    2000,
  );
  await assert.rejects(
    cache.save("kraken-status", { etag: '"old"', lastModified: null }, 1500),
    /stale or conflicting/,
  );
  await assert.rejects(
    cache.save("kraken-status", { etag: '"conflict"', lastModified: null }, 2000),
    /identity conflict/,
  );
});

test("cache validation rejects malformed source and validator state", async () => {
  assert.throws(
    () => validateExternalIntelligenceCacheValidators({ etag: " bad ", lastModified: null }),
    /canonical text/,
  );
  assert.throws(
    () => validateExternalIntelligenceCacheValidators({ etag: null, lastModified: "" }),
    /canonical text/,
  );

  const cache = new D1ExternalIntelligenceCacheState(
    new FakeD1() as unknown as D1Database,
  );
  await assert.rejects(
    cache.save(" kraken-status", { etag: null, lastModified: null }, 1),
    /sourceId/,
  );
  await assert.rejects(
    cache.save("kraken-status", { etag: null, lastModified: null }, -1),
    /observedAtMs/,
  );
});
