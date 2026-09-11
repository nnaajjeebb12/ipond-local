-- 008_alerts_retrigger.sql
-- Always re-alert after acknowledge: drop unique constraint, allow many rows.

DROP INDEX IF EXISTS idx_sensor_alerts_active;

CREATE INDEX IF NOT EXISTS idx_sensor_alerts_unacknowledged
    ON sensor_alerts (pond_id, sensor)
    WHERE acknowledged_at IS NULL;
