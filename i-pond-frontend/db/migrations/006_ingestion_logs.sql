-- 006_ingestion_logs.sql
-- Audit log of every ESP32 ingest attempt (success and failure).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS ingestion_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pond_id           INT REFERENCES ponds(id) ON DELETE SET NULL,
    pond_code         TEXT,
    raw_payload       JSONB NOT NULL,
    temperature       FLOAT,
    ph                FLOAT,
    salinity          FLOAT,
    dissolved_oxygen  FLOAT,
    http_status       INT NOT NULL,
    ip_address        TEXT,
    error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_logs_received_at
    ON ingestion_logs (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_logs_pond_id
    ON ingestion_logs (pond_id);

CREATE INDEX IF NOT EXISTS idx_ingestion_logs_http_status
    ON ingestion_logs (http_status);
