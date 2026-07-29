import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";
import {
  prepareHourlyTrendBreakoutCompleteEvaluation,
  type HourlyTrendBreakoutCompleteEvaluation,
  type HourlyTrendBreakoutCompleteEvaluationInput,
} from "../research/hourlyTrendBreakoutCompleteEvaluation.ts";
import { sha256Hex } from "../utils/crypto.ts";

type D1BindValue = string | number | null;

const MAXIMUM_CHUNK_BYTES = 524_288;
const MAXIMUM_CHUNKS = 90;
const encoder = new TextEncoder();

export interface HourlyTrendBreakoutCompleteEvaluationPersistenceInput {
  readonly input: HourlyTrendBreakoutCompleteEvaluationInput;
  readonly evaluation: HourlyTrendBreakoutCompleteEvaluation;
  readonly persistedAtMs: number;
}

export interface HourlyTrendBreakoutCompleteEvaluationStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

interface ReportChunk {
  readonly index: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly text: string;
}

interface PersistedResearchReportRow {
  readonly report_sha256: string;
  readonly schema_version: string;
  readonly report_id: string;
  readonly generated_at: string;
  readonly evaluation_split: string;
  readonly period_start_at_ms: number;
  readonly period_end_at_ms: number;
  readonly canonical_byte_length: number;
  readonly chunk_count: number;
  readonly persisted_at_ms: number;
}

interface PersistedResearchReportChunkRow {
  readonly chunk_index: number;
  readonly chunk_sha256: string;
  readonly chunk_byte_length: number;
  readonly chunk_text: string;
}

interface PersistedResearchReportCommitRow {
  readonly report_sha256: string;
  readonly chunk_count: number;
  readonly canonical_byte_length: number;
  readonly persisted_at_ms: number;
}

interface PersistedCompleteEvaluationRow {
  readonly evaluation_sha256: string;
  readonly schema_version: string;
  readonly strategy_version: string;
  readonly walk_forward_manifest_sha256: string;
  readonly sensitivity_manifest_sha256: string;
  readonly final_holdout_plan_sha256: string;
  readonly final_holdout_run_sha256: string;
  readonly final_holdout_result_sha256: string;
  readonly report_sha256: string;
  readonly persisted_at_ms: number;
}

export const INSERT_RESEARCH_REPORT_SQL =
  `INSERT INTO research_reports
    (report_sha256, schema_version, report_id, generated_at,
     evaluation_split, period_start_at_ms, period_end_at_ms,
     canonical_byte_length, chunk_count, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(report_sha256) DO NOTHING`;

export const INSERT_RESEARCH_REPORT_CHUNK_SQL =
  `INSERT INTO research_report_chunks
    (report_sha256, chunk_index, chunk_sha256, chunk_byte_length, chunk_text)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(report_sha256, chunk_index) DO NOTHING`;

export const INSERT_RESEARCH_REPORT_COMMIT_SQL =
  `INSERT INTO research_report_commits
    (report_sha256, chunk_count, canonical_byte_length, persisted_at_ms)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(report_sha256) DO NOTHING`;

export const INSERT_HOURLY_TREND_BREAKOUT_COMPLETE_EVALUATION_SQL =
  `INSERT INTO hourly_trend_breakout_complete_evaluations
    (evaluation_sha256, schema_version, strategy_version,
     walk_forward_manifest_sha256, sensitivity_manifest_sha256,
     final_holdout_plan_sha256, final_holdout_run_sha256,
     final_holdout_result_sha256, report_sha256, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(evaluation_sha256) DO NOTHING`;

const SELECT_RESEARCH_REPORT_SQL =
  `SELECT report_sha256, schema_version, report_id, generated_at,
          evaluation_split, period_start_at_ms, period_end_at_ms,
          canonical_byte_length, chunk_count, persisted_at_ms
   FROM research_reports
   WHERE report_sha256 = ?`;

const SELECT_RESEARCH_REPORT_CHUNKS_SQL =
  `SELECT chunk_index, chunk_sha256, chunk_byte_length, chunk_text
   FROM research_report_chunks
   WHERE report_sha256 = ?
   ORDER BY chunk_index`;

const SELECT_RESEARCH_REPORT_COMMIT_SQL =
  `SELECT report_sha256, chunk_count, canonical_byte_length, persisted_at_ms
   FROM research_report_commits
   WHERE report_sha256 = ?`;

const SELECT_COMPLETE_EVALUATION_SQL =
  `SELECT evaluation_sha256, schema_version, strategy_version,
          walk_forward_manifest_sha256, sensitivity_manifest_sha256,
          final_holdout_plan_sha256, final_holdout_run_sha256,
          final_holdout_result_sha256, report_sha256, persisted_at_ms
   FROM hourly_trend_breakout_complete_evaluations
   WHERE evaluation_sha256 = ?`;

function splitUtf8(value: string): readonly string[] {
  const bytes = encoder.encode(value);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.byteLength) {
    let end = Math.min(start + MAXIMUM_CHUNK_BYTES, bytes.byteLength);
    while (
      end < bytes.byteLength &&
      (bytes[end]! & 0xc0) === 0x80
    ) {
      end -= 1;
    }
    if (end <= start) {
      throw new Error("research report cannot be split at a UTF-8 boundary");
    }
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  if (chunks.length === 0 || chunks.length > MAXIMUM_CHUNKS) {
    throw new Error(
      `research report requires between 1 and ${MAXIMUM_CHUNKS} chunks`,
    );
  }
  return chunks;
}

async function prepareChunks(value: string): Promise<readonly ReportChunk[]> {
  return Promise.all(
    splitUtf8(value).map(async (text, index) => ({
      index,
      sha256: await sha256Hex(text),
      byteLength: encoder.encode(text).byteLength,
      text,
    })),
  );
}

function exactEvaluation(
  expected: HourlyTrendBreakoutCompleteEvaluation,
  supplied: HourlyTrendBreakoutCompleteEvaluation,
): boolean {
  return (
    expected.evaluationSha256 === supplied.evaluationSha256 &&
    canonicalIntelligenceJson(expected) ===
      canonicalIntelligenceJson(supplied)
  );
}

export async function prepareHourlyTrendBreakoutCompleteEvaluationPersistence(
  persistence:
    HourlyTrendBreakoutCompleteEvaluationPersistenceInput,
): Promise<readonly HourlyTrendBreakoutCompleteEvaluationStatement[]> {
  const reproduced =
    await prepareHourlyTrendBreakoutCompleteEvaluation(persistence.input);
  if (!exactEvaluation(reproduced, persistence.evaluation)) {
    throw new Error("complete hourly evaluation is not reproducible");
  }
  const report = reproduced.report;
  const generatedAtMs = Date.parse(report.generatedAt);
  if (
    !Number.isSafeInteger(persistence.persistedAtMs) ||
    persistence.persistedAtMs < report.periodEndMs ||
    !Number.isFinite(generatedAtMs) ||
    persistence.persistedAtMs < generatedAtMs
  ) {
    throw new Error("complete evaluation persistence chronology is invalid");
  }
  const reportJson = canonicalIntelligenceJson(report);
  const reportByteLength = encoder.encode(reportJson).byteLength;
  const chunks = await prepareChunks(reportJson);
  return [
    {
      sql: INSERT_RESEARCH_REPORT_SQL,
      params: [
        report.reportSha256,
        report.schemaVersion,
        report.reportId,
        report.generatedAt,
        report.evaluationSplit,
        report.periodStartMs,
        report.periodEndMs,
        reportByteLength,
        chunks.length,
        persistence.persistedAtMs,
      ],
    },
    ...chunks.map((chunk) => ({
      sql: INSERT_RESEARCH_REPORT_CHUNK_SQL,
      params: [
        report.reportSha256,
        chunk.index,
        chunk.sha256,
        chunk.byteLength,
        chunk.text,
      ],
    })),
    {
      sql: INSERT_RESEARCH_REPORT_COMMIT_SQL,
      params: [
        report.reportSha256,
        chunks.length,
        reportByteLength,
        persistence.persistedAtMs,
      ],
    },
    {
      sql: INSERT_HOURLY_TREND_BREAKOUT_COMPLETE_EVALUATION_SQL,
      params: [
        reproduced.evaluationSha256,
        reproduced.schemaVersion,
        reproduced.strategyVersion,
        reproduced.walkForwardManifestSha256,
        reproduced.sensitivityManifestSha256,
        reproduced.finalHoldoutPlanSha256,
        reproduced.finalHoldoutRunSha256,
        reproduced.finalHoldoutResultSha256,
        report.reportSha256,
        persistence.persistedAtMs,
      ],
    },
  ];
}

function reportRowMatches(
  row: PersistedResearchReportRow,
  report: HourlyTrendBreakoutCompleteEvaluation["report"],
  byteLength: number,
  chunkCount: number,
  persistedAtMs: number,
): boolean {
  return (
    row.report_sha256 === report.reportSha256 &&
    row.schema_version === report.schemaVersion &&
    row.report_id === report.reportId &&
    row.generated_at === report.generatedAt &&
    row.evaluation_split === report.evaluationSplit &&
    row.period_start_at_ms === report.periodStartMs &&
    row.period_end_at_ms === report.periodEndMs &&
    row.canonical_byte_length === byteLength &&
    row.chunk_count === chunkCount &&
    row.persisted_at_ms >= report.periodEndMs &&
    row.persisted_at_ms <= persistedAtMs
  );
}

async function chunksMatch(
  rows: readonly PersistedResearchReportChunkRow[],
  expected: readonly ReportChunk[],
): Promise<boolean> {
  if (rows.length !== expected.length) return false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const chunk = expected[index]!;
    if (
      row.chunk_index !== chunk.index ||
      row.chunk_sha256 !== chunk.sha256 ||
      row.chunk_byte_length !== chunk.byteLength ||
      row.chunk_text !== chunk.text ||
      await sha256Hex(row.chunk_text) !== row.chunk_sha256 ||
      encoder.encode(row.chunk_text).byteLength !== row.chunk_byte_length
    ) {
      return false;
    }
  }
  return true;
}

function commitRowMatches(
  row: PersistedResearchReportCommitRow,
  reportSha256: string,
  byteLength: number,
  chunkCount: number,
  persistedAtMs: number,
): boolean {
  return (
    row.report_sha256 === reportSha256 &&
    row.canonical_byte_length === byteLength &&
    row.chunk_count === chunkCount &&
    row.persisted_at_ms <= persistedAtMs
  );
}

function evaluationRowMatches(
  row: PersistedCompleteEvaluationRow,
  evaluation: HourlyTrendBreakoutCompleteEvaluation,
  persistedAtMs: number,
): boolean {
  return (
    row.evaluation_sha256 === evaluation.evaluationSha256 &&
    row.schema_version === evaluation.schemaVersion &&
    row.strategy_version === evaluation.strategyVersion &&
    row.walk_forward_manifest_sha256 ===
      evaluation.walkForwardManifestSha256 &&
    row.sensitivity_manifest_sha256 ===
      evaluation.sensitivityManifestSha256 &&
    row.final_holdout_plan_sha256 ===
      evaluation.finalHoldoutPlanSha256 &&
    row.final_holdout_run_sha256 ===
      evaluation.finalHoldoutRunSha256 &&
    row.final_holdout_result_sha256 ===
      evaluation.finalHoldoutResultSha256 &&
    row.report_sha256 === evaluation.report.reportSha256 &&
    row.persisted_at_ms >= evaluation.report.periodEndMs &&
    row.persisted_at_ms <= persistedAtMs
  );
}

export class HourlyTrendBreakoutCompleteEvaluationRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: HourlyTrendBreakoutCompleteEvaluationPersistenceInput,
  ): Promise<HourlyTrendBreakoutCompleteEvaluation> {
    const statements =
      await prepareHourlyTrendBreakoutCompleteEvaluationPersistence(input);
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...statement.params),
      ),
    );
    const reportSha256 = input.evaluation.report.reportSha256;
    const [reportRow, chunkResult, commitRow, evaluationRow] =
      await Promise.all([
        this.db
          .prepare(SELECT_RESEARCH_REPORT_SQL)
          .bind(reportSha256)
          .first<PersistedResearchReportRow>(),
        this.db
          .prepare(SELECT_RESEARCH_REPORT_CHUNKS_SQL)
          .bind(reportSha256)
          .all<PersistedResearchReportChunkRow>(),
        this.db
          .prepare(SELECT_RESEARCH_REPORT_COMMIT_SQL)
          .bind(reportSha256)
          .first<PersistedResearchReportCommitRow>(),
        this.db
          .prepare(SELECT_COMPLETE_EVALUATION_SQL)
          .bind(input.evaluation.evaluationSha256)
          .first<PersistedCompleteEvaluationRow>(),
      ]);
    const reportJson = canonicalIntelligenceJson(input.evaluation.report);
    const reportByteLength = encoder.encode(reportJson).byteLength;
    const expectedChunks = await prepareChunks(reportJson);
    const persistedChunks = chunkResult.results ?? [];
    if (
      reportRow === null ||
      commitRow === null ||
      evaluationRow === null ||
      !reportRowMatches(
        reportRow,
        input.evaluation.report,
        reportByteLength,
        expectedChunks.length,
        input.persistedAtMs,
      ) ||
      !await chunksMatch(persistedChunks, expectedChunks) ||
      persistedChunks.map((chunk) => chunk.chunk_text).join("") !==
        reportJson ||
      !commitRowMatches(
        commitRow,
        reportSha256,
        reportByteLength,
        expectedChunks.length,
        input.persistedAtMs,
      ) ||
      !evaluationRowMatches(
        evaluationRow,
        input.evaluation,
        input.persistedAtMs,
      )
    ) {
      throw new Error("persisted complete evaluation verification failed");
    }
    return input.evaluation;
  }
}
