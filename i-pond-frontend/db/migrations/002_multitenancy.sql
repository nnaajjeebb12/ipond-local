-- 002_multitenancy.sql
-- Add owners + ponds. Re-link sensor_readings.pond_id to ponds.id.
-- Safe ALTER on hypertable: drop index, widen column, recreate index, add FK NOT VALID.
-- Existing rows (pond_id 1-10 SMALLINT) stay valid once seed creates ponds 1-10.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- owners ----------

CREATE TABLE IF NOT EXISTS owners (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT         NOT NULL,
    email       TEXT         UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------- ponds ----------

CREATE TABLE IF NOT EXISTS ponds (
    id          SERIAL       PRIMARY KEY,
    owner_id    UUID         NOT NULL REFERENCES owners(id),
    name        TEXT         NOT NULL,
    location    TEXT,
    capacity    FLOAT,
    area        FLOAT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ponds_owner ON ponds (owner_id);

-- ---------- sensor_readings re-link ----------

DROP INDEX IF EXISTS idx_sensor_readings_pond_time;

ALTER TABLE sensor_readings
    DROP CONSTRAINT IF EXISTS pond_id_range;

ALTER TABLE sensor_readings
    ALTER COLUMN pond_id TYPE INT USING pond_id::INT;

ALTER TABLE sensor_readings
    DROP CONSTRAINT IF EXISTS fk_sensor_readings_pond;

ALTER TABLE sensor_readings
    ADD CONSTRAINT fk_sensor_readings_pond
    FOREIGN KEY (pond_id) REFERENCES ponds(id)
    NOT VALID;

CREATE INDEX IF NOT EXISTS idx_sensor_readings_pond_time
    ON sensor_readings (pond_id, time DESC);
