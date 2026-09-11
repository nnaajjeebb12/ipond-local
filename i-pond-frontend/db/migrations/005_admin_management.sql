-- 005_admin_management.sql
-- Admin user/pond management: company_name, pond_code, viewer role, user_pond_access M2M.

-- ---------- owners ----------

ALTER TABLE owners
    ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE owners
    DROP CONSTRAINT IF EXISTS owners_role_check;

ALTER TABLE owners
    ADD CONSTRAINT owners_role_check CHECK (role IN ('admin', 'owner', 'viewer'));

-- ---------- ponds ----------

ALTER TABLE ponds
    ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE ponds
    ADD COLUMN IF NOT EXISTS pond_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ponds_pond_code
    ON ponds (pond_code)
    WHERE pond_code IS NOT NULL;

-- Backfill pond_code as PND-### from id (only for nulls).
UPDATE ponds
   SET pond_code = 'PND-' || LPAD(id::text, 3, '0')
 WHERE pond_code IS NULL;

-- Make owner_id nullable so future ponds can exist without a single owner (M2M via user_pond_access).
ALTER TABLE ponds
    ALTER COLUMN owner_id DROP NOT NULL;

-- ---------- user_pond_access ----------

CREATE TABLE IF NOT EXISTS user_pond_access (
    user_id  UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    pond_id  INT  NOT NULL REFERENCES ponds(id)  ON DELETE CASCADE,
    PRIMARY KEY (user_id, pond_id)
);

CREATE INDEX IF NOT EXISTS idx_user_pond_access_user ON user_pond_access (user_id);
CREATE INDEX IF NOT EXISTS idx_user_pond_access_pond ON user_pond_access (pond_id);

-- Backfill from existing owner_id relations.
INSERT INTO user_pond_access (user_id, pond_id)
SELECT owner_id, id
  FROM ponds
 WHERE owner_id IS NOT NULL
ON CONFLICT DO NOTHING;
