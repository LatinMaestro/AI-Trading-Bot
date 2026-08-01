CREATE TABLE external_intelligence_linkages (
  linkage_sha256 TEXT PRIMARY KEY CHECK (
    length(linkage_sha256) = 64 AND linkage_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  linked_at_ms INTEGER NOT NULL CHECK (linked_at_ms >= 0),
  topic_registry_sha256 TEXT NOT NULL CHECK (
    length(topic_registry_sha256) = 64
    AND topic_registry_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  linkage_json TEXT NOT NULL CHECK (
    json_valid(linkage_json)
    AND json_extract(linkage_json, '$.schemaVersion')
      = 'external-intelligence-linkage-v1'
    AND json_extract(linkage_json, '$.linkageSha256') = linkage_sha256
    AND json_extract(linkage_json, '$.linkedAtMs') = linked_at_ms
    AND json_extract(linkage_json, '$.topicRegistrySha256')
      = topic_registry_sha256
  )
);

CREATE TABLE external_intelligence_manipulation_evidence (
  evidence_sha256 TEXT PRIMARY KEY CHECK (
    length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  linkage_sha256 TEXT NOT NULL,
  analysed_at_ms INTEGER NOT NULL CHECK (analysed_at_ms >= 0),
  policy_sha256 TEXT NOT NULL CHECK (
    length(policy_sha256) = 64 AND policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json)
    AND json_extract(evidence_json, '$.schemaVersion')
      = 'external-intelligence-manipulation-evidence-v1'
    AND json_extract(evidence_json, '$.evidenceSha256') = evidence_sha256
    AND json_extract(evidence_json, '$.linkageSha256') = linkage_sha256
    AND json_extract(evidence_json, '$.analysedAtMs') = analysed_at_ms
    AND json_extract(evidence_json, '$.policySha256') = policy_sha256
  ),
  FOREIGN KEY (linkage_sha256)
    REFERENCES external_intelligence_linkages(linkage_sha256)
);

CREATE TABLE integrated_external_intelligence_assessments (
  integration_sha256 TEXT PRIMARY KEY CHECK (
    length(integration_sha256) = 64
    AND integration_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  assessment_sha256 TEXT NOT NULL CHECK (
    length(assessment_sha256) = 64
    AND assessment_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  assessed_at_ms INTEGER NOT NULL CHECK (assessed_at_ms >= 0),
  linkage_sha256 TEXT NOT NULL,
  manipulation_evidence_sha256 TEXT NOT NULL,
  manipulation_policy_sha256 TEXT NOT NULL CHECK (
    length(manipulation_policy_sha256) = 64
    AND manipulation_policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  assessment_policy_sha256 TEXT NOT NULL CHECK (
    length(assessment_policy_sha256) = 64
    AND assessment_policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  effective_reaction TEXT NOT NULL CHECK (
    effective_reaction IN (
      'ignore', 'watch', 'research-candidate', 'pause-new-risk'
    )
  ),
  actionable_repost_cluster_sha256s_json TEXT NOT NULL CHECK (
    json_valid(actionable_repost_cluster_sha256s_json)
    AND json_type(actionable_repost_cluster_sha256s_json) = 'array'
  ),
  watch_only_repost_cluster_sha256s_json TEXT NOT NULL CHECK (
    json_valid(watch_only_repost_cluster_sha256s_json)
    AND json_type(watch_only_repost_cluster_sha256s_json) = 'array'
  ),
  warnings_json TEXT NOT NULL CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array'
  ),
  integration_json TEXT NOT NULL CHECK (
    json_valid(integration_json)
    AND json_extract(integration_json, '$.schemaVersion')
      = 'integrated-external-intelligence-assessment-v1'
    AND json_extract(integration_json, '$.integrationSha256')
      = integration_sha256
    AND json_extract(integration_json, '$.assessment.assessmentSha256')
      = assessment_sha256
    AND json_extract(integration_json, '$.assessedAtMs') = assessed_at_ms
    AND json_extract(integration_json, '$.linkageSha256') = linkage_sha256
    AND json_extract(integration_json, '$.manipulationEvidenceSha256')
      = manipulation_evidence_sha256
    AND json_extract(integration_json, '$.manipulationPolicySha256')
      = manipulation_policy_sha256
    AND json_extract(integration_json, '$.assessmentPolicySha256')
      = assessment_policy_sha256
    AND json_extract(integration_json, '$.effectiveReaction')
      = effective_reaction
    AND json_extract(integration_json, '$.actionableRepostClusterSha256s')
      = actionable_repost_cluster_sha256s_json
    AND json_extract(integration_json, '$.watchOnlyRepostClusterSha256s')
      = watch_only_repost_cluster_sha256s_json
    AND json_extract(integration_json, '$.warnings') = warnings_json
  ),
  FOREIGN KEY (linkage_sha256)
    REFERENCES external_intelligence_linkages(linkage_sha256),
  FOREIGN KEY (manipulation_evidence_sha256)
    REFERENCES external_intelligence_manipulation_evidence(evidence_sha256)
);

CREATE INDEX idx_integrated_external_intelligence_assessments_time
  ON integrated_external_intelligence_assessments(assessed_at_ms);
CREATE INDEX idx_integrated_external_intelligence_assessments_reaction
  ON integrated_external_intelligence_assessments(
    effective_reaction, assessed_at_ms
  );

CREATE TRIGGER reject_external_intelligence_linkage_conflict
BEFORE INSERT ON external_intelligence_linkages
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_linkages existing
  WHERE existing.linkage_sha256 = NEW.linkage_sha256
    AND (
      existing.linked_at_ms <> NEW.linked_at_ms
      OR existing.topic_registry_sha256 <> NEW.topic_registry_sha256
      OR existing.linkage_json <> NEW.linkage_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence linkage conflict');
END;

CREATE TRIGGER reject_external_intelligence_manipulation_evidence_conflict
BEFORE INSERT ON external_intelligence_manipulation_evidence
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_manipulation_evidence existing
  WHERE existing.evidence_sha256 = NEW.evidence_sha256
    AND (
      existing.linkage_sha256 <> NEW.linkage_sha256
      OR existing.analysed_at_ms <> NEW.analysed_at_ms
      OR existing.policy_sha256 <> NEW.policy_sha256
      OR existing.evidence_json <> NEW.evidence_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence manipulation evidence conflict');
END;

CREATE TRIGGER enforce_integrated_external_intelligence_assessment
BEFORE INSERT ON integrated_external_intelligence_assessments
WHEN
  NOT EXISTS (
    SELECT 1 FROM external_intelligence_manipulation_evidence evidence
    WHERE evidence.evidence_sha256 = NEW.manipulation_evidence_sha256
      AND evidence.linkage_sha256 = NEW.linkage_sha256
      AND evidence.policy_sha256 = NEW.manipulation_policy_sha256
      AND evidence.analysed_at_ms <= NEW.assessed_at_ms
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.actionable_repost_cluster_sha256s_json) actionable
    JOIN json_each(NEW.watch_only_repost_cluster_sha256s_json) watch_only
      ON actionable.value = watch_only.value
  )
BEGIN
  SELECT RAISE(ABORT, 'Integrated external intelligence assessment is invalid');
END;

CREATE TRIGGER reject_integrated_external_intelligence_assessment_conflict
BEFORE INSERT ON integrated_external_intelligence_assessments
WHEN EXISTS (
  SELECT 1 FROM integrated_external_intelligence_assessments existing
  WHERE existing.integration_sha256 = NEW.integration_sha256
    AND (
      existing.assessment_sha256 <> NEW.assessment_sha256
      OR existing.assessed_at_ms <> NEW.assessed_at_ms
      OR existing.linkage_sha256 <> NEW.linkage_sha256
      OR existing.manipulation_evidence_sha256
        <> NEW.manipulation_evidence_sha256
      OR existing.manipulation_policy_sha256
        <> NEW.manipulation_policy_sha256
      OR existing.assessment_policy_sha256 <> NEW.assessment_policy_sha256
      OR existing.effective_reaction <> NEW.effective_reaction
      OR existing.actionable_repost_cluster_sha256s_json
        <> NEW.actionable_repost_cluster_sha256s_json
      OR existing.watch_only_repost_cluster_sha256s_json
        <> NEW.watch_only_repost_cluster_sha256s_json
      OR existing.warnings_json <> NEW.warnings_json
      OR existing.integration_json <> NEW.integration_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Integrated external intelligence assessment conflict');
END;

CREATE TRIGGER prevent_external_intelligence_linkage_update
BEFORE UPDATE ON external_intelligence_linkages
BEGIN SELECT RAISE(ABORT, 'External intelligence linkages are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_linkage_delete
BEFORE DELETE ON external_intelligence_linkages
BEGIN SELECT RAISE(ABORT, 'External intelligence linkages are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_manipulation_evidence_update
BEFORE UPDATE ON external_intelligence_manipulation_evidence
BEGIN SELECT RAISE(ABORT, 'External intelligence manipulation evidence is immutable'); END;
CREATE TRIGGER prevent_external_intelligence_manipulation_evidence_delete
BEFORE DELETE ON external_intelligence_manipulation_evidence
BEGIN SELECT RAISE(ABORT, 'External intelligence manipulation evidence is immutable'); END;
CREATE TRIGGER prevent_integrated_external_intelligence_assessment_update
BEFORE UPDATE ON integrated_external_intelligence_assessments
BEGIN SELECT RAISE(ABORT, 'Integrated external intelligence assessments are immutable'); END;
CREATE TRIGGER prevent_integrated_external_intelligence_assessment_delete
BEFORE DELETE ON integrated_external_intelligence_assessments
BEGIN SELECT RAISE(ABORT, 'Integrated external intelligence assessments are immutable'); END;
