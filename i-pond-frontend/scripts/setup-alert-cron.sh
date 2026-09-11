#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/home/soletronix/logs"
CRON_CMD="*/5 * * * * cd $APP_DIR && npm run alert-worker >> $LOG_DIR/alert-worker.log 2>&1"

mkdir -p "$LOG_DIR"

# Remove existing alert-worker cron entry if present, then add fresh
(crontab -l 2>/dev/null | grep -v "alert-worker" || true; echo "$CRON_CMD") | crontab -

echo "Done. Cron job installed:"
echo "  $CRON_CMD"
echo "Logs: $LOG_DIR/alert-worker.log"
crontab -l | grep "alert-worker"
