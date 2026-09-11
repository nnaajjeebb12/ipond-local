-- 009_pond_status_log.sql
-- Logs pond status snapshots so utilization page can show online/stale/offline/maintenance %.
-- Insert happens every time the frontend polls /api/ponds/status (~30s).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS pond_status_log (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id     INT          NOT NULL REFERENCES ponds(id) ON DELETE CASCADE,
    status      TEXT         NOT NULL CHECK (status IN ('online', 'stale', 'offline', 'maintenance')),
    recorded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pond_status_log
    ON pond_status_log (pond_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_pond_status_log_recorded_at
    ON pond_status_log (recorded_at DESC);
