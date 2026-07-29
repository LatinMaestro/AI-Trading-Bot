CREATE TABLE research_reports (
  report_sha256 TEXT PRIMARY KEY CHECK (
    length(report_sha256) = 64
    AND report_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'research-report-v1'
  ),
  report_id TEXT NOT NULL CHECK (
    length(report_id) BETWEEN 1 AND 200
    AND trim(report_id) = report_id
  ),
  generated_at TEXT NOT NULL,
  evaluation_split TEXT NOT NULL CHECK (
    evaluation_split = 'final-holdout'
  ),
  period_start_at_ms INTEGER NOT NULL CHECK (
    period_start_at_ms >= 0
  ),
  period_end_at_ms INTEGER NOT NULL CHECK (
    period_end_at_ms > period_start_at_ms
  ),
  canonical_byte_length INTEGER NOT NULL CHECK (
    canonical_byte_length BETWEEN 2 AND 47185920
  ),
  chunk_count INTEGER NOT NULL CHECK (
    chunk_count BETWEEN 1 AND 90
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= period_end_at_ms
  )
);

CREATE TABLE research_report_chunks (
  report_sha256 TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (
    chunk_index BETWEEN 0 AND 89
  ),
  chunk_sha256 TEXT NOT NULL CHECK (
    length(chunk_sha256) = 64
    AND chunk_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  chunk_byte_length INTEGER NOT NULL CHECK (
    chunk_byte_length BETWEEN 1 AND 524288
  ),
  chunk_text TEXT NOT NULL CHECK (
    length(CAST(chunk_text AS BLOB)) = chunk_byte_length
  ),
  PRIMARY KEY (report_sha256, chunk_index),
  FOREIGN KEY (report_sha256)
    REFERENCES research_reports(report_sha256)
);

CREATE TABLE research_report_commits (
  report_sha256 TEXT PRIMARY KEY,
  chunk_count INTEGER NOT NULL CHECK (
    chunk_count BETWEEN 1 AND 90
  ),
  canonical_byte_length INTEGER NOT NULL CHECK (
    canonical_byte_length BETWEEN 2 AND 47185920
  ),
  persisted_at_ms INTEGER NOT NULL,
  FOREIGN KEY (report_sha256)
    REFERENCES research_reports(report_sha256)
);

CREATE TABLE hourly_trend_breakout_complete_evaluations (
  evaluation_sha256 TEXT PRIMARY KEY CHECK (
    length(evaluation_sha256) = 64
    AND evaluation_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'hourly-trend-breakout-complete-evaluation-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'hourly-trend-breakout-v0.1.0'
  ),
  walk_forward_manifest_sha256 TEXT NOT NULL,
  sensitivity_manifest_sha256 TEXT NOT NULL,
  final_holdout_plan_sha256 TEXT NOT NULL CHECK (
    length(final_holdout_plan_sha256) = 64
    AND final_holdout_plan_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  final_holdout_run_sha256 TEXT NOT NULL,
  final_holdout_result_sha256 TEXT NOT NULL CHECK (
    length(final_holdout_result_sha256) = 64
    AND final_holdout_result_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  report_sha256 TEXT NOT NULL,
  persisted_at_ms INTEGER NOT NULL,
  FOREIGN KEY (walk_forward_manifest_sha256)
    REFERENCES hourly_trend_breakout_evaluation_manifests(manifest_sha256),
  FOREIGN KEY (sensitivity_manifest_sha256)
    REFERENCES hourly_trend_breakout_evaluation_manifests(manifest_sha256),
  FOREIGN KEY (final_holdout_run_sha256)
    REFERENCES hourly_trend_breakout_research_runs(run_sha256),
  FOREIGN KEY (report_sha256)
    REFERENCES research_report_commits(report_sha256)
);

CREATE INDEX idx_research_reports_period
  ON research_reports(period_end_at_ms);
CREATE INDEX idx_research_report_chunks_report
  ON research_report_chunks(report_sha256, chunk_index);
CREATE INDEX idx_complete_evaluations_report
  ON hourly_trend_breakout_complete_evaluations(report_sha256);
CREATE INDEX idx_complete_evaluations_persisted
  ON hourly_trend_breakout_complete_evaluations(persisted_at_ms);

CREATE TRIGGER reject_research_report_conflict
BEFORE INSERT ON research_reports
WHEN EXISTS (
  SELECT 1
  FROM research_reports existing
  WHERE existing.report_sha256 = NEW.report_sha256
    AND (
      existing.schema_version <> NEW.schema_version
      OR existing.report_id <> NEW.report_id
      OR existing.generated_at <> NEW.generated_at
      OR existing.evaluation_split <> NEW.evaluation_split
      OR existing.period_start_at_ms <> NEW.period_start_at_ms
      OR existing.period_end_at_ms <> NEW.period_end_at_ms
      OR existing.canonical_byte_length <> NEW.canonical_byte_length
      OR existing.chunk_count <> NEW.chunk_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Research report conflict');
END;

CREATE TRIGGER validate_research_report_chunk
BEFORE INSERT ON research_report_chunks
WHEN NOT EXISTS (
  SELECT 1
  FROM research_reports report
  WHERE report.report_sha256 = NEW.report_sha256
    AND NEW.chunk_index < report.chunk_count
)
BEGIN
  SELECT RAISE(ABORT, 'Research report chunk header is invalid');
END;

CREATE TRIGGER reject_research_report_chunk_conflict
BEFORE INSERT ON research_report_chunks
WHEN EXISTS (
  SELECT 1
  FROM research_report_chunks existing
  WHERE existing.report_sha256 = NEW.report_sha256
    AND existing.chunk_index = NEW.chunk_index
    AND (
      existing.chunk_sha256 <> NEW.chunk_sha256
      OR existing.chunk_byte_length <> NEW.chunk_byte_length
      OR existing.chunk_text <> NEW.chunk_text
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Research report chunk conflict');
END;

CREATE TRIGGER validate_research_report_commit
BEFORE INSERT ON research_report_commits
WHEN NOT EXISTS (
  SELECT 1
  FROM research_reports report
  WHERE report.report_sha256 = NEW.report_sha256
    AND report.chunk_count = NEW.chunk_count
    AND report.canonical_byte_length = NEW.canonical_byte_length
    AND report.persisted_at_ms <= NEW.persisted_at_ms
    AND (
      SELECT COUNT(*)
      FROM research_report_chunks chunk
      WHERE chunk.report_sha256 = NEW.report_sha256
    ) = NEW.chunk_count
    AND (
      SELECT COALESCE(SUM(chunk.chunk_byte_length), 0)
      FROM research_report_chunks chunk
      WHERE chunk.report_sha256 = NEW.report_sha256
    ) = NEW.canonical_byte_length
)
BEGIN
  SELECT RAISE(ABORT, 'Research report chunks are incomplete');
END;

CREATE TRIGGER reject_research_report_commit_conflict
BEFORE INSERT ON research_report_commits
WHEN EXISTS (
  SELECT 1
  FROM research_report_commits existing
  WHERE existing.report_sha256 = NEW.report_sha256
    AND (
      existing.chunk_count <> NEW.chunk_count
      OR existing.canonical_byte_length <> NEW.canonical_byte_length
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Research report commit conflict');
END;

CREATE TRIGGER validate_complete_evaluation_evidence
BEFORE INSERT ON hourly_trend_breakout_complete_evaluations
WHEN
  NOT EXISTS (
    SELECT 1
    FROM hourly_trend_breakout_evaluation_manifests manifest
    WHERE manifest.manifest_sha256 = NEW.walk_forward_manifest_sha256
      AND manifest.manifest_kind = 'walk-forward'
      AND manifest.schema_version
        = 'hourly-trend-breakout-walk-forward-manifest-v1'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM hourly_trend_breakout_evaluation_manifests manifest
    WHERE manifest.manifest_sha256 = NEW.sensitivity_manifest_sha256
      AND manifest.manifest_kind = 'sensitivity'
      AND manifest.schema_version
        = 'hourly-trend-breakout-sensitivity-manifest-v1'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM hourly_trend_breakout_evaluation_manifest_runs member
    WHERE member.manifest_sha256 = NEW.walk_forward_manifest_sha256
      AND member.run_sha256 = NEW.final_holdout_run_sha256
      AND member.member_kind = 'final-holdout'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM hourly_trend_breakout_evaluation_manifest_runs member
    WHERE member.manifest_sha256 = NEW.sensitivity_manifest_sha256
      AND member.run_sha256 = NEW.final_holdout_run_sha256
      AND member.member_kind = 'sensitivity-variant'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM hourly_trend_breakout_research_runs run
    WHERE run.run_sha256 = NEW.final_holdout_run_sha256
      AND run.plan_sha256 = NEW.final_holdout_plan_sha256
      AND run.result_sha256 = NEW.final_holdout_result_sha256
  )
  OR NOT EXISTS (
    SELECT 1
    FROM research_report_commits report
    WHERE report.report_sha256 = NEW.report_sha256
      AND report.persisted_at_ms <= NEW.persisted_at_ms
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'Complete evaluation evidence is not persisted'
  );
END;

CREATE TRIGGER reject_complete_evaluation_conflict
BEFORE INSERT ON hourly_trend_breakout_complete_evaluations
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_complete_evaluations existing
  WHERE existing.evaluation_sha256 = NEW.evaluation_sha256
    AND (
      existing.schema_version <> NEW.schema_version
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.walk_forward_manifest_sha256
        <> NEW.walk_forward_manifest_sha256
      OR existing.sensitivity_manifest_sha256
        <> NEW.sensitivity_manifest_sha256
      OR existing.final_holdout_plan_sha256
        <> NEW.final_holdout_plan_sha256
      OR existing.final_holdout_run_sha256
        <> NEW.final_holdout_run_sha256
      OR existing.final_holdout_result_sha256
        <> NEW.final_holdout_result_sha256
      OR existing.report_sha256 <> NEW.report_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Complete evaluation conflict');
END;

CREATE TRIGGER prevent_research_report_update
BEFORE UPDATE ON research_reports
BEGIN
  SELECT RAISE(ABORT, 'Research reports are immutable');
END;

CREATE TRIGGER prevent_research_report_delete
BEFORE DELETE ON research_reports
BEGIN
  SELECT RAISE(ABORT, 'Research reports are immutable');
END;

CREATE TRIGGER prevent_research_report_chunk_update
BEFORE UPDATE ON research_report_chunks
BEGIN
  SELECT RAISE(ABORT, 'Research report chunks are immutable');
END;

CREATE TRIGGER prevent_research_report_chunk_delete
BEFORE DELETE ON research_report_chunks
BEGIN
  SELECT RAISE(ABORT, 'Research report chunks are immutable');
END;

CREATE TRIGGER prevent_research_report_commit_update
BEFORE UPDATE ON research_report_commits
BEGIN
  SELECT RAISE(ABORT, 'Research report commits are immutable');
END;

CREATE TRIGGER prevent_research_report_commit_delete
BEFORE DELETE ON research_report_commits
BEGIN
  SELECT RAISE(ABORT, 'Research report commits are immutable');
END;

CREATE TRIGGER prevent_complete_evaluation_update
BEFORE UPDATE ON hourly_trend_breakout_complete_evaluations
BEGIN
  SELECT RAISE(ABORT, 'Complete evaluations are immutable');
END;

CREATE TRIGGER prevent_complete_evaluation_delete
BEFORE DELETE ON hourly_trend_breakout_complete_evaluations
BEGIN
  SELECT RAISE(ABORT, 'Complete evaluations are immutable');
END;
