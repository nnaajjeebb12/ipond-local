-- 011_status_logger_job.sql
-- DEPRECATED: status logging is now driven by the ingestion route
-- (src/app/api/send-sensor-data/route.ts). Every successful ESP32 POST
-- inserts a heartbeat row into pond_status_log with status='online'.
-- /api/utilization derives stale/offline minutes from gaps between rows.
--
-- This migration unschedules the previous TimescaleDB background job and
-- drops the procedure that produced 30-second snapshots.

DO $$
DECLARE j RECORD;
BEGIN
  FOR j IN
    SELECT job_id FROM timescaledb_information.jobs
     WHERE proc_name = 'record_pond_statuses'
  LOOP
    PERFORM delete_job(j.job_id);
  END LOOP;
END;
$$;

DROP PROCEDURE IF EXISTS record_pond_statuses(INT, JSONB);
