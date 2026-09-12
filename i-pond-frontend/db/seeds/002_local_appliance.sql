-- 002_local_appliance.sql
-- First-boot seed for a LOCAL APPLIANCE (Raspberry Pi).
--
-- Use this instead of 001_seed.sql. That file belongs to the old multi-tenant
-- cloud build: it assigns ponds to two tenant owners that it never creates, so
-- on a fresh database the pond INSERT dies on ponds_owner_id_fkey and you are
-- left with zero ponds — every ESP32 POST then fails with "unknown_pond".
--
-- The appliance has no users, no roles and no tenancy, so ponds are owned by
-- nobody (ponds.owner_id is nullable since migration 005) and there is exactly
-- one operator row, which exists only to satisfy the owners(id) foreign keys on
-- maintenance requests and audit rows.
--
-- Idempotent: safe to run more than once.
--
--   docker exec -i soletronix-timescaledb \
--     psql -U soletronix -d soletronix < db/seeds/002_local_appliance.sql

-- ---------- local operator ----------
-- UUID matches the fallback in src/lib/operator.ts.

INSERT INTO owners (id, name, email, role, password_hash)
VALUES ('00000000-0000-0000-0000-000000000001',
        'Local Operator', 'operator@localhost', 'admin', '')
ON CONFLICT (id) DO NOTHING;

-- ---------- ponds ----------
-- Ids 1..10 match the ESP32 `pnd` field; pond_code is PND-001..PND-010.
-- Rename them from the dashboard later — only the id must stay fixed.

INSERT INTO ponds (id, owner_id, name, location, capacity, area, pond_code)
SELECT n, NULL, 'Pond ' || n, 'Site', 12000, 250, 'PND-' || LPAD(n::text, 3, '0')
  FROM generate_series(1, 10) AS n
ON CONFLICT (id) DO NOTHING;

-- Keep the SERIAL in step so ponds added from the UI do not collide.
SELECT setval(
    pg_get_serial_sequence('ponds', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM ponds), 1)
);

-- ---------- default optimal ranges ----------
-- Migration 004 seeds these from the ponds table, but on a fresh install it
-- runs before any ponds exist and inserts nothing. Without rows here the charts
-- have no optimal band and the alert worker never fires.

INSERT INTO pond_sensor_thresholds (pond_id, sensor, optimal_min, optimal_max)
SELECT p.id, s.sensor, s.optimal_min, s.optimal_max
  FROM ponds p
  CROSS JOIN (VALUES
      ('temperature',     22.0, 27.0),
      ('ph',               6.5,  7.5),
      ('salinity',        15.0, 30.0),
      ('dissolved_oxygen', 5.0,  8.0)
  ) AS s(sensor, optimal_min, optimal_max)
ON CONFLICT (pond_id, sensor) DO NOTHING;

-- ---------- report ----------

SELECT 'owners=' || (SELECT COUNT(*) FROM owners)
    || ' ponds=' || (SELECT COUNT(*) FROM ponds)
    || ' thresholds=' || (SELECT COUNT(*) FROM pond_sensor_thresholds)
    AS seeded;
