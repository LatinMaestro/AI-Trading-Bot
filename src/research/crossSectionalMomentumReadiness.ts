import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
} from "../strategies/crossSectionalMomentum.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MAXIMUM_ARTIFACTS_PER_GATE = 32;

export const REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES = [
  {
    id: "authoritative-historical-hourly-candles",
    stage: "research",
    reviewGate: "B",
    requiresFiniteValidity: false,
  },
  {
    id: "survivorship-safe-signal-time-universe",
    stage: "research",
    reviewGate: "B",
    requiresFiniteValidity: false,
  },
  {
    id: "walk-forward-sensitivity-final-holdout",
    stage: "research",
    reviewGate: "B",
    requiresFiniteValidity: false,
  },
  {
    id: "complete-after-cost-evaluation",
    stage: "research",
    reviewGate: "B",
    requiresFiniteValidity: false,
  },
  {
    id: "live-like-execution-calibration",
    stage: "research",
    reviewGate: "B",
    requiresFiniteValidity: true,
  },
  {
    id: "capacity-path-stress",
    stage: "research",
    reviewGate: "B",
    requiresFiniteValidity: true,
  },
  {
    id: "canonical-research-report",
    stage: "research",
    reviewGate: "B",
    requiresFiniteValidity: false,
  },
  {
    id: "tax-and-audit-export",
    stage: "promotion",
    reviewGate: "C",
    requiresFiniteValidity: false,
  },
  {
    id: "signed-versioned-strategy-configuration",
    stage: "promotion",
    reviewGate: "B/E",
    requiresFiniteValidity: false,
  },
  {
    id: "paper-accounting-observation",
    stage: "promotion",
    reviewGate: "C",
    requiresFiniteValidity: false,
  },
  {
    id: "shadow-permission-and-reconciliation",
    stage: "promotion",
    reviewGate: "D",
    requiresFiniteValidity: false,
  },
  {
    id: "independent-security-review",
    stage: "promotion",
    reviewGate: "E",
    requiresFiniteValidity: false,
  },
  {
    id: "high-severity-issue-clearance",
    stage: "promotion",
    reviewGate: "E",
    requiresFiniteValidity: false,
  },
  {
    id: "owner-canary-approval",
    stage: "promotion",
    reviewGate: "E",
    requiresFiniteValidity: false,
  },
] as const;

export type CrossSectionalMomentumReadinessGateId =
  (typeof REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES)[number]["id"];

export interface CrossSectionalMomentumReadinessEvidence {
  readonly gateId: CrossSectionalMomentumReadinessGateId;
  readonly evidenceClass: "authoritative" | "synthetic";
  readonly completeness: "complete" | "partial";
  readonly observedAtMs: number;
  readonly availableAtMs: number;
  readonly validUntilMs: number | null;
  readonly artifactSha256s: readonly string[];
}

export interface CrossSectionalMomentumReadinessInput {
  readonly assessedAtMs: number;
  readonly evidence: readonly CrossSectionalMomentumReadinessEvidence[];
}

export interface CrossSectionalMomentumReadinessGateAssessment {
  readonly gateId: CrossSectionalMomentumReadinessGateId;
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

export interface CrossSectionalMomentumReadinessAssessment {
  readonly schemaVersion: "cross-sectional-momentum-readiness-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly assessedAtMs: number;
  readonly evidenceInputSha256: string;
  readonly researchStatus: "blocked" | "evidence-complete-for-review";
  readonly promotionStatus: "blocked" | "external-review-required";
  readonly gates: readonly CrossSectionalMomentumReadinessGateAssessment[];
  readonly assessmentSha256: string;
}

function finiteTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateEvidence(
  assessedAtMs: number,
  evidence: CrossSectionalMomentumReadinessEvidence,
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
    throw new Error("cross-sectional readiness evidence is invalid");
  }
}

function assessGate(
  assessedAtMs: number,
  definition:
    (typeof REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES)[number],
  evidence: CrossSectionalMomentumReadinessEvidence | undefined,
): CrossSectionalMomentumReadinessGateAssessment {
  if (evidence === undefined) {
    return {
      gateId: definition.id,
      stage: definition.stage,
      reviewGate: definition.reviewGate,
      status: "missing",
      artifactSha256s: [],
    };
  }
  let status: CrossSectionalMomentumReadinessGateAssessment["status"];
  if (evidence.completeness !== "complete") {
    status = "partial";
  } else if (evidence.evidenceClass !== "authoritative") {
    status = "non-authoritative";
  } else if (
    definition.requiresFiniteValidity &&
    evidence.validUntilMs === null
  ) {
    status = "partial";
  } else if (
    evidence.validUntilMs !== null &&
    evidence.validUntilMs < assessedAtMs
  ) {
    status = "stale";
  } else {
    status = definition.stage === "promotion"
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

export async function prepareCrossSectionalMomentumReadinessAssessment(
  input: CrossSectionalMomentumReadinessInput,
): Promise<CrossSectionalMomentumReadinessAssessment> {
  if (
    !finiteTimestamp(input.assessedAtMs) ||
    input.evidence.length >
      REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES.length ||
    new Set(input.evidence.map((item) => item.gateId)).size !==
      input.evidence.length
  ) {
    throw new Error("cross-sectional readiness input is invalid");
  }
  const allowed = new Set(
    REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES.map(
      (gate) => gate.id,
    ),
  );
  for (const evidence of input.evidence) {
    if (!allowed.has(evidence.gateId)) {
      throw new Error("cross-sectional readiness gate is unsupported");
    }
    validateEvidence(input.assessedAtMs, evidence);
  }
  const evidenceByGate = new Map(
    input.evidence.map((evidence) => [evidence.gateId, evidence]),
  );
  const canonicalEvidence =
    REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES.flatMap((gate) => {
      const evidence = evidenceByGate.get(gate.id);
      return evidence === undefined ? [] : [evidence];
    });
  const evidenceInputSha256 = await sha256CanonicalIntelligence({
    assessedAtMs: input.assessedAtMs,
    evidence: canonicalEvidence,
  });
  const gates = REQUIRED_CROSS_SECTIONAL_MOMENTUM_READINESS_GATES.map(
    (definition) =>
      assessGate(
        input.assessedAtMs,
        definition,
        evidenceByGate.get(definition.id),
      ),
  );
  const envelope = {
    schemaVersion: "cross-sectional-momentum-readiness-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
    assessedAtMs: input.assessedAtMs,
    evidenceInputSha256,
    researchStatus: gates
        .filter((gate) => gate.stage === "research")
        .every((gate) => gate.status === "evidence-present")
      ? "evidence-complete-for-review"
      : "blocked",
    promotionStatus: gates
        .filter((gate) => gate.stage === "promotion")
        .every((gate) => gate.status === "external-review-required")
      ? "external-review-required"
      : "blocked",
    gates,
  } as const;
  return {
    ...envelope,
    assessmentSha256: await sha256CanonicalIntelligence(envelope),
  };
}
