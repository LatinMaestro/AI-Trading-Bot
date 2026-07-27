import {
  assessExternalIntelligence,
  type ExternalIntelligenceAssessment,
  type ExternalIntelligenceItem,
  type ExternalIntelligencePolicy,
  type IntelligenceContentPolicy,
  type IntelligenceSourceKind,
} from "../intelligence/externalIntelligence.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  sourceContractAllowsReference,
  verifyExternalIntelligenceSourceContract,
  type ExternalIntelligenceSourceContract,
} from "../intelligence/sourceRegistry.ts";
import {
  verifyExternalIntelligenceCorrection,
  type ExternalIntelligenceCorrection,
} from "../intelligence/externalIntelligenceRecords.ts";

type D1BindValue = string | number | null;
const MAXIMUM_SOURCE_CONTRACTS = 100;
const MAXIMUM_ITEMS = 500;
const MAXIMUM_CORRECTIONS = 500;
const MAXIMUM_ASSESSMENTS = 100;
const MAXIMUM_SAFE_TIME = Number.MAX_SAFE_INTEGER;

const ITEM_VALIDATION_POLICY: ExternalIntelligencePolicy = {
  maximumItemAgeMs: {
    "official-exchange": MAXIMUM_SAFE_TIME,
    regulator: MAXIMUM_SAFE_TIME,
    issuer: MAXIMUM_SAFE_TIME,
    "mainstream-news": MAXIMUM_SAFE_TIME,
    "specialist-news": MAXIMUM_SAFE_TIME,
    reddit: MAXIMUM_SAFE_TIME,
  },
  maximumReceiptDelayMs: MAXIMUM_SAFE_TIME,
  minimumRiskOnPublishers: 2,
  minimumCredibilityBps: 0,
  maximumItems: 1,
};

const CONTENT_POLICY_RANK: Readonly<Record<IntelligenceContentPolicy, number>> = {
  "digest-only": 0,
  "metadata-only": 1,
  "permitted-excerpt": 2,
  "permitted-full": 3,
};

export interface ExternalIntelligenceItemRecord {
  readonly item: ExternalIntelligenceItem;
  readonly sourceContractSha256: string;
}

export interface ExternalIntelligenceAssessmentRecord {
  readonly assessment: ExternalIntelligenceAssessment;
  readonly assessedAtMs: number;
  readonly policy: ExternalIntelligencePolicy;
}

export interface ExternalIntelligencePersistenceInput {
  readonly recordedAtMs: number;
  readonly sourceContracts: readonly ExternalIntelligenceSourceContract[];
  readonly itemRecords: readonly ExternalIntelligenceItemRecord[];
  readonly corrections: readonly ExternalIntelligenceCorrection[];
  readonly assessmentRecords: readonly ExternalIntelligenceAssessmentRecord[];
}

export interface PreparedExternalIntelligenceAssessmentRecord
  extends ExternalIntelligenceAssessmentRecord {
  readonly policySha256: string;
}

export interface ExternalIntelligenceIngestionBatch {
  readonly batchSha256: string;
  readonly recordedAtMs: number;
  readonly sourceContracts: readonly ExternalIntelligenceSourceContract[];
  readonly itemRecords: readonly ExternalIntelligenceItemRecord[];
  readonly corrections: readonly ExternalIntelligenceCorrection[];
  readonly assessmentRecords: readonly PreparedExternalIntelligenceAssessmentRecord[];
}

export interface ExternalIntelligencePersistenceStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export interface PreparedExternalIntelligencePersistence {
  readonly batch: ExternalIntelligenceIngestionBatch;
  readonly statements: readonly ExternalIntelligencePersistenceStatement[];
}

export const INSERT_EXTERNAL_INTELLIGENCE_BATCH_SQL =
  `INSERT INTO external_intelligence_ingestion_batches
    (batch_sha256, recorded_at_ms, source_contract_count, item_count,
     correction_count, assessment_count)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(batch_sha256) DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_SOURCE_CONTRACTS_JSON_SQL =
  `INSERT INTO external_intelligence_source_contracts
    (source_contract_sha256, source_id, contract_version, source_kind, authority,
     publisher_id, provider_id, source_origin, acquisition_modes_json,
     content_policy, licence_ref, licence_sha256, attribution_required,
     maximum_retention_ms, deletion_handling, model_training_allowed,
     approved_at_ms, effective_from_ms, expires_at_ms, enabled)
   SELECT
     json_extract(value, '$.sourceContractSha256'),
     json_extract(value, '$.sourceId'),
     json_extract(value, '$.contractVersion'),
     json_extract(value, '$.sourceKind'),
     json_extract(value, '$.authority'),
     json_extract(value, '$.publisherId'),
     json_extract(value, '$.providerId'),
     json_extract(value, '$.sourceOrigin'),
     json_extract(value, '$.allowedAcquisitionModes'),
     json_extract(value, '$.contentPolicy'),
     json_extract(value, '$.licenceRef'),
     json_extract(value, '$.licenceSha256'),
     CASE json_extract(value, '$.attributionRequired') WHEN 1 THEN 1 ELSE 0 END,
     json_extract(value, '$.maximumRetentionMs'),
     json_extract(value, '$.deletionHandling'),
     CASE json_extract(value, '$.modelTrainingAllowed') WHEN 1 THEN 1 ELSE 0 END,
     json_extract(value, '$.approvedAtMs'),
     json_extract(value, '$.effectiveFromMs'),
     json_extract(value, '$.expiresAtMs'),
     CASE json_extract(value, '$.enabled') WHEN 1 THEN 1 ELSE 0 END
   FROM json_each(?)
   WHERE 1
   ON CONFLICT DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_CONTRACT_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO external_intelligence_batch_source_contracts
    (batch_sha256, source_contract_sha256)
   SELECT ?, json_extract(value, '$.sourceContractSha256')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(batch_sha256, source_contract_sha256) DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_ITEMS_JSON_SQL =
  `INSERT INTO external_intelligence_items
    (item_id, source_contract_sha256, source_id, source_kind, authority,
     publisher_id, source_ref, external_id, acquisition_mode, topic_key,
     asset_symbols_json, event_type, stance, published_at_ms, received_at_ms,
     available_at_ms, payload_sha256, content_sha256, credibility_bps,
     confidence_bps, content_policy, model_training_allowed)
   SELECT
     json_extract(value, '$.item.itemId'),
     json_extract(value, '$.sourceContractSha256'),
     json_extract(value, '$.item.sourceId'),
     json_extract(value, '$.item.sourceKind'),
     json_extract(value, '$.item.authority'),
     json_extract(value, '$.item.publisherId'),
     json_extract(value, '$.item.sourceRef'),
     json_extract(value, '$.item.externalId'),
     json_extract(value, '$.item.acquisitionMode'),
     json_extract(value, '$.item.topicKey'),
     json_extract(value, '$.item.assetSymbols'),
     json_extract(value, '$.item.eventType'),
     json_extract(value, '$.item.stance'),
     json_extract(value, '$.item.publishedAtMs'),
     json_extract(value, '$.item.receivedAtMs'),
     json_extract(value, '$.item.availableAtMs'),
     json_extract(value, '$.item.payloadSha256'),
     json_extract(value, '$.item.contentSha256'),
     json_extract(value, '$.item.credibilityBps'),
     json_extract(value, '$.item.confidenceBps'),
     json_extract(value, '$.item.contentPolicy'),
     CASE json_extract(value, '$.item.modelTrainingAllowed') WHEN 1 THEN 1 ELSE 0 END
   FROM json_each(?)
   WHERE 1
   ON CONFLICT DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_ITEM_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO external_intelligence_batch_items (batch_sha256, item_id)
   SELECT ?, json_extract(value, '$.item.itemId')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(batch_sha256, item_id) DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_CORRECTIONS_JSON_SQL =
  `INSERT INTO external_intelligence_corrections
    (correction_sha256, item_id, source_id, external_id, provider_event_id,
     correction_kind, observed_at_ms, reason_code, replacement_payload_sha256,
     replacement_content_sha256)
   SELECT
     json_extract(value, '$.correctionSha256'),
     json_extract(value, '$.itemId'),
     json_extract(value, '$.sourceId'),
     json_extract(value, '$.externalId'),
     json_extract(value, '$.providerEventId'),
     json_extract(value, '$.correctionKind'),
     json_extract(value, '$.observedAtMs'),
     json_extract(value, '$.reasonCode'),
     json_extract(value, '$.replacementPayloadSha256'),
     json_extract(value, '$.replacementContentSha256')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_CORRECTION_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO external_intelligence_batch_corrections
    (batch_sha256, correction_sha256)
   SELECT ?, json_extract(value, '$.correctionSha256')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(batch_sha256, correction_sha256) DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_ASSESSMENTS_JSON_SQL =
  `INSERT INTO external_intelligence_assessments
    (assessment_sha256, assessed_at_ms, policy_sha256, policy_json, topic_key,
     reaction, event_type, stance, accepted_item_ids_json, rejected_items_json,
     independent_publisher_count, authoritative_source_count,
     reputable_source_count, social_source_count, earliest_published_at_ms,
     latest_received_at_ms, maximum_publication_to_receipt_ms,
     age_at_assessment_ms, warnings_json)
   SELECT
     json_extract(value, '$.assessment.assessmentSha256'),
     json_extract(value, '$.assessedAtMs'),
     json_extract(value, '$.policySha256'),
     json_extract(value, '$.policy'),
     json_extract(value, '$.assessment.topicKey'),
     json_extract(value, '$.assessment.reaction'),
     json_extract(value, '$.assessment.eventType'),
     json_extract(value, '$.assessment.stance'),
     json_extract(value, '$.assessment.acceptedItemIds'),
     json_extract(value, '$.assessment.rejectedItems'),
     json_extract(value, '$.assessment.independentPublisherCount'),
     json_extract(value, '$.assessment.authoritativeSourceCount'),
     json_extract(value, '$.assessment.reputableSourceCount'),
     json_extract(value, '$.assessment.socialSourceCount'),
     json_extract(value, '$.assessment.earliestPublishedAtMs'),
     json_extract(value, '$.assessment.latestReceivedAtMs'),
     json_extract(value, '$.assessment.maximumPublicationToReceiptMs'),
     json_extract(value, '$.assessment.ageAtAssessmentMs'),
     json_extract(value, '$.assessment.warnings')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_ASSESSMENT_MEMBERSHIPS_JSON_SQL =
  `INSERT INTO external_intelligence_batch_assessments
    (batch_sha256, assessment_sha256)
   SELECT ?, json_extract(value, '$.assessment.assessmentSha256')
   FROM json_each(?)
   WHERE 1
   ON CONFLICT(batch_sha256, assessment_sha256) DO NOTHING`;

export const INSERT_EXTERNAL_INTELLIGENCE_BATCH_COMMIT_SQL =
  `INSERT INTO external_intelligence_ingestion_batch_commits (batch_sha256)
   VALUES (?)
   ON CONFLICT(batch_sha256) DO NOTHING`;

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertBoundedCount(name: string, count: number, maximum: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > maximum) {
    throw new Error(`${name} count must be between 0 and ${maximum}`);
  }
}

function uniqueBy<T>(
  values: readonly T[],
  identity: (value: T) => string,
  name: string,
): void {
  const identities = new Set<string>();
  for (const value of values) {
    const key = identity(value);
    if (identities.has(key)) throw new Error(`Duplicate ${name} ${key}`);
    identities.add(key);
  }
}

function policyRank(policy: IntelligenceContentPolicy): number {
  return CONTENT_POLICY_RANK[policy];
}

function sourceMaximumAge(
  policy: ExternalIntelligencePolicy,
  sourceKind: IntelligenceSourceKind,
): number {
  return policy.maximumItemAgeMs[sourceKind];
}

async function validateItem(item: ExternalIntelligenceItem): Promise<void> {
  await assessExternalIntelligence(
    item.topicKey,
    item.eventType,
    item.stance,
    [item],
    item.availableAtMs,
    ITEM_VALIDATION_POLICY,
  );
}

function validateItemAgainstContract(
  record: ExternalIntelligenceItemRecord,
  contract: ExternalIntelligenceSourceContract,
): void {
  const { item } = record;
  if (
    item.sourceId !== contract.sourceId ||
    item.sourceKind !== contract.sourceKind ||
    item.authority !== contract.authority ||
    item.publisherId !== contract.publisherId
  ) {
    throw new Error(`${item.itemId} does not match its source contract identity`);
  }
  if (!contract.allowedAcquisitionModes.includes(item.acquisitionMode)) {
    throw new Error(`${item.itemId} uses an unapproved acquisition mode`);
  }
  if (policyRank(item.contentPolicy) > policyRank(contract.contentPolicy)) {
    throw new Error(`${item.itemId} exceeds its source content policy`);
  }
  if (!sourceContractAllowsReference(contract, item.sourceRef)) {
    throw new Error(`${item.itemId} source reference is outside its approved origin`);
  }
  if (
    !contract.enabled ||
    item.availableAtMs < contract.effectiveFromMs ||
    (contract.expiresAtMs !== null && item.availableAtMs >= contract.expiresAtMs)
  ) {
    throw new Error(`${item.itemId} source contract is not effective`);
  }
}

function itemIdsForAssessment(
  assessment: ExternalIntelligenceAssessment,
): readonly string[] {
  const itemIds = [
    ...assessment.acceptedItemIds,
    ...assessment.rejectedItems.map((entry) => entry.itemId),
  ];
  uniqueBy(itemIds, (value) => value, "assessment item");
  return itemIds;
}

export async function prepareExternalIntelligencePersistence(
  input: ExternalIntelligencePersistenceInput,
): Promise<PreparedExternalIntelligencePersistence> {
  assertTime("recordedAtMs", input.recordedAtMs);
  assertBoundedCount(
    "source contract",
    input.sourceContracts.length,
    MAXIMUM_SOURCE_CONTRACTS,
  );
  assertBoundedCount("item", input.itemRecords.length, MAXIMUM_ITEMS);
  assertBoundedCount(
    "correction",
    input.corrections.length,
    MAXIMUM_CORRECTIONS,
  );
  assertBoundedCount(
    "assessment",
    input.assessmentRecords.length,
    MAXIMUM_ASSESSMENTS,
  );
  if (
    input.sourceContracts.length +
      input.itemRecords.length +
      input.corrections.length +
      input.assessmentRecords.length ===
    0
  ) {
    throw new Error("External intelligence persistence batch cannot be empty");
  }

  const sourceContracts = [...input.sourceContracts].sort((left, right) =>
    left.sourceContractSha256.localeCompare(right.sourceContractSha256),
  );
  uniqueBy(
    sourceContracts,
    (contract) => contract.sourceContractSha256,
    "source contract digest",
  );
  uniqueBy(
    sourceContracts,
    (contract) => `${contract.sourceId}:${contract.contractVersion}`,
    "source contract version",
  );
  for (const contract of sourceContracts) {
    await verifyExternalIntelligenceSourceContract(contract);
    if (contract.approvedAtMs > input.recordedAtMs) {
      throw new Error("Source contract batch precedes approval");
    }
  }
  const contractsByDigest = new Map(
    sourceContracts.map((contract) => [contract.sourceContractSha256, contract]),
  );

  const itemRecords = [...input.itemRecords].sort((left, right) =>
    left.item.itemId.localeCompare(right.item.itemId),
  );
  uniqueBy(itemRecords, (record) => record.item.itemId, "intelligence item");
  uniqueBy(
    itemRecords,
    (record) => `${record.item.sourceId}:${record.item.externalId}`,
    "intelligence natural identity",
  );
  for (const record of itemRecords) {
    const contract = contractsByDigest.get(record.sourceContractSha256);
    if (contract === undefined) {
      throw new Error(`${record.item.itemId} is missing its source contract`);
    }
    await validateItem(record.item);
    validateItemAgainstContract(record, contract);
    if (record.item.availableAtMs > input.recordedAtMs) {
      throw new Error(`${record.item.itemId} was unavailable at batch time`);
    }
  }
  const itemsById = new Map(itemRecords.map((record) => [record.item.itemId, record.item]));

  const corrections = [...input.corrections].sort((left, right) =>
    left.correctionSha256.localeCompare(right.correctionSha256),
  );
  uniqueBy(
    corrections,
    (correction) => correction.correctionSha256,
    "intelligence correction",
  );
  uniqueBy(
    corrections,
    (correction) => `${correction.sourceId}:${correction.providerEventId}`,
    "correction provider identity",
  );
  for (const correction of corrections) {
    await verifyExternalIntelligenceCorrection(correction);
    const item = itemsById.get(correction.itemId);
    if (
      item === undefined ||
      item.sourceId !== correction.sourceId ||
      item.externalId !== correction.externalId
    ) {
      throw new Error(`${correction.correctionSha256} does not match its item`);
    }
    if (
      correction.observedAtMs < item.availableAtMs ||
      correction.observedAtMs > input.recordedAtMs
    ) {
      throw new Error(`${correction.correctionSha256} has invalid chronology`);
    }
    if (
      correction.correctionKind === "content-update" &&
      correction.replacementPayloadSha256 === item.payloadSha256 &&
      correction.replacementContentSha256 === item.contentSha256
    ) {
      throw new Error("Content update must change immutable content evidence");
    }
  }

  const assessmentRecords: PreparedExternalIntelligenceAssessmentRecord[] = [];
  for (const record of [...input.assessmentRecords].sort((left, right) =>
    left.assessment.assessmentSha256.localeCompare(
      right.assessment.assessmentSha256,
    ),
  )) {
    assertTime("assessedAtMs", record.assessedAtMs);
    if (record.assessedAtMs > input.recordedAtMs) {
      throw new Error("Assessment occurred after its persistence batch");
    }
    const itemIds = itemIdsForAssessment(record.assessment);
    if (itemIds.length < 1) {
      throw new Error("Assessment must reference at least one intelligence item");
    }
    const items = itemIds.map((itemId) => {
      const item = itemsById.get(itemId);
      if (item === undefined) {
        throw new Error(`Assessment references missing item ${itemId}`);
      }
      return item;
    });
    const expected = await assessExternalIntelligence(
      record.assessment.topicKey,
      record.assessment.eventType,
      record.assessment.stance,
      items,
      record.assessedAtMs,
      record.policy,
    );
    if (
      canonicalIntelligenceJson(expected) !==
      canonicalIntelligenceJson(record.assessment)
    ) {
      throw new Error("External intelligence assessment does not reproduce");
    }
    for (const item of items) {
      sourceMaximumAge(record.policy, item.sourceKind);
    }
    assessmentRecords.push({
      ...record,
      policySha256: await sha256CanonicalIntelligence({
        schemaVersion: "external-intelligence-policy-v1",
        ...record.policy,
      }),
    });
  }
  uniqueBy(
    assessmentRecords,
    (record) => record.assessment.assessmentSha256,
    "intelligence assessment",
  );

  const canonicalBatch = {
    schemaVersion: "external-intelligence-ingestion-batch-v1",
    recordedAtMs: input.recordedAtMs,
    sourceContracts,
    itemRecords,
    corrections,
    assessmentRecords,
  };
  const batch: ExternalIntelligenceIngestionBatch = {
    batchSha256: await sha256CanonicalIntelligence(canonicalBatch),
    recordedAtMs: input.recordedAtMs,
    sourceContracts,
    itemRecords,
    corrections,
    assessmentRecords,
  };
  const sourceContractsJson = JSON.stringify(sourceContracts);
  const itemsJson = JSON.stringify(itemRecords);
  const correctionsJson = JSON.stringify(corrections);
  const assessmentsJson = JSON.stringify(assessmentRecords);
  return {
    batch,
    statements: [
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_BATCH_SQL,
        params: [
          batch.batchSha256,
          batch.recordedAtMs,
          sourceContracts.length,
          itemRecords.length,
          corrections.length,
          assessmentRecords.length,
        ],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_SOURCE_CONTRACTS_JSON_SQL,
        params: [sourceContractsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_CONTRACT_MEMBERSHIPS_JSON_SQL,
        params: [batch.batchSha256, sourceContractsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_ITEMS_JSON_SQL,
        params: [itemsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_ITEM_MEMBERSHIPS_JSON_SQL,
        params: [batch.batchSha256, itemsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_CORRECTIONS_JSON_SQL,
        params: [correctionsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_CORRECTION_MEMBERSHIPS_JSON_SQL,
        params: [batch.batchSha256, correctionsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_ASSESSMENTS_JSON_SQL,
        params: [assessmentsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_ASSESSMENT_MEMBERSHIPS_JSON_SQL,
        params: [batch.batchSha256, assessmentsJson],
      },
      {
        sql: INSERT_EXTERNAL_INTELLIGENCE_BATCH_COMMIT_SQL,
        params: [batch.batchSha256],
      },
    ],
  };
}

export class ExternalIntelligenceRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistBatch(
    input: ExternalIntelligencePersistenceInput,
  ): Promise<ExternalIntelligenceIngestionBatch> {
    const prepared = await prepareExternalIntelligencePersistence(input);
    await this.db.batch(
      prepared.statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params),
      ),
    );
    return prepared.batch;
  }
}
