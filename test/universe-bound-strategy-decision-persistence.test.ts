import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { StrategyDecision } from "../src/domain/types.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import {
  bindUniverseMembershipToStrategyDecision,
  type UniverseBoundStrategyDecision,
} from "../src/strategies/universeBoundDecision.ts";
import {
  prepareUniverseBoundStrategyDecisionPersistence,
  UniverseBoundStrategyDecisionRepository,
} from "../src/storage/universeBoundStrategyDecision.ts";
import type { UniverseSignalTimeMembership } from "../src/universe/signalTimeMembership.ts";

const DECISION_AT_MS = Date.parse("2026-07-29T05:00:00.000Z");
const CYCLE_A = "00000000-0000-4000-8000-000000000001";
const CYCLE_B = "00000000-0000-4000-8000-000000000002";

async function membership(
  eligiblePairs: readonly string[] = ["BTC/AUD"],
): Promise<UniverseSignalTimeMembership> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs: DECISION_AT_MS,
    snapshotAsOfMs: DECISION_AT_MS - 60_000,
    snapshotAvailableAtMs: DECISION_AT_MS - 30_000,
    snapshotSha256: "a".repeat(64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs,
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

function decision(reason = "No eligible momentum"): StrategyDecision {
  return {
    strategyVersion: "test-v1",
    action: "hold",
    targetExposurePct: 0,
    reason,
    signals: [],
  };
}

async function artifact(
  verifiedMembership: UniverseSignalTimeMembership,
  reason?: string,
): Promise<UniverseBoundStrategyDecision> {
  return bindUniverseMembershipToStrategyDecision(
    verifiedMembership,
    decision(reason),
  );
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
      first: <T>() => (prepared.get(...params) as T | undefined) ?? null,
    };
    return statement;
  }

  batch(statements: readonly { run(): unknown }[]): readonly unknown[] {
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

function database(): {
  readonly sqlite: DatabaseSync;
  readonly repository: UniverseBoundStrategyDecisionRepository;
} {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(
      new URL(
        "../migrations/0018_universe_bound_strategy_decisions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return {
    sqlite,
    repository: new UniverseBoundStrategyDecisionRepository(
      new SQLiteD1(sqlite) as unknown as D1Database,
    ),
  };
}

test("persists one immutable artifact and an idempotent cycle binding", async () => {
  const { sqlite, repository } = database();
  const verifiedMembership = await membership();
  const bound = await artifact(verifiedMembership);
  const input = {
    cycleId: CYCLE_A,
    membership: verifiedMembership,
    artifact: bound,
    persistedAtMs: DECISION_AT_MS + 1_000,
  };
  await repository.persist(input);
  await repository.persist({ ...input, persistedAtMs: DECISION_AT_MS + 2_000 });
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM universe_bound_strategy_decision_artifacts",
      )
      .get()?.count,
    1,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM universe_bound_strategy_decision_cycles",
      )
      .get()?.count,
    1,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT persisted_at_ms FROM universe_bound_strategy_decision_cycles",
      )
      .get()?.persisted_at_ms,
    DECISION_AT_MS + 1_000,
  );
  sqlite.close();
});

test("allows one content-addressed artifact to bind distinct retry cycles", async () => {
  const { sqlite, repository } = database();
  const verifiedMembership = await membership();
  const bound = await artifact(verifiedMembership);
  for (const cycleId of [CYCLE_A, CYCLE_B]) {
    await repository.persist({
      cycleId,
      membership: verifiedMembership,
      artifact: bound,
      persistedAtMs: DECISION_AT_MS + 1_000,
    });
  }
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM universe_bound_strategy_decision_artifacts",
      )
      .get()?.count,
    1,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM universe_bound_strategy_decision_cycles",
      )
      .get()?.count,
    2,
  );
  sqlite.close();
});

test("rejects rebinding one cycle to a different valid decision", async () => {
  const { sqlite, repository } = database();
  const verifiedMembership = await membership();
  await repository.persist({
    cycleId: CYCLE_A,
    membership: verifiedMembership,
    artifact: await artifact(verifiedMembership),
    persistedAtMs: DECISION_AT_MS + 1_000,
  });
  await assert.rejects(
    repository.persist({
      cycleId: CYCLE_A,
      membership: verifiedMembership,
      artifact: await artifact(verifiedMembership, "A changed valid reason"),
      persistedAtMs: DECISION_AT_MS + 2_000,
    }),
    /cycle conflict/u,
  );
  sqlite.close();
});

test("re-verifies membership and persistence chronology before preparing writes", async () => {
  const verifiedMembership = await membership();
  const bound = await artifact(verifiedMembership);
  await assert.rejects(
    prepareUniverseBoundStrategyDecisionPersistence({
      cycleId: CYCLE_A,
      membership: await membership([]),
      artifact: bound,
      persistedAtMs: DECISION_AT_MS + 1_000,
    }),
    /does not match verified universe membership/u,
  );
  await assert.rejects(
    prepareUniverseBoundStrategyDecisionPersistence({
      cycleId: "not-a-cycle",
      membership: verifiedMembership,
      artifact: bound,
      persistedAtMs: DECISION_AT_MS + 1_000,
    }),
    /canonical UUID/u,
  );
  await assert.rejects(
    prepareUniverseBoundStrategyDecisionPersistence({
      cycleId: CYCLE_A,
      membership: verifiedMembership,
      artifact: bound,
      persistedAtMs: DECISION_AT_MS - 1,
    }),
    /at or after decision time/u,
  );
});

test("database rejects artifact conflicts, mutation and deletion", async () => {
  const { sqlite, repository } = database();
  const verifiedMembership = await membership();
  const bound = await artifact(verifiedMembership);
  await repository.persist({
    cycleId: CYCLE_A,
    membership: verifiedMembership,
    artifact: bound,
    persistedAtMs: DECISION_AT_MS + 1_000,
  });
  assert.throws(
    () =>
      sqlite
        .prepare(
          `INSERT INTO universe_bound_strategy_decision_artifacts
           SELECT binding_sha256, decision_at_ms, membership_sha256,
                  snapshot_sha256, signed_policy_sha256, strategy_version,
                  action, target_pair, target_exposure_pct,
                  json_set(artifact_json, '$.decision.reason', 'changed')
           FROM universe_bound_strategy_decision_artifacts`,
        )
        .run(),
    /artifact conflict/u,
  );
  assert.throws(
    () =>
      sqlite
        .prepare(
          "UPDATE universe_bound_strategy_decision_artifacts SET strategy_version = 'changed'",
        )
        .run(),
    /immutable/u,
  );
  assert.throws(
    () =>
      sqlite
        .prepare("DELETE FROM universe_bound_strategy_decision_cycles")
        .run(),
    /immutable/u,
  );
  sqlite.close();
});
