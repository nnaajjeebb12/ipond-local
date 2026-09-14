#!/usr/bin/env bash
# Build the standalone bundle and put back the pieces `next build` leaves out.
#
#   cd ~/ipond-local/i-pond-frontend
#   ./scripts/deploy.sh            # build + copy + restart
#   ./scripts/deploy.sh --pull     # git pull --ff-only && npm install first
#
# `output: "standalone"` produces .next/standalone/server.js but does NOT copy
# public/ or .next/static/ into it — without them the app serves unstyled
# pages. server.js also chdirs into .next/standalone, so license.json and .env
# are copied there too (harmless if LICENSE_PATH / systemd EnvironmentFile are
# set, essential under PM2 where they are not).
#
# Restart: uses the systemd unit `ipond` if it exists, else the PM2 process
# `ipond-local`, else tells you to do it yourself.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--pull" ]; then
  git pull --ff-only
  npm install
fi

npm run build

rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static
[ -f .env ]          && cp .env          .next/standalone/.env
[ -f license.json ]  && cp license.json  .next/standalone/license.json

# Migrations are not applied automatically: 017 materializes the rollup over
# the whole table and must run by hand once. Say so rather than guess.
latest=$(ls db/migrations/[0-9][0-9][0-9]_*.sql | sort | tail -1)
latest_num=$(basename "$latest" | cut -d_ -f1)
echo
echo "Newest migration on disk: $latest"
echo "If the database has not seen it yet:  ./db/run_remaining.sh $latest_num"
echo

if systemctl list-unit-files ipond.service >/dev/null 2>&1 \
   && systemctl is-enabled ipond >/dev/null 2>&1; then
  sudo systemctl restart ipond
  echo "restarted systemd unit: ipond"
elif command -v pm2 >/dev/null 2>&1 && pm2 describe ipond-local >/dev/null 2>&1; then
  pm2 restart ipond-local --update-env
  echo "restarted pm2 process: ipond-local"
else
  echo "Build done. Restart the app yourself: node .next/standalone/server.js"
fi
