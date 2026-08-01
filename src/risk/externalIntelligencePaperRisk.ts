import type { TradingMode, StrategyDecision } from "../domain/types.ts";
import {
  verifyExternalIntelligenceAssessmentIntegrationArtifacts,
  verifyIntegratedExternalIntelligenceAssessment,
  type IntegratedExternalIntelligenceAssessment,
} from "../intelligence/externalIntelligenceAssessmentIntegration.ts";
import { sha256CanonicalIntelligence } from "../intelligence/canonical.ts";
import type { ExternalIntelligenceLinkage } from "../intelligence/externalIntelligenceLinking.ts";
import type { ExternalIntelligenceManipulationEvidence } from "../intelligence/externalIntelligenceManipulation.ts";

const MAXIMUM_ASSESSMENTS = 100;
export const PAPER_INTELLIGENCE_PAUSE_MAXIMUM_AGE_MS = 60 * 60 * 1_000;

export interface ExternalIntelligencePaperRiskResult {
  readonly evaluated: boolean;
  readonly pausedNewRisk: boolean;
  readonly decision: StrategyDecision;
  readonly assessmentSha256s: readonly string[];
  readonly integrationSha256s: readonly string[];
  readonly reason: string;
}

export interface ApplyExternalIntelligencePaperRiskInput {
  readonly cycleId: string;
  readonly mode: TradingMode;
  readonly decision: StrategyDecision;
  readonly evaluatedAtMs: number;
  readonly maximumAssessmentAgeMs: number;
}

interface IntegratedAssessmentRow {
  readonly integration_sha256: string;
  readonly assessment_sha256: string;
  readonly assessed_at_ms: number;
  readonly effective_reaction: string;
  readonly integration_json: string;
  readonly linkage_json: string;
  readonly evidence_json: string;
}

function assertCanonicalText(name: string, value: string): void {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be canonical text`);
  }
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

async function parseAssessmentRow(
  row: IntegratedAssessmentRow,
  evaluatedAtMs: number,
  oldestAcceptedAtMs: number,
): Promise<IntegratedExternalIntelligenceAssessment> {
  let parsedIntegration: unknown;
  let parsedLinkage: unknown;
  let parsedEvidence: unknown;
  try {
    parsedIntegration = JSON.parse(row.integration_json);
    parsedLinkage = JSON.parse(row.linkage_json);
    parsedEvidence = JSON.parse(row.evidence_json);
  } catch {
    throw new Error("External-intelligence risk artifact JSON is malformed");
  }
  const integration =
    parsedIntegration as IntegratedExternalIntelligenceAssessment;
  const linkage = parsedLinkage as ExternalIntelligenceLinkage;
  const evidence =
    parsedEvidence as ExternalIntelligenceManipulationEvidence;
  await verifyExternalIntelligenceAssessmentIntegrationArtifacts(
    linkage,
    evidence,
  );
  await verifyIntegratedExternalIntelligenceAssessment(integration);
  if (
    integration.integrationSha256 !== row.integration_sha256 ||
    integration.linkageSha256 !== linkage.linkageSha256 ||
    integration.manipulationEvidenceSha256 !== evidence.evidenceSha256 ||
    evidence.linkageSha256 !== linkage.linkageSha256 ||
    integration.assessment.assessmentSha256 !== row.assessment_sha256 ||
    integration.assessedAtMs !== row.assessed_at_ms ||
    integration.effectiveReaction !== row.effective_reaction ||
    integration.assessedAtMs < oldestAcceptedAtMs ||
    integration.assessedAtMs > evaluatedAtMs
  ) {
    throw new Error("Integrated assessment row does not match its artifact");
  }
  return integration;
}

function pausedDecision(decision: StrategyDecision): StrategyDecision {
  return {
    strategyVersion: decision.strategyVersion,
    action: "hold",
    targetExposurePct: 0,
    reason:
      "Fresh authoritative external intelligence paused new paper risk",
    signals: decision.signals,
  };
}

export class ExternalIntelligencePaperRiskRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async apply(
    input: ApplyExternalIntelligencePaperRiskInput,
  ): Promise<ExternalIntelligencePaperRiskResult> {
    assertCanonicalText("cycleId", input.cycleId);
    assertTime("evaluatedAtMs", input.evaluatedAtMs);
    assertTime("maximumAssessmentAgeMs", input.maximumAssessmentAgeMs);
    if (input.maximumAssessmentAgeMs < 1) {
      throw new Error("maximumAssessmentAgeMs must be positive");
    }
    if (input.mode !== "paper") {
      return {
        evaluated: false,
        pausedNewRisk: false,
        decision: input.decision,
        assessmentSha256s: [],
        integrationSha256s: [],
        reason: "External-intelligence reaction is connected to paper mode only",
      };
    }

    const oldestAcceptedAtMs = Math.max(
      0,
      input.evaluatedAtMs - input.maximumAssessmentAgeMs,
    );
    const query = await this.db
      .prepare(
        `SELECT integrated.integration_sha256,
                integrated.assessment_sha256,
                integrated.assessed_at_ms,
                integrated.effective_reaction,
                integrated.integration_json,
                linkages.linkage_json,
                evidence.evidence_json
         FROM integrated_external_intelligence_assessments integrated
         INNER JOIN external_intelligence_linkages linkages
           ON linkages.linkage_sha256 = integrated.linkage_sha256
         INNER JOIN external_intelligence_manipulation_evidence evidence
           ON evidence.evidence_sha256 =
             integrated.manipulation_evidence_sha256
          AND evidence.linkage_sha256 = integrated.linkage_sha256
         WHERE integrated.assessed_at_ms BETWEEN ? AND ?
           AND integrated.effective_reaction = 'pause-new-risk'
         ORDER BY integrated.assessed_at_ms DESC,
                  integrated.integration_sha256 ASC
         LIMIT ?`,
      )
      .bind(oldestAcceptedAtMs, input.evaluatedAtMs, MAXIMUM_ASSESSMENTS + 1)
      .all<IntegratedAssessmentRow>();
    const rows = query.results ?? [];
    if (rows.length > MAXIMUM_ASSESSMENTS) {
      throw new Error("External-intelligence pause assessment bound was exceeded");
    }
    const assessments = await Promise.all(
      rows.map((row) =>
        parseAssessmentRow(row, input.evaluatedAtMs, oldestAcceptedAtMs),
      ),
    );
    const integrations = new Map(
      assessments.map((assessment) => [
        assessment.integrationSha256,
        assessment,
      ]),
    );
    if (integrations.size !== assessments.length) {
      throw new Error("Duplicate external-intelligence pause assessment");
    }

    const appliesToNewRisk =
      input.decision.action === "buy" && assessments.length > 0;
    const assessmentSha256s = [
      ...new Set(
        assessments.map(
          (assessment) => assessment.assessment.assessmentSha256,
        ),
      ),
    ].sort();
    const integrationSha256s = [...integrations.keys()].sort();
    if (assessments.length > 0) {
      const resultingDecision = appliesToNewRisk
        ? pausedDecision(input.decision)
        : input.decision;
      const proposedDecisionSha256 =
        await sha256CanonicalIntelligence(input.decision);
      const resultingDecisionSha256 =
        await sha256CanonicalIntelligence(resultingDecision);
      const detail = {
        schemaVersion: "external-intelligence-paper-risk-event-v1",
        cycleId: input.cycleId,
        evaluatedAtMs: input.evaluatedAtMs,
        strategyVersion: input.decision.strategyVersion,
        proposedAction: input.decision.action,
        proposedTargetPair: input.decision.targetPair ?? null,
        proposedTargetExposurePct: input.decision.targetExposurePct,
        proposedDecisionSha256,
        assessmentSha256s,
        integrationSha256s,
        appliedToProposedBuy: appliesToNewRisk,
        resultingAction: resultingDecision.action,
        resultingTargetPair: resultingDecision.targetPair ?? null,
        resultingTargetExposurePct: resultingDecision.targetExposurePct,
        resultingDecisionSha256,
      } as const;
      const eventId = await sha256CanonicalIntelligence(detail);
      await this.db
        .prepare(
          `INSERT INTO risk_events
            (event_id, cycle_id, severity, code, detail_json, created_at)
           VALUES (?, ?, 'pause', 'external-intelligence.pause-new-risk', ?, ?)
           ON CONFLICT(event_id) DO NOTHING`,
        )
        .bind(
          eventId,
          input.cycleId,
          JSON.stringify(detail),
          new Date(input.evaluatedAtMs).toISOString(),
        )
        .run();
    }
    return {
      evaluated: true,
      pausedNewRisk: appliesToNewRisk,
      decision: appliesToNewRisk
        ? pausedDecision(input.decision)
        : input.decision,
      assessmentSha256s,
      integrationSha256s,
      reason:
        assessments.length === 0
          ? "No fresh persisted pause-new-risk assessment"
          : appliesToNewRisk
            ? "Fresh persisted pause-new-risk assessment suppressed a paper buy"
            : "Pause-new-risk evidence does not block hold or exit decisions",
    };
  }
}
