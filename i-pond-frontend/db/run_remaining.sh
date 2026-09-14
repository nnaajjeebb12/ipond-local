#!/bin/bash
# Apply migrations by hand to an EXISTING database.
#
# On a fresh install this is unnecessary: docker-compose.yml mounts this folder
# as the init directory and Postgres runs every file on first start. Use this
# when new migration files arrive after the database already exists, or when
# the database was created without the mount.
#
#   cd i-pond-frontend
#   ./db/run_remaining.sh 015          # apply 015 and everything after
#   ./db/run_remaining.sh              # apply ALL (each file is idempotent)
#
# Reads POSTGRES_USER / POSTGRES_DB from ./.env so it matches docker-compose.yml.
#
# Lives in db/, NOT db/migrations/: that folder is mounted as the Postgres init
# directory, and the entrypoint executes every *.sh it finds there. With this
# script inside it, a fresh container ran the migrations, then ran this, which
# died on "no .env" and took first-boot initialisation down with it.
set -euo pipefail
cd "$(dirname "$0")/migrations"

ENV_FILE="../../.env"
[ -f "$ENV_FILE" ] || { echo "no .env at $ENV_FILE"; exit 1; }
DB_USER=$(grep '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2)
DB_NAME=$(grep '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2)
CONTAINER="${DB_CONTAINER:-ipond-timescaledb}"
FROM="${1:-000}"

for f in $(ls [0-9][0-9][0-9]_*.sql | sort); do
  num="${f%%_*}"
  [ "$num" -lt "$FROM" ] 2>/dev/null && continue
  echo "[$(date +%H:%M:%S)] START $f"
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$f"
  echo "[$(date +%H:%M:%S)] DONE  $f"
done
echo "ALL MIGRATIONS COMPLETE"
