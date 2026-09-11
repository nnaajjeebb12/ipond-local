-- 007_alerts.sql
-- Sensor alerts: triggered when N consecutive readings are out of optimal range.
-- One ACTIVE alert per (pond, sensor): enforced via partial unique index on resolved_at IS NULL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sensor_alerts (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id            INT          NOT NULL REFERENCES ponds(id) ON DELETE CASCADE,
    sensor             TEXT         NOT NULL CHECK (sensor IN ('temperature','ph','salinity','dissolved_oxygen')),
    triggered_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    acknowledged_at    TIMESTAMPTZ,
    acknowledged_by    UUID         REFERENCES owners(id) ON DELETE SET NULL,
    consecutive_count  INT          NOT NULL,
    last_value         FLOAT        NOT NULL,
    optimal_min        FLOAT        NOT NULL,
    optimal_max        FLOAT        NOT NULL,
    resolved_at        TIMESTAMPTZ
);

-- One active (unresolved) alert per pond+sensor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_alerts_active
    ON sensor_alerts (pond_id, sensor)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sensor_alerts_triggered_at
    ON sensor_alerts (triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_alerts_pond
    ON sensor_alerts (pond_id);
