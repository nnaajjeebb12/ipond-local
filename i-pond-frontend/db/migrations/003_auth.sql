-- 003_auth.sql
-- Add role + password_hash to owners for credentials auth.

ALTER TABLE owners
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE owners
    DROP CONSTRAINT IF EXISTS owners_role_check;

ALTER TABLE owners
    ADD CONSTRAINT owners_role_check CHECK (role IN ('admin', 'owner'));

ALTER TABLE owners
    ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_email_lower
    ON owners (LOWER(email));
