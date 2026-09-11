-- 015_drop_subscription.sql
-- Remove the in-app subscription/expiry system.
--
-- Superseded by the signed license file (src/lib/license.ts), which gates the
-- whole app at the root layout. Nothing in the application has read these
-- columns since auth was removed, so dropping them is safe.
--
-- Migration 013 is left in place: history is append-only, and a fresh install
-- simply adds these columns and then drops them again.

DROP INDEX IF EXISTS idx_owners_expires_at;

ALTER TABLE owners
    DROP COLUMN IF EXISTS expires_at;

ALTER TABLE owners
    DROP COLUMN IF EXISTS subscription_notified_30;

ALTER TABLE owners
    DROP COLUMN IF EXISTS subscription_notified_7;
