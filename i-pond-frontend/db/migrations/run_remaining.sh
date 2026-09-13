#!/bin/bash
set -e
FILES="005_admin_management.sql 006_ingestion_logs.sql 007_alerts.sql 008_notifications.sql 009_pond_status_log.sql 010_alerts_retrigger.sql 011_status_logger_job.sql 012_optimal_value.sql 013_subscription.sql 014_connectivity_alerts.sql 015_drop_subscription.sql 016_sync.sql"

for f in $FILES; do
  echo "[$(date +%H:%M:%S)] START $f"
  docker exec -i ipond-timescaledb psql -U soletronix -d ipond -v ON_ERROR_STOP=1 -f - < "$f"
  echo "[$(date +%H:%M:%S)] DONE $f"
done
echo "ALL MIGRATIONS COMPLETE"
