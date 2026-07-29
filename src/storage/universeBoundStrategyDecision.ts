import { canonicalIntelligenceJson } from "../intelligence/canonical.ts";
import {
  bindUniverseMembershipToStrategyDecision,
  verifyUniverseBoundStrategyDecision,
  type UniverseBoundStrategyDecision,
} from "../strategies/universeBoundDecision.ts";
import type { UniverseSignalTimeMembership } from "../universe/signalTimeMembership.ts";

type D1BindValue = string | number | null;

const CYCLE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface UniverseBoundStrategyDecisionPersistenceInput {
  readonly cycleId: string;
  readonly membership: UniverseSignalTimeMembership;
  readonly artifact: UniverseBoundStrategyDecision;
  readonly persistedAtMs: number;
}

export interface UniverseBoundStrategyDecisionStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export const INSERT_UNIVERSE_BOUND_STRATEGY_DECISION_ARTIFACT_SQL =
  `INSERT INTO universe_bound_strategy_decision_artifacts
    (binding_sha256, decision_at_ms, membership_sha256, snapshot_sha256,
     signed_policy_sha256, strategy_version, action, target_pair,
     target_exposure_pct, artifact_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(binding_sha256) DO NOTHING`;

export const INSERT_UNIVERSE_BOUND_STRATEGY_DECISION_CYCLE_SQL =
  `INSERT INTO universe_bound_strategy_decision_cycles
    (cycle_id, binding_sha256, persisted_at_ms)
   VALUES (?, ?, ?)
   ON CONFLICT(cycle_id) DO NOTHING`;

const SELECT_UNIVERSE_BOUND_STRATEGY_DECISION_ARTIFACT_SQL =
  `SELECT binding_sha256, decision_at_ms, membership_sha256, snapshot_sha256,
          signed_policy_sha256, strategy_version, action, target_pair,
          target_exposure_pct, artifact_json
   FROM universe_bound_strategy_decision_artifacts
   WHERE binding_sha256 = ?`;

const SELECT_UNIVERSE_BOUND_STRATEGY_DECISION_CYCLE_SQL =
  `SELECT cycle_id, binding_sha256, persisted_at_ms
   FROM universe_bound_strategy_decision_cycles
   WHERE cycle_id = ?`;

interface ArtifactRow {
  readonly binding_sha256: string;
  readonly decision_at_ms: number;
  readonly membership_sha256: string;
  readonly snapshot_sha256: string;
  readonly signed_policy_sha256: string;
  readonly strategy_version: string;
  readonly action: string;
  readonly target_pair: string | null;
  readonly target_exposure_pct: number;
  readonly artifact_json: string;
}

interface CycleRow {
  readonly cycle_id: string;
  readonly binding_sha256: string;
  readonly persisted_at_ms: number;
}

function artifactMatches(
  row: ArtifactRow,
  artifact: UniverseBoundStrategyDecision,
): boolean {
  return (
    row.binding_sha256 === artifact.bindingSha256 &&
    row.decision_at_ms === artifact.decisionAtMs &&
    row.membership_sha256 === artifact.membershipSha256 &&
    row.snapshot_sha256 === artifact.snapshotSha256 &&
    row.signed_policy_sha256 === artifact.signedPolicySha256 &&
    row.strategy_version === artifact.decision.strategyVersion &&
    row.action === artifact.decision.action &&
    row.target_pair === (artifact.decision.targetPair ?? null) &&
    row.target_exposure_pct === artifact.decision.targetExposurePct &&
    row.artifact_json === canonicalIntelligenceJson(artifact)
  );
}

export async function prepareUniverseBoundStrategyDecisionPersistence(
  input: UniverseBoundStrategyDecisionPersistenceInput,
): Promise<readonly UniverseBoundStrategyDecisionStatement[]> {
  if (!CYCLE_ID.test(input.cycleId)) {
    throw new Error("strategy decision cycleId must be a canonical UUID");
  }
  if (
    !Number.isSafeInteger(input.persistedAtMs) ||
    input.persistedAtMs < input.artifact.decisionAtMs
  ) {
    throw new Error(
      "strategy decision persistence time must be at or after decision time",
    );
  }
  await verifyUniverseBoundStrategyDecision(input.artifact);
  const rebound = await bindUniverseMembershipToStrategyDecision(
    input.membership,
    input.artifact.decision,
  );
  if (
    rebound.bindingSha256 !== input.artifact.bindingSha256 ||
    canonicalIntelligenceJson(rebound) !==
      canonicalIntelligenceJson(input.artifact)
  ) {
    throw new Error(
      "strategy decision artifact does not match verified universe membership",
    );
  }
  const artifact = input.artifact;
  return [
    {
      sql: INSERT_UNIVERSE_BOUND_STRATEGY_DECISION_ARTIFACT_SQL,
      params: [
        artifact.bindingSha256,
        artifact.decisionAtMs,
        artifact.membershipSha256,
        artifact.snapshotSha256,
        artifact.signedPolicySha256,
        artifact.decision.strategyVersion,
        artifact.decision.action,
        artifact.decision.targetPair ?? null,
        artifact.decision.targetExposurePct,
        canonicalIntelligenceJson(artifact),
      ],
    },
    {
      sql: INSERT_UNIVERSE_BOUND_STRATEGY_DECISION_CYCLE_SQL,
      params: [input.cycleId, artifact.bindingSha256, input.persistedAtMs],
    },
  ];
}

export class UniverseBoundStrategyDecisionRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: UniverseBoundStrategyDecisionPersistenceInput,
  ): Promise<UniverseBoundStrategyDecision> {
    const statements =
      await prepareUniverseBoundStrategyDecisionPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params),
      ),
    );
    const [artifactRow, cycleRow] = await Promise.all([
      this.db
        .prepare(SELECT_UNIVERSE_BOUND_STRATEGY_DECISION_ARTIFACT_SQL)
        .bind(input.artifact.bindingSha256)
        .first<ArtifactRow>(),
      this.db
        .prepare(SELECT_UNIVERSE_BOUND_STRATEGY_DECISION_CYCLE_SQL)
        .bind(input.cycleId)
        .first<CycleRow>(),
    ]);
    if (
      artifactRow === null ||
      cycleRow === null ||
      !artifactMatches(artifactRow, input.artifact) ||
      cycleRow.cycle_id !== input.cycleId ||
      cycleRow.binding_sha256 !== input.artifact.bindingSha256 ||
      !Number.isSafeInteger(cycleRow.persisted_at_ms) ||
      cycleRow.persisted_at_ms < input.artifact.decisionAtMs
    ) {
      throw new Error(
        "persisted universe-bound strategy decision verification failed",
      );
    }
    return input.artifact;
  }
}
