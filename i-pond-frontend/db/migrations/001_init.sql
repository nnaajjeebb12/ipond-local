-- 001_init.sql
-- TimescaleDB schema for SOLETRONIX LMS sensor readings
-- Pond range: 1-10. No humidity. No client timestamps.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS sensor_readings (
    time              TIMESTAMPTZ      NOT NULL,
    pond_id           SMALLINT         NOT NULL,
    temperature       DOUBLE PRECISION,
    ph                DOUBLE PRECISION,
    salinity          DOUBLE PRECISION,
    dissolved_oxygen  DOUBLE PRECISION,
    CONSTRAINT pond_id_range CHECK (pond_id BETWEEN 1 AND 10)
);

SELECT create_hypertable(
    'sensor_readings',
    'time',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_pond_time
    ON sensor_readings (pond_id, time DESC);
