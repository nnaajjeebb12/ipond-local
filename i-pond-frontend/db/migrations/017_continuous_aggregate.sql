-- 017_continuous_aggregate.sql
-- Pre-aggregated 15-minute rollups of sensor_readings, plus retention for the
-- two log tables that grow with every reading.
--
-- WHY: the USB gateway delivers a reading every few seconds, not every 15
-- minutes as the original schema assumed. Every chart on the dashboard
-- (4 sensors x 2 view modes, polled every 10 s) was a GROUP BY over every raw
-- row in its range — ~400 ms per query on a desktop with three days of data,
-- several seconds on a Pi 4, and growing daily. The rollup makes those
-- queries touch ~100 rows per pond per day instead of ~86,000.
--
-- Every bucket stores SUM + COUNT (not AVG) per sensor so the API can re-bucket
-- into 1 h / 3 h / 6 h / 1 day with an exact weighted average.
--
-- materialized_only = false ("real-time aggregation"): rows newer than the last
-- refresh are computed from raw on the fly, so the current bucket is always
-- live. If the background refresh job ever stops, results stay correct — only
-- slower.
--
-- NOTE: CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous) and CALL
-- refresh_continuous_aggregate cannot run inside a transaction block. psql -f
-- (which both docker-entrypoint-initdb.d and run_remaining.sh use) runs each
-- statement in its own transaction, so this file works there. Do NOT wrap it
-- in BEGIN/COMMIT or run it with psql -1.

CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_readings_15m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '15 minutes', time) AS bucket,
    pond_id,
    COUNT(*)                  AS n,
    SUM(temperature)          AS temperature_sum,
    COUNT(temperature)        AS temperature_cnt,
    MIN(temperature)          AS temperature_min,
    MAX(temperature)          AS temperature_max,
    SUM(ph)                   AS ph_sum,
    COUNT(ph)                 AS ph_cnt,
    MIN(ph)                   AS ph_min,
    MAX(ph)                   AS ph_max,
    SUM(salinity)             AS salinity_sum,
    COUNT(salinity)           AS salinity_cnt,
    MIN(salinity)             AS salinity_min,
    MAX(salinity)             AS salinity_max,
    SUM(dissolved_oxygen)     AS dissolved_oxygen_sum,
    COUNT(dissolved_oxygen)   AS dissolved_oxygen_cnt,
    MIN(dissolved_oxygen)     AS dissolved_oxygen_min,
    MAX(dissolved_oxygen)     AS dissolved_oxygen_max
FROM sensor_readings
GROUP BY bucket, pond_id
WITH NO DATA;

-- Materialize everything that already exists. On a fresh install this is a
-- no-op. On a Pi with months of data it is one pass over the table.
CALL refresh_continuous_aggregate('sensor_readings_15m', NULL, NULL);

-- Keep it current: every 5 minutes, re-materialize the last 3 days (covers
-- late/backfilled rows) up to 15 minutes ago. Newer than that is real-time.
SELECT add_continuous_aggregate_policy(
    'sensor_readings_15m',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists     => TRUE
);

-- ---------------------------------------------------------------------------
-- Retention for the per-reading log tables. These are plain tables (not
-- hypertables), so add_retention_policy does not apply; a scheduled procedure
-- deletes old rows once a day instead.
--
--   ingestion_logs   30 days  — debugging window for /admin/logs
--   pond_status_log 120 days  — /utilization allows a 90-day range and needs
--                               the heartbeat just before the window
--
-- sensor_readings is NEVER pruned here. It is the record; cloud sync depends
-- on it. Disk growth is handled by compression (018), not deletion.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE ipond_prune_logs(job_id INT, config JSONB)
LANGUAGE plpgsql AS $$
DECLARE
    ingest_days INT := COALESCE((config ->> 'ingestion_log_days')::INT, 30);
    status_days INT := COALESCE((config ->> 'status_log_days')::INT, 120);
BEGIN
    DELETE FROM ingestion_logs
     WHERE received_at < NOW() - make_interval(days => ingest_days);
    DELETE FROM pond_status_log
     WHERE recorded_at < NOW() - make_interval(days => status_days);
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
         WHERE proc_name = 'ipond_prune_logs'
    ) THEN
        PERFORM add_job(
            'ipond_prune_logs',
            INTERVAL '1 day',
            config => '{"ingestion_log_days": 30, "status_log_days": 120}'::jsonb
        );
    END IF;
END;
$$;
