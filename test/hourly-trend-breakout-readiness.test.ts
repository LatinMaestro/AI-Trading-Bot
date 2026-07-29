import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareHourlyTrendBreakoutReadinessAssessment,
  REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES,
  type HourlyTrendBreakoutReadinessEvidence,
} from "../src/research/hourlyTrendBreakoutReadiness.ts";

const ASSESSED_AT_MS = 10_000;

function evidence(
  gateId: HourlyTrendBreakoutReadinessEvidence["gateId"],
  overrides: Partial<HourlyTrendBreakoutReadinessEvidence> = {},
): HourlyTrendBreakoutReadinessEvidence {
  return {
    gateId,
    evidenceClass: "authoritative",
    completeness: "complete",
    observedAtMs: 7_000,
    availableAtMs: 8_000,
    validUntilMs: 11_000,
    artifactSha256s: [gateId.length.toString(16).padStart(64, "0")],
    ...overrides,
  };
}

test("reports every fixed gate and remains blocked when evidence is absent", async () => {
  const assessment = await prepareHourlyTrendBreakoutReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [],
  });
  assert.equal(
    assessment.gates.length,
    REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.length,
  );
  assert.ok(assessment.gates.every((gate) => gate.status === "missing"));
  assert.equal(assessment.researchStatus, "blocked");
  assert.equal(assessment.promotionStatus, "blocked");
  assert.equal(assessment.candidateStatus, "unselected-research-only");
  assert.equal(assessment.decisionAuthority, "none");
});

test("does not treat synthetic or partial research artifacts as authoritative", async () => {
  const assessment = await prepareHourlyTrendBreakoutReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [
      evidence("authoritative-historical-hourly-candles", {
        evidenceClass: "synthetic",
      }),
      evidence("complete-after-cost-evaluation", {
        completeness: "partial",
      }),
    ],
  });
  assert.equal(
    assessment.gates.find(
      (gate) => gate.gateId === "authoritative-historical-hourly-candles",
    )?.status,
    "non-authoritative",
  );
  assert.equal(
    assessment.gates.find(
      (gate) => gate.gateId === "complete-after-cost-evaluation",
    )?.status,
    "partial",
  );
  assert.equal(assessment.researchStatus, "blocked");
});

test("surfaces expired live-like calibration as stale", async () => {
  const assessment = await prepareHourlyTrendBreakoutReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [
      evidence("live-like-execution-calibration", {
        validUntilMs: ASSESSED_AT_MS - 1,
      }),
    ],
  });
  assert.equal(
    assessment.gates.find(
      (gate) => gate.gateId === "live-like-execution-calibration",
    )?.status,
    "stale",
  );
  const missingExpiry =
    await prepareHourlyTrendBreakoutReadinessAssessment({
      assessedAtMs: ASSESSED_AT_MS,
      evidence: [
        evidence("live-like-execution-calibration", {
          validUntilMs: null,
        }),
      ],
    });
  assert.equal(
    missingExpiry.gates.find(
      (gate) => gate.gateId === "live-like-execution-calibration",
    )?.status,
    "partial",
  );
});

test("can report complete evidence while retaining external promotion authority", async () => {
  const allEvidence = REQUIRED_HOURLY_TREND_BREAKOUT_READINESS_GATES.map(
    (gate) => evidence(gate.id),
  );
  const first = await prepareHourlyTrendBreakoutReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: allEvidence,
  });
  const second = await prepareHourlyTrendBreakoutReadinessAssessment({
    assessedAtMs: ASSESSED_AT_MS,
    evidence: [...allEvidence].reverse(),
  });
  assert.equal(first.researchStatus, "evidence-complete-for-review");
  assert.equal(first.promotionStatus, "external-review-required");
  assert.ok(
    first.gates
      .filter((gate) => gate.stage === "promotion")
      .every((gate) => gate.status === "external-review-required"),
  );
  assert.equal(first.assessmentSha256, second.assessmentSha256);
  assert.equal(first.evidenceInputSha256, second.evidenceInputSha256);
  assert.equal("selectedStrategyVersion" in first, false);
  assert.equal("promotionApproved" in first, false);
});

test("rejects duplicate, future-available and noncanonical evidence", async () => {
  const item = evidence("capacity-path-stress");
  await assert.rejects(
    prepareHourlyTrendBreakoutReadinessAssessment({
      assessedAtMs: ASSESSED_AT_MS,
      evidence: [item, item],
    }),
    /input is invalid/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutReadinessAssessment({
      assessedAtMs: ASSESSED_AT_MS,
      evidence: [
        evidence("capacity-path-stress", {
          availableAtMs: ASSESSED_AT_MS + 1,
        }),
      ],
    }),
    /evidence is invalid/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutReadinessAssessment({
      assessedAtMs: ASSESSED_AT_MS,
      evidence: [
        evidence("capacity-path-stress", {
          artifactSha256s: ["b".repeat(64), "a".repeat(64)],
        }),
      ],
    }),
    /evidence is invalid/u,
  );
});
