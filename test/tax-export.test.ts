import assert from "node:assert/strict";
import test from "node:test";
import {
  australianFinancialYear,
  buildTaxExportBundle,
  buildTaxRecordArchive,
  type TaxLotAllocation,
  type TaxTransactionRecord,
} from "../src/tax/export.ts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function record(
  recordId: string,
  eventKind: TaxTransactionRecord["eventKind"],
  asset: string,
  quantity: number,
  audValue: number,
  occurredAt: string,
  localDate: string,
  overrides: Partial<TaxTransactionRecord> = {},
): TaxTransactionRecord {
  return {
    schemaVersion: "tax-record-v1",
    recordId,
    eventKind,
    occurredAt,
    australianLocalDate: localDate,
    australianTimeZone: "Australia/Brisbane",
    venue: "test-exchange",
    accountReference: "account-1",
    asset,
    quantity,
    audValue,
    feeAud: 0,
    purpose: "spot-trade",
    counterpartyReference: "test-exchange",
    ownershipChangeStatus: "changed",
    valuationSource: "test-aud-market",
    valuationPayloadSha256: SHA_A,
    sourcePayloadSha256: SHA_B,
    ...overrides,
  };
}

const acquisition = record(
  "acq-btc",
  "acquisition",
  "BTC",
  2,
  200,
  "2025-07-01T00:00:00.000Z",
  "2025-07-01",
  { feeAud: 2, exchangeTradeId: "buy-1" },
);
const disposal = record(
  "disp-btc",
  "disposal",
  "BTC",
  1,
  150,
  "2026-06-30T03:00:00.000Z",
  "2026-06-30",
  { feeAud: 1, exchangeTradeId: "sell-1" },
);
const allocation: TaxLotAllocation = {
  allocationId: "alloc-1",
  disposalRecordId: disposal.recordId,
  acquisitionRecordId: acquisition.recordId,
  quantity: 1,
  selectionReference: "explicit-lot-selection-1",
};

test("builds deterministic transaction, CGT and financial-year exports", async () => {
  const first = await buildTaxExportBundle(
    [disposal, acquisition],
    [allocation],
    "2026-07-01T00:00:00.000Z",
  );
  const second = await buildTaxExportBundle(
    [acquisition, disposal],
    [allocation],
    "2026-07-01T00:00:00.000Z",
  );
  assert.equal(first.exportSha256, second.exportSha256);
  assert.match(first.exportSha256, /^[0-9a-f]{64}$/);
  const outcome = first.cgtAllocations[0];
  if (outcome === undefined) throw new Error("Expected CGT outcome");
  assert.equal(outcome.financialYear, "2025-26");
  assert.equal(outcome.costBaseAud, 101);
  assert.equal(outcome.capitalProceedsAud, 150);
  assert.equal(outcome.disposalIncidentalCostsAud, 1);
  assert.equal(outcome.gainLossAud, 48);
  assert.equal(first.financialYearSummaries[0]?.disposalCount, 1);
});

test("preserves paired crypto-to-crypto records and neutralises CSV formulas", async () => {
  const ethDisposal = record(
    "swap-eth-disposal",
    "disposal",
    "ETH",
    1,
    300,
    "2026-07-15T00:00:00.000Z",
    "2026-07-15",
    { relatedRecordId: "swap-sol-acquisition", notes: "=HYPERLINK(\"x\")" },
  );
  const ethAcquisition = record(
    "eth-original",
    "acquisition",
    "ETH",
    1,
    200,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01",
  );
  const solAcquisition = record(
    "swap-sol-acquisition",
    "acquisition",
    "SOL",
    10,
    300,
    "2026-07-15T00:00:00.000Z",
    "2026-07-15",
    { relatedRecordId: "swap-eth-disposal" },
  );
  const bundle = await buildTaxExportBundle(
    [ethDisposal, ethAcquisition, solAcquisition],
    [{
      allocationId: "eth-lot",
      disposalRecordId: ethDisposal.recordId,
      acquisitionRecordId: ethAcquisition.recordId,
      quantity: 1,
      selectionReference: "specific-identification",
    }],
    "2026-07-16T00:00:00.000Z",
  );
  assert.ok(bundle.transactionsCsv.includes("'=HYPERLINK"));
  assert.equal(
    bundle.records.find((entry) => entry.recordId === ethDisposal.recordId)?.relatedRecordId,
    solAcquisition.recordId,
  );
  assert.equal(bundle.cgtAllocations[0]?.gainLossAud, 100);
});

test("exports factual records before lot allocation is complete", async () => {
  const archive = await buildTaxRecordArchive(
    [acquisition, disposal],
    "2026-07-01T00:00:00.000Z",
  );
  assert.equal(archive.records.length, 2);
  assert.match(archive.archiveSha256, /^[0-9a-f]{64}$/);
  assert.ok(archive.transactionsCsv.includes("disp-btc"));
});

test("uses Australian financial-year boundaries", () => {
  assert.equal(australianFinancialYear("2026-06-30"), "2025-26");
  assert.equal(australianFinancialYear("2026-07-01"), "2026-27");
});

test("fails closed for missing, mismatched, later or excessive lot allocations", async () => {
  await assert.rejects(
    buildTaxExportBundle([acquisition, disposal], [], "2026-07-01T00:00:00.000Z"),
    /not fully allocated/,
  );
  const ethAcquisition = record(
    "acq-eth",
    "acquisition",
    "ETH",
    1,
    100,
    "2025-07-01T00:00:00.000Z",
    "2025-07-01",
  );
  await assert.rejects(
    buildTaxExportBundle(
      [acquisition, ethAcquisition, disposal],
      [{ ...allocation, acquisitionRecordId: ethAcquisition.recordId }],
      "2026-07-01T00:00:00.000Z",
    ),
    /assets must match/,
  );
  const later = record(
    "later",
    "acquisition",
    "BTC",
    1,
    100,
    "2026-07-01T00:00:00.000Z",
    "2026-07-01",
  );
  await assert.rejects(
    buildTaxExportBundle(
      [acquisition, disposal, later],
      [{ ...allocation, acquisitionRecordId: later.recordId }],
      "2026-07-02T00:00:00.000Z",
    ),
    /later acquisition/,
  );
  await assert.rejects(
    buildTaxExportBundle(
      [acquisition, disposal],
      [{ ...allocation, quantity: 2 }],
      "2026-07-01T00:00:00.000Z",
    ),
    /over-allocated/,
  );
});

test("rejects malformed records, duplicate exchange identities and premature exports", async () => {
  await assert.rejects(
    buildTaxExportBundle(
      [acquisition, { ...disposal, valuationPayloadSha256: "bad" }],
      [allocation],
      "2026-07-01T00:00:00.000Z",
    ),
    /lowercase SHA-256/,
  );
  await assert.rejects(
    buildTaxExportBundle(
      [acquisition, disposal, { ...disposal, recordId: "duplicate-disposal" }],
      [allocation],
      "2026-07-01T00:00:00.000Z",
    ),
    /Duplicate exchange tax identity/,
  );
  await assert.rejects(
    buildTaxExportBundle(
      [acquisition, disposal],
      [allocation],
      "2026-06-01T00:00:00.000Z",
    ),
    /before the latest transaction/,
  );
});
