-- 004_optimal_ranges.sql
-- Per-pond, per-sensor optimal thresholds with audit log.
-- Replaces any earlier simpler threshold table.

DROP TABLE IF EXISTS pond_sensor_thresholds CASCADE;

CREATE TABLE pond_sensor_thresholds (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id      INT          NOT NULL REFERENCES ponds(id) ON DELETE CASCADE,
    sensor       TEXT         NOT NULL CHECK (sensor IN ('temperature','ph','salinity','dissolved_oxygen')),
    optimal_min  FLOAT        NOT NULL,
    optimal_max  FLOAT        NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by   UUID         REFERENCES owners(id),
    UNIQUE (pond_id, sensor),
    CHECK (optimal_min < optimal_max)
);

CREATE TABLE IF NOT EXISTS pond_sensor_thresholds_audit (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id     INT          NOT NULL,
    sensor      TEXT         NOT NULL,
    old_min     FLOAT,
    old_max     FLOAT,
    new_min     FLOAT        NOT NULL,
    new_max     FLOAT        NOT NULL,
    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    changed_by  UUID         REFERENCES owners(id)
);

CREATE INDEX IF NOT EXISTS idx_psta_pond_sensor_time
    ON pond_sensor_thresholds_audit (pond_id, sensor, changed_at DESC);

-- Defaults for every pond × sensor.
INSERT INTO pond_sensor_thresholds (pond_id, sensor, optimal_min, optimal_max)
SELECT p.id, s.sensor, s.optimal_min, s.optimal_max
  FROM ponds p
  CROSS JOIN (VALUES
      ('temperature',     22.0, 27.0),
      ('ph',               6.5,  7.5),
      ('salinity',        15.0, 30.0),
      ('dissolved_oxygen', 5.0,  8.0)
  ) AS s(sensor, optimal_min, optimal_max)
ON CONFLICT (pond_id, sensor) DO NOTHING;
