import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MAXIMUM_EVIDENCE_REFERENCES = 64;
const MAXIMUM_ARTIFACTS_PER_GATE = 32;

export const HOURLY_TREND_BREAKOUT_READINESS_STRATEGY_VERSION =
  "hourly-trend-breakout-v0.1.0" as const;

export const REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES = [
  {
    id: "authoritative-historical-hourly-candles",
    stage: "research",
    reviewGate: "B",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "survivorship-safe-signal-time-universe",
    stage: "research",
    reviewGate: "B",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "complete-after-cost-evaluation",
    stage: "research",
    reviewGate: "B",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "live-like-execution-calibration",
    stage: "research",
    reviewGate: "B",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "capacity-path-stress",
    stage: "research",
    reviewGate: "B",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "tax-and-audit-export",
    stage: "research",
    reviewGate: "B",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "signed-versioned-strategy-configuration",
    stage: "promotion",
    reviewGate: "B/E",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "paper-accounting-observation",
    stage: "promotion",
    reviewGate: "C",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "shadow-permission-and-reconciliation",
    stage: "promotion",
    reviewGate: "D",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "independent-security-review",
    stage: "promotion",
    reviewGate: "E",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "high-severity-issue-clearance",
    stage: "promotion",
    reviewGate: "E",
    requiresAuthoritativeEvidence: true,
  },
  {
    id: "owner-canary-approval",
    stage: "promotion",
    reviewGate: "E",
    requiresAuthoritativeEvidence: true,
  },
] as const;

export type HourlyTrendBreakoutReadinessGateId =
  (typeof REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES)[number]["id"];

export interface HourlyTrendBreakoutReadinessEvidence {
  readonly gateId: HourlyTrendBreakoutReadinessGateId;
  readonly evidenceClass: "authoritative" | "synthetic";
  readonly completeness: "complete" | "partial";
  readonly observedAtMs: number;
  readonly availableAtMs: number;
  readonly validUntilMs: number | null;
  readonly artifactSha256s: readonly string[];
}

export interface HourlyTrendBreakoutReadinessInput {
  readonly assessedAtMs: number;
  readonly evidence: readonly HourlyTrendBreakoutReadinessEvidence[];
}

export interface HourlyTrendBreakoutReadinessGateAssessment {
  readonly gateId: HourlyTrendBreakoutReadinessGateId;
  readonly stage: "research" | "promotion";
  readonly reviewGate: "B" | "B/E" | "C" | "D" | "E";
  readonly status:
    | "missing"
    | "partial"
    | "non-authoritative"
    | "stale"
    | "evidence-present"
    | "external-review-required";
  readonly artifactSha256s: readonly string[];
}

export interface HourlyTrendBreakoutReadinessAssessment {
  readonly schemaVersion: "hourly-trend-breakout-readiness-v1";
  readonly strategyVersion:
    typeof HOURLY_TREND_BREAKOUT_READINESS_STRATEGY_VERSION;
  readonly candidateStatus: "unselected-research-only";
  readonly decisionAuthority: "none";
  readonly assessedAtMs: number;
  readonly researchStatus: "blocked" | "evidence-complete-for-review";
  readonly promotionStatus: "blocked" | "external-review-required";
  readonly gates: readonly HourlyTrendBreakoutReadinessGateAssessment[];
  readonly assessmentSha256: string;
}

function finiteTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateEvidence(
  assessedAtMs: number,
  evidence: HourlyTrendBreakoutReadinessEvidence,
): void {
  if (
    !finiteTimestamp(evidence.observedAtMs) ||
    !finiteTimestamp(evidence.availableAtMs) ||
    evidence.observedAtMs > evidence.availableAtMs ||
    evidence.availableAtMs > assessedAtMs ||
    (evidence.validUntilMs !== null &&
      (!finiteTimestamp(evidence.validUntilMs) ||
        evidence.validUntilMs < evidence.availableAtMs)) ||
    evidence.artifactSha256s.length < 1 ||
    evidence.artifactSha256s.length > MAXIMUM_ARTIFACTS_PER_GATE ||
    evidence.artifactSha256s.some((digest) => !SHA256_HEX.test(digest)) ||
    new Set(evidence.artifactSha256s).size !==
      evidence.artifactSha256s.length ||
    canonicalIntelligenceJson(evidence.artifactSha256s) !==
      canonicalIntelligenceJson([...evidence.artifactSha256s].sort())
  ) {
    throw new Error("hourly trend/breakout readiness evidence is invalid");
  }
}

function assessGate(
  assessedAtMs: number,
  definition:
    (typeof REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES)[number],
  evidence: HourlyTrendBreakoutReadinessEvidence | undefined,
): HourlyTrendBreakoutReadinessGateAssessment {
  if (evidence === undefined) {
    return {
      gateId: definition.id,
      stage: definition.stage,
      reviewGate: definition.reviewGate,
      status: "missing",
      artifactSha256s: [],
    };
  }
  let status: HourlyTrendBreakoutReadinessGateAssessment["status"];
  if (evidence.completeness !== "complete") {
    status = "partial";
  } else if (
    definition.requiresAuthoritativeEvidence &&
    evidence.evidenceClass !== "authoritative"
  ) {
    status = "non-authoritative";
  } else if (
    evidence.validUntilMs !== null &&
    evidence.validUntilMs < assessedAtMs
  ) {
    status = "stale";
  } else {
    status =
      definition.stage === "promotion"
        ? "external-review-required"
        : "evidence-present";
  }
  return {
    gateId: definition.id,
    stage: definition.stage,
    reviewGate: definition.reviewGate,
    status,
    artifactSha256s: evidence.artifactSha256s,
  };
}

export async function prepareHourlyTrendBreakoutReadinessAssessment(
  input: HourlyTrendBreakoutReadinessInput,
): Promise<HourlyTrendBreakoutReadinessAssessment> {
  if (
    !finiteTimestamp(input.assessedAtMs) ||
    input.evidence.length > MAXIMUM_EVIDENCE_REFERENCES ||
    new Set(input.evidence.map((item) => item.gateId)).size !==
      input.evidence.length
  ) {
    throw new Error("hourly trend/breakout readiness input is invalid");
  }
  const allowedGateIds = new Set(
    REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.map((gate) => gate.id),
  );
  for (const evidence of input.evidence) {
    if (!allowedGateIds.has(evidence.gateId)) {
      throw new Error("hourly trend/breakout readiness gate is unsupported");
    }
    validateEvidence(input.assessedAtMs, evidence);
  }
  const evidenceByGate = new Map(
    input.evidence.map((evidence) => [evidence.gateId, evidence]),
  );
  const gates = REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.map(
    (definition) =>
      assessGate(
        input.assessedAtMs,
        definition,
        evidenceByGate.get(definition.id),
      ),
  );
  const researchGates = gates.filter((gate) => gate.stage === "research");
  const promotionGates = gates.filter((gate) => gate.stage === "promotion");
  const envelope = {
    schemaVersion: "hourly-trend-breakout-readiness-v1",
    strategyVersion: HOURLY_TREND_BREAKOUT_READINESS_STRATEGY_VERSION,
    candidateStatus: "unselected-research-only",
    decisionAuthority: "none",
    assessedAtMs: input.assessedAtMs,
    researchStatus: researchGates.every(
      (gate) => gate.status === "evidence-present",
    )
      ? "evidence-complete-for-review"
      : "blocked",
    promotionStatus: promotionGates.every(
      (gate) => gate.status === "external-review-required",
    )
      ? "external-review-required"
      : "blocked",
    gates,
  } as const;
  return {
    ...envelope,
    assessmentSha256: await sha256CanonicalIntelligence(envelope),
  };
}
