import { sha256Hex } from "../utils/crypto.ts";

export type TaxRecordKind =
  | "acquisition"
  | "disposal"
  | "fee-disposal"
  | "transfer"
  | "income"
  | "expense"
  | "adjustment";

export type OwnershipChangeStatus = "changed" | "unchanged" | "unknown";

export interface TaxTransactionRecord {
  readonly schemaVersion: "tax-record-v1";
  readonly recordId: string;
  readonly eventKind: TaxRecordKind;
  readonly occurredAt: string;
  readonly australianLocalDate: string;
  readonly australianTimeZone: string;
  readonly venue: string;
  readonly accountReference: string;
  readonly asset: string;
  readonly quantity: number;
  readonly audValue: number;
  readonly feeAud: number;
  readonly purpose: string;
  readonly counterpartyReference: string;
  readonly ownershipChangeStatus: OwnershipChangeStatus;
  readonly valuationSource: string;
  readonly valuationPayloadSha256: string;
  readonly sourcePayloadSha256: string;
  readonly exchangeTradeId?: string;
  readonly exchangeOrderId?: string;
  readonly transactionHash?: string;
  readonly relatedRecordId?: string;
  readonly notes?: string;
}

export interface TaxLotAllocation {
  readonly allocationId: string;
  readonly disposalRecordId: string;
  readonly acquisitionRecordId: string;
  readonly quantity: number;
  readonly selectionReference: string;
}

export interface CgtAllocationOutcome {
  readonly allocationId: string;
  readonly financialYear: string;
  readonly asset: string;
  readonly quantity: number;
  readonly acquisitionRecordId: string;
  readonly acquisitionDate: string;
  readonly disposalRecordId: string;
  readonly disposalDate: string;
  readonly costBaseAud: number;
  readonly capitalProceedsAud: number;
  readonly disposalIncidentalCostsAud: number;
  readonly gainLossAud: number;
  readonly selectionReference: string;
}

export interface TaxFinancialYearSummary {
  readonly financialYear: string;
  readonly disposalCount: number;
  readonly capitalProceedsAud: number;
  readonly costBaseAud: number;
  readonly incidentalCostsAud: number;
  readonly gainLossAud: number;
}

export interface TaxExportBundle {
  readonly schemaVersion: "tax-export-v1";
  readonly generatedAt: string;
  readonly records: readonly TaxTransactionRecord[];
  readonly cgtAllocations: readonly CgtAllocationOutcome[];
  readonly financialYearSummaries: readonly TaxFinancialYearSummary[];
  readonly transactionsCsv: string;
  readonly cgtAllocationsCsv: string;
  readonly financialYearSummaryCsv: string;
  readonly sourcePayloadDigests: readonly string[];
  readonly exportSha256: string;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const EPSILON = 1e-9;

function assertCanonical(name: string, value: string): void {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
}

function assertCanonicalIso(name: string, value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO-8601 timestamp`);
  }
}

function assertLocalDate(value: string): void {
  const match = DATE_PATTERN.exec(value);
  if (match === null) throw new Error("australianLocalDate must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("australianLocalDate is invalid");
  }
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} cannot be negative`);
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be lowercase SHA-256`);
}

function validateRecord(record: TaxTransactionRecord): void {
  if (record.schemaVersion !== "tax-record-v1") throw new Error("Unsupported tax record schema");
  for (const [name, value] of Object.entries({
    recordId: record.recordId,
    australianTimeZone: record.australianTimeZone,
    venue: record.venue,
    accountReference: record.accountReference,
    asset: record.asset,
    purpose: record.purpose,
    counterpartyReference: record.counterpartyReference,
    valuationSource: record.valuationSource,
  })) {
    assertCanonical(name, value);
  }
  assertCanonicalIso("occurredAt", record.occurredAt);
  assertLocalDate(record.australianLocalDate);
  assertPositive("quantity", record.quantity);
  assertNonNegative("audValue", record.audValue);
  assertNonNegative("feeAud", record.feeAud);
  assertDigest("valuationPayloadSha256", record.valuationPayloadSha256);
  assertDigest("sourcePayloadSha256", record.sourcePayloadSha256);
  for (const [name, value] of Object.entries({
    exchangeTradeId: record.exchangeTradeId,
    exchangeOrderId: record.exchangeOrderId,
    transactionHash: record.transactionHash,
    relatedRecordId: record.relatedRecordId,
    notes: record.notes,
  })) {
    if (value !== undefined) assertCanonical(name, value);
  }
  if (record.relatedRecordId === record.recordId) {
    throw new Error("relatedRecordId cannot reference the same record");
  }
}

function validateAndSortRecords(
  records: readonly TaxTransactionRecord[],
): readonly TaxTransactionRecord[] {
  if (records.length === 0) throw new Error("Tax export requires records");
  const ids = new Set<string>();
  const exchangeIdentities = new Set<string>();
  for (const record of records) {
    validateRecord(record);
    if (ids.has(record.recordId)) throw new Error(`Duplicate tax record ${record.recordId}`);
    ids.add(record.recordId);
    if (record.exchangeTradeId !== undefined) {
      const identity = `${record.venue}:${record.accountReference}:${record.exchangeTradeId}:${record.eventKind}:${record.asset}`;
      if (exchangeIdentities.has(identity)) {
        throw new Error(`Duplicate exchange tax identity ${identity}`);
      }
      exchangeIdentities.add(identity);
    }
  }
  for (const record of records) {
    if (record.relatedRecordId !== undefined && !ids.has(record.relatedRecordId)) {
      throw new Error(`Missing related tax record ${record.relatedRecordId}`);
    }
  }
  return [...records].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) || left.recordId.localeCompare(right.recordId),
  );
}

export function australianFinancialYear(localDate: string): string {
  assertLocalDate(localDate);
  const match = DATE_PATTERN.exec(localDate);
  if (match === null) throw new Error("australianLocalDate must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function buildCgtAllocations(
  records: readonly TaxTransactionRecord[],
  allocations: readonly TaxLotAllocation[],
): readonly CgtAllocationOutcome[] {
  const byId = new Map(records.map((record) => [record.recordId, record]));
  const disposalRecords = records.filter(
    (record) => record.eventKind === "disposal" || record.eventKind === "fee-disposal",
  );
  const disposalAllocated = new Map<string, number>();
  const acquisitionAllocated = new Map<string, number>();
  const allocationIds = new Set<string>();
  const allocationPairs = new Set<string>();
  const outcomes: CgtAllocationOutcome[] = [];

  for (const allocation of allocations) {
    assertCanonical("allocationId", allocation.allocationId);
    assertCanonical("selectionReference", allocation.selectionReference);
    assertPositive("allocation quantity", allocation.quantity);
    if (allocationIds.has(allocation.allocationId)) {
      throw new Error(`Duplicate tax allocation ${allocation.allocationId}`);
    }
    allocationIds.add(allocation.allocationId);
    const pairIdentity = `${allocation.disposalRecordId}:${allocation.acquisitionRecordId}`;
    if (allocationPairs.has(pairIdentity)) {
      throw new Error(`Duplicate acquisition/disposal allocation ${pairIdentity}`);
    }
    allocationPairs.add(pairIdentity);

    const disposal = byId.get(allocation.disposalRecordId);
    const acquisition = byId.get(allocation.acquisitionRecordId);
    if (disposal === undefined) throw new Error(`Missing disposal ${allocation.disposalRecordId}`);
    if (acquisition === undefined) throw new Error(`Missing acquisition ${allocation.acquisitionRecordId}`);
    if (disposal.eventKind !== "disposal" && disposal.eventKind !== "fee-disposal") {
      throw new Error(`${disposal.recordId} is not a disposal`);
    }
    if (acquisition.eventKind !== "acquisition") {
      throw new Error(`${acquisition.recordId} is not an acquisition`);
    }
    if (disposal.asset !== acquisition.asset) {
      throw new Error("Tax allocation assets must match");
    }
    if (acquisition.occurredAt > disposal.occurredAt) {
      throw new Error("Tax allocation cannot use a later acquisition");
    }

    const nextDisposal = (disposalAllocated.get(disposal.recordId) ?? 0) + allocation.quantity;
    const nextAcquisition =
      (acquisitionAllocated.get(acquisition.recordId) ?? 0) + allocation.quantity;
    if (nextDisposal > disposal.quantity + EPSILON) {
      throw new Error(`Disposal ${disposal.recordId} is over-allocated`);
    }
    if (nextAcquisition > acquisition.quantity + EPSILON) {
      throw new Error(`Acquisition ${acquisition.recordId} is over-allocated`);
    }
    disposalAllocated.set(disposal.recordId, nextDisposal);
    acquisitionAllocated.set(acquisition.recordId, nextAcquisition);

    const costBaseAud =
      ((acquisition.audValue + acquisition.feeAud) * allocation.quantity) /
      acquisition.quantity;
    const capitalProceedsAud =
      (disposal.audValue * allocation.quantity) / disposal.quantity;
    const disposalIncidentalCostsAud =
      (disposal.feeAud * allocation.quantity) / disposal.quantity;
    outcomes.push({
      allocationId: allocation.allocationId,
      financialYear: australianFinancialYear(disposal.australianLocalDate),
      asset: disposal.asset,
      quantity: allocation.quantity,
      acquisitionRecordId: acquisition.recordId,
      acquisitionDate: acquisition.australianLocalDate,
      disposalRecordId: disposal.recordId,
      disposalDate: disposal.australianLocalDate,
      costBaseAud,
      capitalProceedsAud,
      disposalIncidentalCostsAud,
      gainLossAud: capitalProceedsAud - disposalIncidentalCostsAud - costBaseAud,
      selectionReference: allocation.selectionReference,
    });
  }

  for (const disposal of disposalRecords) {
    const allocated = disposalAllocated.get(disposal.recordId) ?? 0;
    if (Math.abs(allocated - disposal.quantity) > EPSILON) {
      throw new Error(`Disposal ${disposal.recordId} is not fully allocated`);
    }
  }

  return outcomes.sort((left, right) =>
    left.disposalDate.localeCompare(right.disposalDate) ||
    left.disposalRecordId.localeCompare(right.disposalRecordId) ||
    left.acquisitionRecordId.localeCompare(right.acquisitionRecordId),
  );
}

function summariseFinancialYears(
  outcomes: readonly CgtAllocationOutcome[],
): readonly TaxFinancialYearSummary[] {
  const summaries = new Map<string, TaxFinancialYearSummary>();
  const disposalIds = new Map<string, Set<string>>();
  for (const outcome of outcomes) {
    const current = summaries.get(outcome.financialYear) ?? {
      financialYear: outcome.financialYear,
      disposalCount: 0,
      capitalProceedsAud: 0,
      costBaseAud: 0,
      incidentalCostsAud: 0,
      gainLossAud: 0,
    };
    const ids = disposalIds.get(outcome.financialYear) ?? new Set<string>();
    ids.add(outcome.disposalRecordId);
    disposalIds.set(outcome.financialYear, ids);
    summaries.set(outcome.financialYear, {
      financialYear: outcome.financialYear,
      disposalCount: ids.size,
      capitalProceedsAud: current.capitalProceedsAud + outcome.capitalProceedsAud,
      costBaseAud: current.costBaseAud + outcome.costBaseAud,
      incidentalCostsAud:
        current.incidentalCostsAud + outcome.disposalIncidentalCostsAud,
      gainLossAud: current.gainLossAud + outcome.gainLossAud,
    });
  }
  return [...summaries.values()].sort((left, right) =>
    left.financialYear.localeCompare(right.financialYear),
  );
}

function csvText(value: string | undefined): string {
  if (value === undefined) return "";
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csvNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("CSV cannot contain non-finite numbers");
  return String(value);
}

function buildCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return `${headers.join(",")}\n${rows.map((row) => row.join(",")).join("\n")}\n`;
}

function transactionsCsv(records: readonly TaxTransactionRecord[]): string {
  const headers = [
    "record_id", "event_kind", "occurred_at_utc", "australian_local_date",
    "australian_time_zone", "venue", "account_reference", "asset", "quantity",
    "aud_value", "fee_aud", "purpose", "counterparty_reference",
    "ownership_change_status", "valuation_source", "valuation_payload_sha256",
    "source_payload_sha256", "exchange_trade_id", "exchange_order_id",
    "transaction_hash", "related_record_id", "notes",
  ];
  return buildCsv(headers, records.map((record) => [
    csvText(record.recordId), csvText(record.eventKind), csvText(record.occurredAt),
    csvText(record.australianLocalDate), csvText(record.australianTimeZone),
    csvText(record.venue), csvText(record.accountReference), csvText(record.asset),
    csvNumber(record.quantity), csvNumber(record.audValue), csvNumber(record.feeAud),
    csvText(record.purpose), csvText(record.counterpartyReference),
    csvText(record.ownershipChangeStatus), csvText(record.valuationSource),
    csvText(record.valuationPayloadSha256), csvText(record.sourcePayloadSha256),
    csvText(record.exchangeTradeId), csvText(record.exchangeOrderId),
    csvText(record.transactionHash), csvText(record.relatedRecordId), csvText(record.notes),
  ]));
}

function cgtCsv(outcomes: readonly CgtAllocationOutcome[]): string {
  const headers = [
    "allocation_id", "financial_year", "asset", "quantity", "acquisition_record_id",
    "acquisition_date", "disposal_record_id", "disposal_date", "cost_base_aud",
    "capital_proceeds_aud", "disposal_incidental_costs_aud", "gain_loss_aud",
    "selection_reference",
  ];
  return buildCsv(headers, outcomes.map((outcome) => [
    csvText(outcome.allocationId), csvText(outcome.financialYear), csvText(outcome.asset),
    csvNumber(outcome.quantity), csvText(outcome.acquisitionRecordId),
    csvText(outcome.acquisitionDate), csvText(outcome.disposalRecordId),
    csvText(outcome.disposalDate), csvNumber(outcome.costBaseAud),
    csvNumber(outcome.capitalProceedsAud), csvNumber(outcome.disposalIncidentalCostsAud),
    csvNumber(outcome.gainLossAud), csvText(outcome.selectionReference),
  ]));
}

function summaryCsv(summaries: readonly TaxFinancialYearSummary[]): string {
  const headers = [
    "financial_year", "disposal_count", "capital_proceeds_aud", "cost_base_aud",
    "incidental_costs_aud", "gain_loss_aud",
  ];
  return buildCsv(headers, summaries.map((summary) => [
    csvText(summary.financialYear), csvNumber(summary.disposalCount),
    csvNumber(summary.capitalProceedsAud), csvNumber(summary.costBaseAud),
    csvNumber(summary.incidentalCostsAud), csvNumber(summary.gainLossAud),
  ]));
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Tax export contains non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new Error("Tax export contains unsupported data");
}

export async function buildTaxExportBundle(
  recordsInput: readonly TaxTransactionRecord[],
  allocations: readonly TaxLotAllocation[],
  generatedAt: string,
): Promise<TaxExportBundle> {
  assertCanonicalIso("generatedAt", generatedAt);
  const records = validateAndSortRecords(recordsInput);
  const latestOccurredAt = records.at(-1)?.occurredAt;
  if (latestOccurredAt === undefined) throw new Error("Tax export requires records");
  if (generatedAt < latestOccurredAt) {
    throw new Error("Tax export cannot be generated before the latest transaction");
  }
  const cgtAllocations = buildCgtAllocations(records, allocations);
  const financialYearSummaries = summariseFinancialYears(cgtAllocations);
  const transactions = transactionsCsv(records);
  const cgt = cgtCsv(cgtAllocations);
  const summaries = summaryCsv(financialYearSummaries);
  const sourcePayloadDigests = [...new Set(
    records.flatMap((record) => [record.sourcePayloadSha256, record.valuationPayloadSha256]),
  )].sort();
  const content = {
    schemaVersion: "tax-export-v1" as const,
    generatedAt,
    records,
    cgtAllocations,
    financialYearSummaries,
    transactionsCsv: transactions,
    cgtAllocationsCsv: cgt,
    financialYearSummaryCsv: summaries,
    sourcePayloadDigests,
  };
  return { ...content, exportSha256: await sha256Hex(canonicalJson(content)) };
}
