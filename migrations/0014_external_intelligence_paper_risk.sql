CREATE TRIGGER reject_risk_event_identity_conflict
BEFORE INSERT ON risk_events
WHEN EXISTS (
  SELECT 1 FROM risk_events existing
  WHERE existing.event_id = NEW.event_id
    AND (
      existing.cycle_id <> NEW.cycle_id
      OR existing.severity <> NEW.severity
      OR existing.code <> NEW.code
      OR existing.detail_json <> NEW.detail_json
      OR existing.created_at <> NEW.created_at
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Risk event identity conflict');
END;

CREATE TRIGGER prevent_risk_event_update
BEFORE UPDATE ON risk_events
BEGIN SELECT RAISE(ABORT, 'Risk events are immutable'); END;

CREATE TRIGGER prevent_risk_event_delete
BEFORE DELETE ON risk_events
BEGIN SELECT RAISE(ABORT, 'Risk events are immutable'); END;
