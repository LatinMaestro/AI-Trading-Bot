DROP TRIGGER IF EXISTS enforce_external_intelligence_item_source_contract;

CREATE TRIGGER enforce_external_intelligence_item_source_contract
BEFORE INSERT ON external_intelligence_items
WHEN NOT EXISTS (
  SELECT 1 FROM external_intelligence_source_contracts contract
  WHERE contract.source_contract_sha256 = NEW.source_contract_sha256
    AND contract.source_id = NEW.source_id
    AND contract.source_kind = NEW.source_kind
    AND contract.authority = NEW.authority
    AND contract.publisher_id = NEW.publisher_id
    AND contract.enabled = 1
    AND NEW.available_at_ms >= contract.effective_from_ms
    AND (contract.expires_at_ms IS NULL OR NEW.available_at_ms < contract.expires_at_ms)
    AND EXISTS (
      SELECT 1 FROM json_each(contract.acquisition_modes_json)
      WHERE value = NEW.acquisition_mode
    )
    AND CASE contract.content_policy
      WHEN 'digest-only' THEN 0
      WHEN 'metadata-only' THEN 1
      WHEN 'permitted-excerpt' THEN 2
      WHEN 'permitted-full' THEN 3
      ELSE -1
    END >= CASE NEW.content_policy
      WHEN 'digest-only' THEN 0
      WHEN 'metadata-only' THEN 1
      WHEN 'permitted-excerpt' THEN 2
      WHEN 'permitted-full' THEN 3
      ELSE 4
    END
    AND substr(NEW.source_ref, 1, length(contract.source_origin)) = contract.source_origin
    AND NOT EXISTS (
      SELECT 1 FROM external_intelligence_source_contracts newer
      WHERE newer.source_id = contract.source_id
        AND newer.contract_version > contract.contract_version
        AND newer.effective_from_ms <= NEW.available_at_ms
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence item source contract mismatch');
END;

DROP TRIGGER IF EXISTS enforce_external_intelligence_batch_completion;

CREATE TRIGGER enforce_external_intelligence_batch_completion
BEFORE INSERT ON external_intelligence_ingestion_batch_commits
WHEN NOT EXISTS (
    SELECT 1 FROM external_intelligence_ingestion_batches batch
    WHERE batch.batch_sha256 = NEW.batch_sha256
  )
  OR (SELECT source_contract_count FROM external_intelligence_ingestion_batches
      WHERE batch_sha256 = NEW.batch_sha256) <>
     (SELECT COUNT(*) FROM external_intelligence_batch_source_contracts
      WHERE batch_sha256 = NEW.batch_sha256)
  OR (SELECT item_count FROM external_intelligence_ingestion_batches
      WHERE batch_sha256 = NEW.batch_sha256) <>
     (SELECT COUNT(*) FROM external_intelligence_batch_items
      WHERE batch_sha256 = NEW.batch_sha256)
  OR (SELECT correction_count FROM external_intelligence_ingestion_batches
      WHERE batch_sha256 = NEW.batch_sha256) <>
     (SELECT COUNT(*) FROM external_intelligence_batch_corrections
      WHERE batch_sha256 = NEW.batch_sha256)
  OR (SELECT assessment_count FROM external_intelligence_ingestion_batches
      WHERE batch_sha256 = NEW.batch_sha256) <>
     (SELECT COUNT(*) FROM external_intelligence_batch_assessments
      WHERE batch_sha256 = NEW.batch_sha256)
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_source_contracts membership
    JOIN external_intelligence_source_contracts contract
      ON contract.source_contract_sha256 = membership.source_contract_sha256
    JOIN external_intelligence_ingestion_batches batch
      ON batch.batch_sha256 = membership.batch_sha256
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND contract.approved_at_ms > batch.recorded_at_ms
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_items membership
    JOIN external_intelligence_items item ON item.item_id = membership.item_id
    JOIN external_intelligence_ingestion_batches batch
      ON batch.batch_sha256 = membership.batch_sha256
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND item.available_at_ms > batch.recorded_at_ms
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_items membership
    JOIN external_intelligence_items item ON item.item_id = membership.item_id
    LEFT JOIN external_intelligence_batch_source_contracts contract_membership
      ON contract_membership.batch_sha256 = membership.batch_sha256
      AND contract_membership.source_contract_sha256 = item.source_contract_sha256
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND contract_membership.source_contract_sha256 IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_corrections membership
    JOIN external_intelligence_corrections correction
      ON correction.correction_sha256 = membership.correction_sha256
    JOIN external_intelligence_ingestion_batches batch
      ON batch.batch_sha256 = membership.batch_sha256
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND correction.observed_at_ms > batch.recorded_at_ms
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_corrections membership
    JOIN external_intelligence_corrections correction
      ON correction.correction_sha256 = membership.correction_sha256
    LEFT JOIN external_intelligence_batch_items item_membership
      ON item_membership.batch_sha256 = membership.batch_sha256
      AND item_membership.item_id = correction.item_id
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND item_membership.item_id IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_assessments membership
    JOIN external_intelligence_assessments assessment
      ON assessment.assessment_sha256 = membership.assessment_sha256
    JOIN external_intelligence_ingestion_batches batch
      ON batch.batch_sha256 = membership.batch_sha256
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND assessment.assessed_at_ms > batch.recorded_at_ms
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_assessments membership
    JOIN external_intelligence_assessments assessment
      ON assessment.assessment_sha256 = membership.assessment_sha256
    JOIN json_each(assessment.accepted_item_ids_json) accepted
    LEFT JOIN external_intelligence_batch_items item_membership
      ON item_membership.batch_sha256 = membership.batch_sha256
      AND item_membership.item_id = accepted.value
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND item_membership.item_id IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_assessments membership
    JOIN external_intelligence_assessments assessment
      ON assessment.assessment_sha256 = membership.assessment_sha256
    JOIN json_each(assessment.rejected_items_json) rejected
    LEFT JOIN external_intelligence_batch_items item_membership
      ON item_membership.batch_sha256 = membership.batch_sha256
      AND item_membership.item_id = json_extract(rejected.value, '$.itemId')
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND item_membership.item_id IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_assessments membership
    JOIN external_intelligence_assessments assessment
      ON assessment.assessment_sha256 = membership.assessment_sha256
    JOIN json_each(assessment.accepted_item_ids_json) accepted
    JOIN external_intelligence_items item ON item.item_id = accepted.value
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND item.available_at_ms > assessment.assessed_at_ms
  )
  OR EXISTS (
    SELECT 1
    FROM external_intelligence_batch_assessments membership
    JOIN external_intelligence_assessments assessment
      ON assessment.assessment_sha256 = membership.assessment_sha256
    JOIN json_each(assessment.rejected_items_json) rejected
    JOIN external_intelligence_items item
      ON item.item_id = json_extract(rejected.value, '$.itemId')
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND item.available_at_ms > assessment.assessed_at_ms
  )
BEGIN
  SELECT RAISE(ABORT, 'External intelligence ingestion batch is incomplete');
END;

CREATE TRIGGER prevent_external_intelligence_contract_membership_after_commit
BEFORE INSERT ON external_intelligence_batch_source_contracts
WHEN EXISTS (
    SELECT 1 FROM external_intelligence_ingestion_batch_commits committed
    WHERE committed.batch_sha256 = NEW.batch_sha256
  )
  AND NOT EXISTS (
    SELECT 1 FROM external_intelligence_batch_source_contracts existing
    WHERE existing.batch_sha256 = NEW.batch_sha256
      AND existing.source_contract_sha256 = NEW.source_contract_sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'Committed external intelligence batch is immutable');
END;

CREATE TRIGGER prevent_external_intelligence_item_membership_after_commit
BEFORE INSERT ON external_intelligence_batch_items
WHEN EXISTS (
    SELECT 1 FROM external_intelligence_ingestion_batch_commits committed
    WHERE committed.batch_sha256 = NEW.batch_sha256
  )
  AND NOT EXISTS (
    SELECT 1 FROM external_intelligence_batch_items existing
    WHERE existing.batch_sha256 = NEW.batch_sha256
      AND existing.item_id = NEW.item_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Committed external intelligence batch is immutable');
END;

CREATE TRIGGER prevent_external_intelligence_correction_membership_after_commit
BEFORE INSERT ON external_intelligence_batch_corrections
WHEN EXISTS (
    SELECT 1 FROM external_intelligence_ingestion_batch_commits committed
    WHERE committed.batch_sha256 = NEW.batch_sha256
  )
  AND NOT EXISTS (
    SELECT 1 FROM external_intelligence_batch_corrections existing
    WHERE existing.batch_sha256 = NEW.batch_sha256
      AND existing.correction_sha256 = NEW.correction_sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'Committed external intelligence batch is immutable');
END;

CREATE TRIGGER prevent_external_intelligence_assessment_membership_after_commit
BEFORE INSERT ON external_intelligence_batch_assessments
WHEN EXISTS (
    SELECT 1 FROM external_intelligence_ingestion_batch_commits committed
    WHERE committed.batch_sha256 = NEW.batch_sha256
  )
  AND NOT EXISTS (
    SELECT 1 FROM external_intelligence_batch_assessments existing
    WHERE existing.batch_sha256 = NEW.batch_sha256
      AND existing.assessment_sha256 = NEW.assessment_sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'Committed external intelligence batch is immutable');
END;
