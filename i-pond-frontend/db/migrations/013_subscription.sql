-- 013_subscription.sql
-- Add subscription expiry to user accounts and notification flags.

ALTER TABLE owners
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE owners
    ADD COLUMN IF NOT EXISTS subscription_notified_30 BOOLEAN DEFAULT FALSE;

ALTER TABLE owners
    ADD COLUMN IF NOT EXISTS subscription_notified_7 BOOLEAN DEFAULT FALSE;

-- Default existing accounts to 5 years from creation so they don't get
-- locked out by the new expiry check.
UPDATE owners
   SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '5 years'
 WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_owners_expires_at ON owners (expires_at);
