-- 019_app_settings.sql
-- Key/value settings that can change while the appliance runs.
--
-- `.env` is read once at process start and, under the standalone build, is
-- baked into .next/standalone/ — a setting the operator changes from the UI
-- cannot live there. First use: the cloud owner this Pi syncs to
-- (`sync_owner_id`, seeded from SYNC_OWNER_ID in .env when the row is absent)
-- and the last owner name the main server confirmed (`sync_owner_name`).

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT         PRIMARY KEY,
    value       TEXT         NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
