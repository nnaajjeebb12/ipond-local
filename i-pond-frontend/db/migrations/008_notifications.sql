-- 008_notifications.sql
-- Maintenance requests submitted by owners, handled by admin.

DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('pending', 'acknowledged', 'resolved');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS maintenance_requests (
    id               UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id          INT                 NOT NULL REFERENCES ponds(id) ON DELETE CASCADE,
    requested_by     UUID                NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    message          TEXT                NOT NULL,
    status           notification_status NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    acknowledged_at  TIMESTAMPTZ,
    acknowledged_by  UUID                REFERENCES owners(id) ON DELETE SET NULL,
    resolved_at      TIMESTAMPTZ,
    resolved_by      UUID                REFERENCES owners(id) ON DELETE SET NULL,
    admin_note       TEXT
);

CREATE INDEX IF NOT EXISTS idx_maintenance_pond ON maintenance_requests (pond_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requested_by ON maintenance_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_requests (status);
CREATE INDEX IF NOT EXISTS idx_maintenance_created_at ON maintenance_requests (created_at DESC);
