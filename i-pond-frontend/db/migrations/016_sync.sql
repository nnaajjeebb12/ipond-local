-- 016_sync.sql
-- Cloud sync: local Pi → main server (seeme-db.com).
--
-- Applied to BOTH deployments. The local appliance uses `synced_at` to track
-- what it has shipped; the main server uses the unique index as the ON CONFLICT
-- target for idempotent bulk inserts and `source` to tell Pi-synced rows apart
-- from direct ESP32 ingest. The unused half is harmless on either side.

-- Local: NULL = not yet shipped to the cloud.
ALTER TABLE sensor_readings
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Main server: 'local-pi' for synced rows, NULL for direct ESP32 ingest.
ALTER TABLE sensor_readings
    ADD COLUMN IF NOT EXISTS source TEXT;

-- sensor_readings has no surrogate key, so (pond_id, time) identifies a row.
-- TimescaleDB requires the partitioning column (time) in any unique index.
-- Fails loudly if duplicates already exist — dedupe before re-running.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_readings_pond_time_unique
    ON sensor_readings (pond_id, time);

-- Partial index: the sync worker only ever scans unsynced rows, and this stays
-- small because entries drop out of it as they are marked.
CREATE INDEX IF NOT EXISTS idx_sensor_readings_unsynced
    ON sensor_readings (time)
    WHERE synced_at IS NULL;
