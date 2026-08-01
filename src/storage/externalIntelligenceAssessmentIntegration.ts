import {
  prepareIntegratedExternalIntelligenceAssessments,
  verifyExternalIntelligenceLinkageArtifact,
  verifyExternalIntelligenceManipulationEvidenceArtifact,
  verifyIntegratedExternalIntelligenceAssessment,
  type IntegratedExternalIntelligenceAssessment,
} from "../intelligence/externalIntelligenceAssessmentIntegration.ts";
import type { ExternalIntelligencePolicy } from "../intelligence/externalIntelligence.ts";
import type { ExternalIntelligenceLinkage } from "../intelligence/externalIntelligenceLinking.ts";
import type { ExternalIntelligenceManipulationEvidence } from "../intelligence/externalIntelligenceManipulation.ts";
import { canonicalIntelligenceJson } from "../intelligence/canonical.ts";

type D1BindValue = string | number | null;

export interface ExternalIntelligenceAssessmentIntegrationPersistenceInput {
  readonly linkage: ExternalIntelligenceLinkage;
  readonly manipulationEvidence: ExternalIntelligenceManipulationEvidence;
  readonly assessmentPolicy: ExternalIntelligencePolicy;
  readonly integrations: readonly IntegratedExternalIntelligenceAssessment[];
}

export interface ExternalIntelligenceAssessmentIntegrationStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export const INSERT_EXTERNAL_INTELLIGENCE_LINKAGES_JSON_SQL =
  `INSERT INTO external_intelligence_linkages
    (linkage_sha256, linked_at_ms, topic_registry_sha256, linkage_json)
   SELECT
     json_extract(value, '$.linkageSha256'),
     json_extract(value, '$.linkedAtMs'),
     json_extract(value, '$.topicRegistrySha256'),
     value
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(linkage_sha256) DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_MANIPULATION_EVIDENCE_JSON_SQL =
  `INSERT INTO external_intelligence_manipulation_evidence
    (evidence_sha256, linkage_sha256, analysed_at_ms, policy_sha256,
     evidence_json)
   SELECT
     json_extract(value, '$.evidenceSha256'),
     json_extract(value, '$.linkageSha256'),
     json_extract(value, '$.analysedAtMs'),
     json_extract(value, '$.policySha256'),
     value
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(evidence_sha256) DO NOTHING`;

export const INSERT_INTEGRATED_EXTERNAL_INTELLIGENCE_ASSESSMENTS_JSON_SQL =
  `INSERT INTO integrated_external_intelligence_assessments
    (integration_sha256, assessment_sha256, assessed_at_ms, linkage_sha256,
     manipulation_evidence_sha256, manipulation_policy_sha256,
     assessment_policy_sha256, effective_reaction,
     actionable_repost_cluster_sha256s_json,
     watch_only_repost_cluster_sha256s_json, warnings_json, integration_json)
   SELECT
     json_extract(value, '$.integrationSha256'),
     json_extract(value, '$.assessment.assessmentSha256'),
     json_extract(value, '$.assessedAtMs'),
     json_extract(value, '$.linkageSha256'),
     json_extract(value, '$.manipulationEvidenceSha256'),
     json_extract(value, '$.manipulationPolicySha256'),
     json_extract(value, '$.assessmentPolicySha256'),
     json_extract(value, '$.effectiveReaction'),
     json_extract(value, '$.actionableRepostClusterSha256s'),
     json_extract(value, '$.watchOnlyRepostClusterSha256s'),
     json_extract(value, '$.warnings'),
     value
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(integration_sha256) DO NOTHING`;

export async function prepareExternalIntelligenceAssessmentIntegrationPersistence(
  input: ExternalIntelligenceAssessmentIntegrationPersistenceInput,
): Promise<readonly ExternalIntelligenceAssessmentIntegrationStatement[]> {
  if (input.integrations.length < 1 || input.integrations.length > 100) {
    throw new Error("integrations must contain 1 to 100 records");
  }
  await verifyExternalIntelligenceLinkageArtifact(input.linkage);
  await verifyExternalIntelligenceManipulationEvidenceArtifact(
    input.manipulationEvidence,
  );
  await Promise.all(
    input.integrations.map(verifyIntegratedExternalIntelligenceAssessment),
  );
  const assessedAtMs = input.integrations[0]?.assessedAtMs;
  if (
    assessedAtMs === undefined ||
    input.integrations.some(
      (integration) => integration.assessedAtMs !== assessedAtMs,
    )
  ) {
    throw new Error("Persisted integrations must share one assessment time");
  }
  const expected = await prepareIntegratedExternalIntelligenceAssessments({
    assessedAtMs,
    linkage: input.linkage,
    manipulationEvidence: input.manipulationEvidence,
    policy: input.assessmentPolicy,
  });
  if (
    canonicalIntelligenceJson(expected) !==
    canonicalIntelligenceJson(input.integrations)
  ) {
    throw new Error("Integrated external intelligence assessments do not reproduce");
  }
  return [
    {
      sql: INSERT_EXTERNAL_INTELLIGENCE_LINKAGES_JSON_SQL,
      params: [JSON.stringify([input.linkage])],
    },
    {
      sql: INSERT_EXTERNAL_INTELLIGENCE_MANIPULATION_EVIDENCE_JSON_SQL,
      params: [JSON.stringify([input.manipulationEvidence])],
    },
    {
      sql: INSERT_INTEGRATED_EXTERNAL_INTELLIGENCE_ASSESSMENTS_JSON_SQL,
      params: [JSON.stringify(input.integrations)],
    },
  ];
}

export class ExternalIntelligenceAssessmentIntegrationRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: ExternalIntelligenceAssessmentIntegrationPersistenceInput,
  ): Promise<readonly IntegratedExternalIntelligenceAssessment[]> {
    const statements =
      await prepareExternalIntelligenceAssessmentIntegrationPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params),
      ),
    );
    return input.integrations;
  }
}
