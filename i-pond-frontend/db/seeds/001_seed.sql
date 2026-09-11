-- 001_seed.sql
-- Seed owners (with bcrypt password hashes via pgcrypto) + ponds.
-- Idempotent: re-running updates email/role/password to known values.
-- Pond IDs are explicit (1-10) to match ESP32 `pnd` field.

-- ---------- owners ----------
-- Production admin account. pgcrypto's bf hash is bcrypt-compatible with bcryptjs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO owners (id, name, email, role, password_hash) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Admin', 'admin@soletronix.com', 'admin',
     crypt('Soletronix@ipond2026', gen_salt('bf', 10)))
ON CONFLICT (email) DO UPDATE
    SET name          = EXCLUDED.name,
        role          = EXCLUDED.role,
        password_hash = EXCLUDED.password_hash;


-- ---------- ponds ----------
-- Ponds 1-5 -> Owner One, ponds 6-10 -> Owner Two.

INSERT INTO ponds (id, owner_id, name, location, capacity, area) VALUES
    (1,  '00000000-0000-0000-0000-000000000002', 'Pond 1',  'Site A - Block 1', 12000, 250),
    (2,  '00000000-0000-0000-0000-000000000002', 'Pond 2',  'Site A - Block 1', 12000, 250),
    (3,  '00000000-0000-0000-0000-000000000002', 'Pond 3',  'Site A - Block 2', 14000, 280),
    (4,  '00000000-0000-0000-0000-000000000002', 'Pond 4',  'Site A - Block 2', 14000, 280),
    (5,  '00000000-0000-0000-0000-000000000002', 'Pond 5',  'Site A - Block 3', 16000, 320),
    (6,  '00000000-0000-0000-0000-000000000003', 'Pond 6',  'Site B - Block 1', 12000, 250),
    (7,  '00000000-0000-0000-0000-000000000003', 'Pond 7',  'Site B - Block 1', 12000, 250),
    (8,  '00000000-0000-0000-0000-000000000003', 'Pond 8',  'Site B - Block 2', 14000, 280),
    (9,  '00000000-0000-0000-0000-000000000003', 'Pond 9',  'Site B - Block 2', 14000, 280),
    (10, '00000000-0000-0000-0000-000000000003', 'Pond 10', 'Site B - Block 3', 16000, 320)
ON CONFLICT (id) DO NOTHING;

SELECT setval(
    pg_get_serial_sequence('ponds', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM ponds), 1)
);

ALTER TABLE sensor_readings VALIDATE CONSTRAINT fk_sensor_readings_pond;
