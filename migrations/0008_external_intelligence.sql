CREATE TABLE external_intelligence_source_contracts (
  source_contract_sha256 TEXT PRIMARY KEY CHECK (
    length(source_contract_sha256) = 64
    AND source_contract_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  contract_version INTEGER NOT NULL CHECK (contract_version BETWEEN 1 AND 1000000),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'official-exchange', 'regulator', 'issuer', 'mainstream-news',
    'specialist-news', 'reddit'
  )),
  authority TEXT NOT NULL CHECK (
    (source_kind IN ('official-exchange', 'regulator', 'issuer')
      AND authority = 'authoritative')
    OR (source_kind IN ('mainstream-news', 'specialist-news')
      AND authority = 'reputable')
    OR (source_kind = 'reddit' AND authority = 'social')
  ),
  publisher_id TEXT NOT NULL CHECK (length(publisher_id) BETWEEN 1 AND 500),
  provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 500),
  source_origin TEXT NOT NULL CHECK (
    source_origin GLOB 'https://*' AND substr(source_origin, -1) = '/'
  ),
  acquisition_modes_json TEXT NOT NULL CHECK (
    json_valid(acquisition_modes_json)
    AND json_type(acquisition_modes_json) = 'array'
    AND json_array_length(acquisition_modes_json) BETWEEN 1 AND 4
  ),
  content_policy TEXT NOT NULL CHECK (content_policy IN (
    'digest-only', 'metadata-only', 'permitted-excerpt', 'permitted-full'
  )),
  licence_ref TEXT NOT NULL CHECK (licence_ref GLOB 'https://*'),
  licence_sha256 TEXT NOT NULL CHECK (
    length(licence_sha256) = 64
    AND licence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  attribution_required INTEGER NOT NULL CHECK (attribution_required IN (0, 1)),
  maximum_retention_ms INTEGER CHECK (
    maximum_retention_ms IS NULL
    OR maximum_retention_ms BETWEEN 1 AND 315360000000
  ),
  deletion_handling TEXT NOT NULL CHECK (
    deletion_handling IN ('required', 'not-applicable')
  ),
  model_training_allowed INTEGER NOT NULL CHECK (model_training_allowed = 0),
  approved_at_ms INTEGER NOT NULL CHECK (approved_at_ms >= 0),
  effective_from_ms INTEGER NOT NULL CHECK (
    effective_from_ms >= approved_at_ms
  ),
  expires_at_ms INTEGER CHECK (
    expires_at_ms IS NULL OR expires_at_ms > effective_from_ms
  ),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  UNIQUE (source_id, contract_version),
  CHECK (
    content_policy NOT IN ('permitted-excerpt', 'permitted-full')
    OR maximum_retention_ms IS NOT NULL
  ),
  CHECK (
    source_kind NOT IN ('mainstream-news', 'specialist-news', 'reddit')
    OR attribution_required = 1
  ),
  CHECK (
    source_kind <> 'reddit'
    OR (
      content_policy <> 'permitted-full'
      AND deletion_handling = 'required'
      AND maximum_retention_ms IS NOT NULL
    )
  )
);

CREATE TABLE external_intelligence_items (
  item_id TEXT PRIMARY KEY CHECK (length(item_id) BETWEEN 1 AND 500),
  source_contract_sha256 TEXT NOT NULL,
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'official-exchange', 'regulator', 'issuer', 'mainstream-news',
    'specialist-news', 'reddit'
  )),
  authority TEXT NOT NULL CHECK (authority IN ('authoritative', 'reputable', 'social')),
  publisher_id TEXT NOT NULL CHECK (length(publisher_id) BETWEEN 1 AND 500),
  source_ref TEXT NOT NULL CHECK (source_ref GLOB 'https://*'),
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  acquisition_mode TEXT NOT NULL CHECK (acquisition_mode IN (
    'webhook', 'stream', 'minute-poll', 'scheduled-poll'
  )),
  topic_key TEXT NOT NULL CHECK (length(topic_key) BETWEEN 1 AND 500),
  asset_symbols_json TEXT NOT NULL CHECK (
    json_valid(asset_symbols_json)
    AND json_type(asset_symbols_json) = 'array'
    AND json_array_length(asset_symbols_json) BETWEEN 1 AND 50
  ),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'listing', 'delisting', 'trading-halt', 'security-incident',
    'regulatory-action', 'network-incident', 'market-structure', 'macro',
    'partnership', 'social-attention', 'rumour', 'other'
  )),
  stance TEXT NOT NULL CHECK (stance IN ('positive', 'negative', 'neutral', 'uncertain')),
  published_at_ms INTEGER NOT NULL CHECK (published_at_ms >= 0),
  received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= published_at_ms),
  available_at_ms INTEGER NOT NULL CHECK (available_at_ms >= received_at_ms),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  credibility_bps INTEGER NOT NULL CHECK (credibility_bps BETWEEN 0 AND 10000),
  confidence_bps INTEGER NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
  content_policy TEXT NOT NULL CHECK (content_policy IN (
    'digest-only', 'metadata-only', 'permitted-excerpt', 'permitted-full'
  )),
  model_training_allowed INTEGER NOT NULL CHECK (model_training_allowed = 0),
  UNIQUE (source_id, external_id),
  FOREIGN KEY (source_contract_sha256)
    REFERENCES external_intelligence_source_contracts(source_contract_sha256)
);

CREATE TABLE external_intelligence_corrections (
  correction_sha256 TEXT PRIMARY KEY CHECK (
    length(correction_sha256) = 64
    AND correction_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  item_id TEXT NOT NULL,
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  provider_event_id TEXT NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 500),
  correction_kind TEXT NOT NULL CHECK (
    correction_kind IN ('content-update', 'retraction', 'deletion')
  ),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 500),
  replacement_payload_sha256 TEXT CHECK (
    replacement_payload_sha256 IS NULL
    OR (length(replacement_payload_sha256) = 64
      AND replacement_payload_sha256 NOT GLOB '*[^0-9a-f]*')
  ),
  replacement_content_sha256 TEXT CHECK (
    replacement_content_sha256 IS NULL
    OR (length(replacement_content_sha256) = 64
      AND replacement_content_sha256 NOT GLOB '*[^0-9a-f]*')
  ),
  UNIQUE (source_id, provider_event_id),
  FOREIGN KEY (item_id) REFERENCES external_intelligence_items(item_id),
  CHECK (
    (correction_kind = 'content-update'
      AND replacement_payload_sha256 IS NOT NULL
      AND replacement_content_sha256 IS NOT NULL)
    OR (correction_kind IN ('retraction', 'deletion')
      AND replacement_payload_sha256 IS NULL
      AND replacement_content_sha256 IS NULL)
  )
);

CREATE TABLE external_intelligence_assessments (
  assessment_sha256 TEXT PRIMARY KEY CHECK (
    length(assessment_sha256) = 64
    AND assessment_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  assessed_at_ms INTEGER NOT NULL CHECK (assessed_at_ms >= 0),
  policy_sha256 TEXT NOT NULL CHECK (
    length(policy_sha256) = 64 AND policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
  topic_key TEXT NOT NULL CHECK (length(topic_key) BETWEEN 1 AND 500),
  reaction TEXT NOT NULL CHECK (
    reaction IN ('ignore', 'watch', 'research-candidate', 'pause-new-risk')
  ),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'listing', 'delisting', 'trading-halt', 'security-incident',
    'regulatory-action', 'network-incident', 'market-structure', 'macro',
    'partnership', 'social-attention', 'rumour', 'other'
  )),
  stance TEXT NOT NULL CHECK (stance IN ('positive', 'negative', 'neutral', 'uncertain')),
  accepted_item_ids_json TEXT NOT NULL CHECK (
    json_valid(accepted_item_ids_json)
    AND json_type(accepted_item_ids_json) = 'array'
  ),
  rejected_items_json TEXT NOT NULL CHECK (
    json_valid(rejected_items_json)
    AND json_type(rejected_items_json) = 'array'
  ),
  independent_publisher_count INTEGER NOT NULL CHECK (independent_publisher_count >= 0),
  authoritative_source_count INTEGER NOT NULL CHECK (authoritative_source_count >= 0),
  reputable_source_count INTEGER NOT NULL CHECK (reputable_source_count >= 0),
  social_source_count INTEGER NOT NULL CHECK (social_source_count >= 0),
  earliest_published_at_ms INTEGER NOT NULL CHECK (earliest_published_at_ms >= 0),
  latest_received_at_ms INTEGER NOT NULL CHECK (latest_received_at_ms >= 0),
  maximum_publication_to_receipt_ms INTEGER NOT NULL CHECK (
    maximum_publication_to_receipt_ms >= 0
  ),
  age_at_assessment_ms INTEGER NOT NULL CHECK (age_at_assessment_ms >= 0),
  warnings_json TEXT NOT NULL CHECK (
    json_valid(warnings_json) AND json_type(warnings_json) = 'array'
  )
);

CREATE TABLE external_intelligence_ingestion_batches (
  batch_sha256 TEXT PRIMARY KEY CHECK (
    length(batch_sha256) = 64 AND batch_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  source_contract_count INTEGER NOT NULL CHECK (
    source_contract_count BETWEEN 0 AND 100
  ),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 0 AND 500),
  correction_count INTEGER NOT NULL CHECK (correction_count BETWEEN 0 AND 500),
  assessment_count INTEGER NOT NULL CHECK (assessment_count BETWEEN 0 AND 100),
  CHECK (source_contract_count + item_count + correction_count + assessment_count > 0)
);

CREATE TABLE external_intelligence_batch_source_contracts (
  batch_sha256 TEXT NOT NULL,
  source_contract_sha256 TEXT NOT NULL,
  PRIMARY KEY (batch_sha256, source_contract_sha256),
  FOREIGN KEY (batch_sha256)
    REFERENCES external_intelligence_ingestion_batches(batch_sha256),
  FOREIGN KEY (source_contract_sha256)
    REFERENCES external_intelligence_source_contracts(source_contract_sha256)
);

CREATE TABLE external_intelligence_batch_items (
  batch_sha256 TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (batch_sha256, item_id),
  FOREIGN KEY (batch_sha256)
    REFERENCES external_intelligence_ingestion_batches(batch_sha256),
  FOREIGN KEY (item_id) REFERENCES external_intelligence_items(item_id)
);

CREATE TABLE external_intelligence_batch_corrections (
  batch_sha256 TEXT NOT NULL,
  correction_sha256 TEXT NOT NULL,
  PRIMARY KEY (batch_sha256, correction_sha256),
  FOREIGN KEY (batch_sha256)
    REFERENCES external_intelligence_ingestion_batches(batch_sha256),
  FOREIGN KEY (correction_sha256)
    REFERENCES external_intelligence_corrections(correction_sha256)
);

CREATE TABLE external_intelligence_batch_assessments (
  batch_sha256 TEXT NOT NULL,
  assessment_sha256 TEXT NOT NULL,
  PRIMARY KEY (batch_sha256, assessment_sha256),
  FOREIGN KEY (batch_sha256)
    REFERENCES external_intelligence_ingestion_batches(batch_sha256),
  FOREIGN KEY (assessment_sha256)
    REFERENCES external_intelligence_assessments(assessment_sha256)
);

CREATE TABLE external_intelligence_ingestion_batch_commits (
  batch_sha256 TEXT PRIMARY KEY,
  FOREIGN KEY (batch_sha256)
    REFERENCES external_intelligence_ingestion_batches(batch_sha256)
);

CREATE INDEX idx_external_intelligence_items_topic_time
  ON external_intelligence_items(topic_key, available_at_ms);
CREATE INDEX idx_external_intelligence_items_source_time
  ON external_intelligence_items(source_id, available_at_ms);
CREATE INDEX idx_external_intelligence_corrections_item_time
  ON external_intelligence_corrections(item_id, observed_at_ms);
CREATE INDEX idx_external_intelligence_assessments_topic_time
  ON external_intelligence_assessments(topic_key, assessed_at_ms);

CREATE TRIGGER reject_external_intelligence_source_contract_conflict
BEFORE INSERT ON external_intelligence_source_contracts
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_source_contracts existing
  WHERE existing.source_contract_sha256 = NEW.source_contract_sha256
    AND (
      existing.source_id <> NEW.source_id
      OR existing.contract_version <> NEW.contract_version
      OR existing.source_kind <> NEW.source_kind
      OR existing.authority <> NEW.authority
      OR existing.publisher_id <> NEW.publisher_id
      OR existing.provider_id <> NEW.provider_id
      OR existing.source_origin <> NEW.source_origin
      OR existing.acquisition_modes_json <> NEW.acquisition_modes_json
      OR existing.content_policy <> NEW.content_policy
      OR existing.licence_ref <> NEW.licence_ref
      OR existing.licence_sha256 <> NEW.licence_sha256
      OR existing.attribution_required <> NEW.attribution_required
      OR COALESCE(existing.maximum_retention_ms, -1) <> COALESCE(NEW.maximum_retention_ms, -1)
      OR existing.deletion_handling <> NEW.deletion_handling
      OR existing.model_training_allowed <> NEW.model_training_allowed
      OR existing.approved_at_ms <> NEW.approved_at_ms
      OR existing.effective_from_ms <> NEW.effective_from_ms
      OR COALESCE(existing.expires_at_ms, -1) <> COALESCE(NEW.expires_at_ms, -1)
      OR existing.enabled <> NEW.enabled
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence source contract conflict');
END;

CREATE TRIGGER reject_external_intelligence_item_conflict
BEFORE INSERT ON external_intelligence_items
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_items existing
  WHERE existing.item_id = NEW.item_id
    AND (
      existing.source_contract_sha256 <> NEW.source_contract_sha256
      OR existing.source_id <> NEW.source_id
      OR existing.source_kind <> NEW.source_kind
      OR existing.authority <> NEW.authority
      OR existing.publisher_id <> NEW.publisher_id
      OR existing.source_ref <> NEW.source_ref
      OR existing.external_id <> NEW.external_id
      OR existing.acquisition_mode <> NEW.acquisition_mode
      OR existing.topic_key <> NEW.topic_key
      OR existing.asset_symbols_json <> NEW.asset_symbols_json
      OR existing.event_type <> NEW.event_type
      OR existing.stance <> NEW.stance
      OR existing.published_at_ms <> NEW.published_at_ms
      OR existing.received_at_ms <> NEW.received_at_ms
      OR existing.available_at_ms <> NEW.available_at_ms
      OR existing.payload_sha256 <> NEW.payload_sha256
      OR existing.content_sha256 <> NEW.content_sha256
      OR existing.credibility_bps <> NEW.credibility_bps
      OR existing.confidence_bps <> NEW.confidence_bps
      OR existing.content_policy <> NEW.content_policy
      OR existing.model_training_allowed <> NEW.model_training_allowed
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence item conflict');
END;

CREATE TRIGGER reject_external_intelligence_item_natural_identity_conflict
BEFORE INSERT ON external_intelligence_items
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_items existing
  WHERE existing.source_id = NEW.source_id
    AND existing.external_id = NEW.external_id
    AND existing.item_id <> NEW.item_id
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence item natural identity conflict');
END;

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
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence item source contract mismatch');
END;

CREATE TRIGGER reject_external_intelligence_correction_conflict
BEFORE INSERT ON external_intelligence_corrections
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_corrections existing
  WHERE existing.correction_sha256 = NEW.correction_sha256
    AND (
      existing.item_id <> NEW.item_id
      OR existing.source_id <> NEW.source_id
      OR existing.external_id <> NEW.external_id
      OR existing.provider_event_id <> NEW.provider_event_id
      OR existing.correction_kind <> NEW.correction_kind
      OR existing.observed_at_ms <> NEW.observed_at_ms
      OR existing.reason_code <> NEW.reason_code
      OR COALESCE(existing.replacement_payload_sha256, '')
        <> COALESCE(NEW.replacement_payload_sha256, '')
      OR COALESCE(existing.replacement_content_sha256, '')
        <> COALESCE(NEW.replacement_content_sha256, '')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence correction conflict');
END;

CREATE TRIGGER enforce_external_intelligence_correction_item
BEFORE INSERT ON external_intelligence_corrections
WHEN NOT EXISTS (
  SELECT 1 FROM external_intelligence_items item
  WHERE item.item_id = NEW.item_id
    AND item.source_id = NEW.source_id
    AND item.external_id = NEW.external_id
    AND NEW.observed_at_ms >= item.available_at_ms
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence correction item mismatch');
END;

CREATE TRIGGER reject_external_intelligence_assessment_conflict
BEFORE INSERT ON external_intelligence_assessments
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_assessments existing
  WHERE existing.assessment_sha256 = NEW.assessment_sha256
    AND (
      existing.assessed_at_ms <> NEW.assessed_at_ms
      OR existing.policy_sha256 <> NEW.policy_sha256
      OR existing.policy_json <> NEW.policy_json
      OR existing.topic_key <> NEW.topic_key
      OR existing.reaction <> NEW.reaction
      OR existing.event_type <> NEW.event_type
      OR existing.stance <> NEW.stance
      OR existing.accepted_item_ids_json <> NEW.accepted_item_ids_json
      OR existing.rejected_items_json <> NEW.rejected_items_json
      OR existing.independent_publisher_count <> NEW.independent_publisher_count
      OR existing.authoritative_source_count <> NEW.authoritative_source_count
      OR existing.reputable_source_count <> NEW.reputable_source_count
      OR existing.social_source_count <> NEW.social_source_count
      OR existing.earliest_published_at_ms <> NEW.earliest_published_at_ms
      OR existing.latest_received_at_ms <> NEW.latest_received_at_ms
      OR existing.maximum_publication_to_receipt_ms <> NEW.maximum_publication_to_receipt_ms
      OR existing.age_at_assessment_ms <> NEW.age_at_assessment_ms
      OR existing.warnings_json <> NEW.warnings_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence assessment conflict');
END;

CREATE TRIGGER enforce_external_intelligence_assessment_items
BEFORE INSERT ON external_intelligence_assessments
WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.accepted_item_ids_json) accepted
    LEFT JOIN external_intelligence_items item ON item.item_id = accepted.value
    WHERE item.item_id IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.rejected_items_json) rejected
    LEFT JOIN external_intelligence_items item
      ON item.item_id = json_extract(rejected.value, '$.itemId')
    WHERE item.item_id IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.accepted_item_ids_json) accepted
    JOIN json_each(NEW.rejected_items_json) rejected
      ON accepted.value = json_extract(rejected.value, '$.itemId')
  )
BEGIN
  SELECT RAISE(ABORT, 'External intelligence assessment item set is invalid');
END;

CREATE TRIGGER reject_external_intelligence_batch_conflict
BEFORE INSERT ON external_intelligence_ingestion_batches
WHEN EXISTS (
  SELECT 1 FROM external_intelligence_ingestion_batches existing
  WHERE existing.batch_sha256 = NEW.batch_sha256
    AND (
      existing.recorded_at_ms <> NEW.recorded_at_ms
      OR existing.source_contract_count <> NEW.source_contract_count
      OR existing.item_count <> NEW.item_count
      OR existing.correction_count <> NEW.correction_count
      OR existing.assessment_count <> NEW.assessment_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'External intelligence ingestion batch conflict');
END;

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
    FROM external_intelligence_batch_items membership
    JOIN external_intelligence_items item ON item.item_id = membership.item_id
    JOIN external_intelligence_ingestion_batches batch
      ON batch.batch_sha256 = membership.batch_sha256
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND item.available_at_ms > batch.recorded_at_ms
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
    FROM external_intelligence_batch_assessments membership
    JOIN external_intelligence_assessments assessment
      ON assessment.assessment_sha256 = membership.assessment_sha256
    JOIN external_intelligence_ingestion_batches batch
      ON batch.batch_sha256 = membership.batch_sha256
    WHERE membership.batch_sha256 = NEW.batch_sha256
      AND assessment.assessed_at_ms > batch.recorded_at_ms
  )
BEGIN
  SELECT RAISE(ABORT, 'External intelligence ingestion batch is incomplete');
END;

CREATE TRIGGER prevent_external_intelligence_source_contract_update
BEFORE UPDATE ON external_intelligence_source_contracts
BEGIN SELECT RAISE(ABORT, 'External intelligence source contracts are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_source_contract_delete
BEFORE DELETE ON external_intelligence_source_contracts
BEGIN SELECT RAISE(ABORT, 'External intelligence source contracts are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_item_update
BEFORE UPDATE ON external_intelligence_items
BEGIN SELECT RAISE(ABORT, 'External intelligence items are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_item_delete
BEFORE DELETE ON external_intelligence_items
BEGIN SELECT RAISE(ABORT, 'External intelligence items are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_correction_update
BEFORE UPDATE ON external_intelligence_corrections
BEGIN SELECT RAISE(ABORT, 'External intelligence corrections are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_correction_delete
BEFORE DELETE ON external_intelligence_corrections
BEGIN SELECT RAISE(ABORT, 'External intelligence corrections are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_assessment_update
BEFORE UPDATE ON external_intelligence_assessments
BEGIN SELECT RAISE(ABORT, 'External intelligence assessments are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_assessment_delete
BEFORE DELETE ON external_intelligence_assessments
BEGIN SELECT RAISE(ABORT, 'External intelligence assessments are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_batch_update
BEFORE UPDATE ON external_intelligence_ingestion_batches
BEGIN SELECT RAISE(ABORT, 'External intelligence batches are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_batch_delete
BEFORE DELETE ON external_intelligence_ingestion_batches
BEGIN SELECT RAISE(ABORT, 'External intelligence batches are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_contract_membership_update
BEFORE UPDATE ON external_intelligence_batch_source_contracts
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_contract_membership_delete
BEFORE DELETE ON external_intelligence_batch_source_contracts
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_item_membership_update
BEFORE UPDATE ON external_intelligence_batch_items
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_item_membership_delete
BEFORE DELETE ON external_intelligence_batch_items
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_correction_membership_update
BEFORE UPDATE ON external_intelligence_batch_corrections
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_correction_membership_delete
BEFORE DELETE ON external_intelligence_batch_corrections
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_assessment_membership_update
BEFORE UPDATE ON external_intelligence_batch_assessments
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_assessment_membership_delete
BEFORE DELETE ON external_intelligence_batch_assessments
BEGIN SELECT RAISE(ABORT, 'External intelligence batch memberships are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_commit_update
BEFORE UPDATE ON external_intelligence_ingestion_batch_commits
BEGIN SELECT RAISE(ABORT, 'External intelligence batch commits are immutable'); END;
CREATE TRIGGER prevent_external_intelligence_commit_delete
BEFORE DELETE ON external_intelligence_ingestion_batch_commits
BEGIN SELECT RAISE(ABORT, 'External intelligence batch commits are immutable'); END;
