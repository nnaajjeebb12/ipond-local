-- 012_optimal_value.sql
-- Add optional target/ideal value per pond × sensor.
-- Display-only: NOT used by alert logic.

ALTER TABLE pond_sensor_thresholds
    ADD COLUMN IF NOT EXISTS optimal_value FLOAT;

ALTER TABLE pond_sensor_thresholds_audit
    ADD COLUMN IF NOT EXISTS old_value FLOAT,
    ADD COLUMN IF NOT EXISTS new_value FLOAT;
