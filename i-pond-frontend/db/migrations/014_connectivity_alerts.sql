-- 014_connectivity_alerts.sql
-- Allow 'connectivity' as a sensor in sensor_alerts so we can raise
-- alarms when a pond stops sending data for 20+ minutes.

ALTER TABLE sensor_alerts DROP CONSTRAINT IF EXISTS sensor_alerts_sensor_check;

ALTER TABLE sensor_alerts
    ADD CONSTRAINT sensor_alerts_sensor_check
    CHECK (sensor IN ('temperature','ph','salinity','dissolved_oxygen','connectivity'));
