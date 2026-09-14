# Soletronix iPond — IoT Aquaculture Monitoring System

## What is this?

Soletronix iPond is a real-time IoT monitoring platform for aquaculture ponds. ESP32 gateways stream temperature, pH, salinity, and dissolved oxygen readings into a TimescaleDB hypertable, which a Next.js dashboard visualizes through canvas-based uPlot charts, threshold-driven alerts, maintenance workflows, and PDF/CSV exports.

This repository is the **local appliance build**: a self-hosted Raspberry Pi that runs on-site, on the LAN, with no login and no user accounts. There is one operator, every view shows every pond, and access is gated by a signed license file rather than a password. Readings are pushed to the main server at `seeme-db.com` by a sync worker whenever the Pi has internet.

## Tech Stack

- **Frontend** — Next.js 16 (App Router), React 19, Tailwind CSS 4, next-themes (light/dark)
- **Charts** — uPlot (canvas-based, replaces Recharts)
- **State / Data** — SWR (polling and revalidation), react-hook-form (forms)
- **Access control** — none. A signed RSA license file (`src/lib/license.ts`) gates the whole app
- **Database** — PostgreSQL 16 + TimescaleDB (hypertable on `sensor_readings`), `pg` (node-postgres)
- **Export** — jsPDF + jspdf-autotable (PDF), native CSV
- **HTTP / Time** — axios, moment
- **Hardware** — ESP32 gateway (`esp32_iotgateway_new_soletronix_Serial/esp32_iotgateway_new_soletronix_Serial.ino`), **wired by USB** — no Wi-Fi. `scripts/serial-listener.js` forwards its serial output into the ingest route
- **Deployment** — Next.js `output: "standalone"` behind nginx, systemd-managed

## Quick Start

1. **Install dependencies**
   ```bash
   npm install --legacy-peer-deps
   ```
2. **Start the database**
   ```bash
   docker compose up -d
   ```
   TimescaleDB picks up migrations from `db/migrations/` on first run.
3. **Configure environment** — see the table below and create `.env` at the project root.
4. **Add a license** — the app will not render without a valid `license.json`.
   See [Raspberry Pi Deployment](#raspberry-pi-deployment) for `LICENSE_PATH`.
5. **Run the dev server**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000. There is no login — the dashboard loads directly.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (e.g. `postgres://user:pass@localhost:5432/ipond`). |
| `POSTGRES_USER` | Yes | Database superuser, consumed by `docker-compose.yml`. |
| `POSTGRES_PASSWORD` | Yes | Database password, consumed by `docker-compose.yml`. |
| `POSTGRES_DB` | Yes | Database name, consumed by `docker-compose.yml`. |
| `API_TOKEN` | Yes | Bearer token for `POST /api/send-sensor-data`. The USB serial listener supplies it; the gateway no longer needs it. |
| `SERIAL_PORT` | Yes | The gateway's serial device. Use the stable `/dev/serial/by-id/...` path, not `/dev/ttyUSB0`. `-` reads stdin (testing). |
| `SYNC_OWNER_ID` | Yes (to sync) | This site's owner UUID on the main server. The worker refuses to run without it. |
| `DB_DATA_PATH` | No | Bind-mount path for database files (default `./data/timescaledb`). Put it on an external drive on the Pi. |
| `SYNC_TOKEN` | No | Bearer token for cloud sync. **Must differ from `API_TOKEN`.** Required on the local Pi to sync, and on the main server to accept syncs. Without it the dashboard shows "Cloud sync not configured". |
| `MAIN_SERVER_URL` | No | Base URL of the main server the sync worker ships to (default `https://seeme-db.com`). Local Pi only. |
| `SYNC_LOG_PATH` | No | Sync worker log file (default `~/logs/sync-worker.log`). |
| `LICENSE_PATH` | No | Absolute path to this appliance's signed `license.json`. **Set this on the Pi** — see the deployment note about `output: "standalone"` below. Falls back to `/license.json` then `<cwd>/license.json`. |
| `APP_TIMEZONE` | No | IANA timezone used for "Today" buckets in `/api/readings` (default `UTC`). |
| `NEXT_PUBLIC_APP_TIMEZONE` | No | Same value, readable in the browser. Keep in step with `APP_TIMEZONE`. |
| `TZ` | No | Process timezone for Node and cron. Set to the same zone. |
| `NODE_ENV` | No | `development` or `production`. |

## Cloud Sync (local Pi → main server)

Each local appliance keeps its own TimescaleDB and pushes readings up to the main
server when it has internet. Rows are marked `synced_at` only after the server
confirms them, so a dropped connection re-sends rather than loses data — the
receiver de-duplicates on `(pond_id, time)`, making re-sends no-ops.

**One-time setup on the Pi**

1. Apply the migration:
   ```bash
   docker exec -i ipond-timescaledb psql -U soletronix -d ipond \
     < db/migrations/016_sync.sql
   ```
2. Add `SYNC_TOKEN` (and `MAIN_SERVER_URL` if not `https://seeme-db.com`) to `.env`.
   The same `SYNC_TOKEN` must be set on the main server.
3. Create the log directory:
   ```bash
   mkdir -p ~/logs
   ```

**Run it once by hand**

```bash
npm run sync-worker
```

**Schedule it every 5 minutes**

```bash
crontab -e
```

```cron
*/5 * * * * cd ~/ipond-local && npm run sync-worker >> ~/logs/sync-worker.log 2>&1
```

The worker writes its own detailed log to `~/logs/sync-worker.log`; the cron
redirect above adds the one-line summary and any crash output to the same file.
It always exits `0` — "no internet" is a normal outcome, not a failure — so cron
will not mail you about a Pi that is simply offline.

**From the dashboard**

The sidebar footer shows `Last synced: X mins ago`, the pending backlog, and a
**Sync to Cloud** button that runs the same routine inline. It reports
`Not synced — no internet` when offline and `Cloud server unreachable` when the
internet is up but the main server is not answering.

**On the main server**

`POST /api/sync` receives the batches. It needs the same migration applied and
`SYNC_TOKEN` set. Each run ships at most 10,000 readings (20 batches of 500) so a
large backlog cannot overrun the cron slot; the next run picks up where it left off.

## Raspberry Pi Deployment

> **Deploying to a new Pi?** Follow
> **[docs/Pi-Deployment-Checklist.md](docs/Pi-Deployment-Checklist.md)** — a
> step-by-step checklist written for someone with no Linux experience. The
> section below is the condensed reference for people who have done it before.

The appliance is self-hosted — there is no Vercel, no serverless runtime, and no
outbound dependency at boot. `next.config.ts` sets `output: "standalone"`, which
emits a self-contained server at `.next/standalone/server.js` carrying only the
traced runtime dependencies.

### Three things standalone changes

Read these before deploying; each one silently breaks a naive deploy.

1. **`npm start` is not how you run it.** The entry point is
   `node .next/standalone/server.js`.
2. **Static assets are not included.** Next does not copy `public/` or
   `.next/static/` into the bundle. Without this step the app serves HTML with
   no CSS, no fonts and no favicon:
   ```bash
   cp -r public .next/standalone/
   cp -r .next/static .next/standalone/.next/
   ```
3. **`server.js` chdirs to its own directory.** `process.cwd()` becomes
   `.next/standalone`, so relative lookups do not resolve against the project
   root. This is why `LICENSE_PATH` must be an **absolute** path — otherwise the
   license is reported `missing` and the app shows the full-screen expired page.
   For the same reason the build copies `.env` into `.next/standalone/.env`, so
   **editing the project `.env` after a build has no effect on the running
   server**. Pass configuration through systemd instead (below): real process
   environment variables take precedence over the bundled file.

### First-time setup

```bash
sudo apt update && sudo apt install -y nodejs npm nginx
git clone <repo> /home/pi/ipond-local
cd /home/pi/ipond-local
npm install
cp .env.example .env && nano .env        # fill in tokens, timezone, LICENSE_PATH
docker compose up -d                      # TimescaleDB; runs db/migrations on first boot
mkdir -p /home/pi/logs

# Seed ponds 1-10 + default thresholds. The migrations create empty tables only,
# so without this every ESP32 POST is rejected with "unknown_pond".
# Use 002_local_appliance.sql — 001_seed.sql is the old multi-tenant seed and
# fails on a fresh DB with a ponds_owner_id_fkey error, leaving zero ponds.
docker exec -i ipond-timescaledb   psql -U soletronix -d ipond < db/seeds/002_local_appliance.sql
```

Place the signed `license.json` at the path you set in `LICENSE_PATH`
(`/home/pi/ipond-local/license.json` by default). Each appliance needs its own,
signed for that Pi's `/proc/cpuinfo` serial.

### Build and run

```bash
npm run build
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
node .next/standalone/server.js          # listens on :3000
```

### systemd service

`/etc/systemd/system/ipond.service` — `EnvironmentFile` is what makes `.env`
edits take effect without a rebuild:

```ini
[Unit]
Description=Soletronix iPond (local appliance)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/ipond-local
EnvironmentFile=/home/pi/ipond-local/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /home/pi/ipond-local/.next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ipond
sudo systemctl status ipond
journalctl -u ipond -f
```

### nginx

`/etc/nginx/sites-available/ipond` — puts the dashboard on port 80 for the LAN
and keeps the ESP32 ingest path on the same origin:

```nginx
server {
    listen 80;
    server_name _;
    client_max_body_size 2m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ipond /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Serial listener (systemd)

The gateway is wired by USB. `scripts/serial-listener.js` reads its JSON lines
and POSTs them to the local ingest route; it exits on port close so
`Restart=always` re-opens the port when the cable comes back. Unit file and
`dialout` group setup are in the checklist, §11.

### Cron

```cron
*/5 * * * * cd /home/pi/ipond-local/i-pond-frontend && npm run alert-worker >> /home/pi/logs/alert-worker.log 2>&1
*/5 * * * * cd /home/pi/ipond-local/i-pond-frontend && npm run sync-worker  >> /home/pi/logs/sync-worker.log 2>&1
```

### Redeploying

```bash
cd /home/pi/ipond-local/i-pond-frontend
./scripts/deploy.sh --pull        # git pull, npm install, build, copy assets, restart
```

The script restarts whichever runner exists — the systemd unit `ipond`, or the
PM2 process `ipond-local` — and prints the newest migration number. Apply
migrations **before** running it:

```bash
./db/run_remaining.sh 017        # from 017 onward; each file is idempotent
```

If `docker-compose.yml` changed (Postgres tuning lives in its `command:` block),
recreate the container too — the data is a bind mount and is untouched:

```bash
docker compose up -d
```

### Adding ponds and the cloud owner

- **Add a pond** from the dashboard ("+ Add Pond"). It gets the next free
  `PND-###` code; set the gateway to post that number (`PND-011` → `pnd: 11`),
  and create the same code under this site's account on the main server (see
  below) — until then its readings wait on the Pi.
- **Settings → Appliance → Cloud owner: sign in with the site's seeme-db.com
  account.** The Pi performs the main server's own login (its existing
  NextAuth routes), learns the account's id and name — that becomes the cloud
  owner, no UUID to remember — and imports the account's ponds from
  `/api/ponds`. Ponds in both places take the main server's record; ponds
  only on the Pi are listed so someone creates them on the main server. Needs
  internet; the password is used once and never stored. Viewer accounts are
  refused (they cannot own ponds); admin accounts set the owner but import
  nothing (admins see every site's ponds).
  Offline fallback: local admin login (`soletronix` / `Soletronix@pi2026`) and
  type the owner name + UUID; saved unverified — a wrong ID stops sync with
  "pond not found under this owner", nothing is lost. Either way the value
  lives in the database; `SYNC_OWNER_ID` in `.env` is only an optional seed.
- **The main server is never changed.** It has no API for creating ponds or
  reading owners with a token, so a pond added on the Pi must also exist on the
  main server before its readings will sync — and it must carry the site's
  owner: the receiver matches `ponds.owner_id`, which the main server's admin
  console does **not** set. Per pond, on the main server's database:

  ```sql
  UPDATE ponds SET owner_id = '<site owner UUID>' WHERE pond_code = 'PND-011';
  ```

  Until then that pond's readings wait on the Pi (the sidebar names the pond);
  every other pond keeps syncing. The main server also needs a unique index on
  `sensor_readings (pond_id, time)` — without it every batch fails with
  "Main server returned 500".

### Database performance notes

The gateway posts a reading every few seconds, so `sensor_readings` grows by
tens of thousands of rows per pond per day. Three things keep the dashboard fast
on a Pi:

- **`sensor_readings_15m`** (migration 017) — a TimescaleDB continuous
  aggregate. Every chart reads this 15-minute rollup, not raw rows. It refreshes
  itself every 5 minutes and the current bucket is computed live.
- **Compression** (migration 018) — chunks older than 30 days are compressed
  10–20x. Nothing is deleted.
- **`docker-compose.yml` tuning** — the image's first-boot `timescaledb-tune`
  step is hidden by our migrations mount (same directory), so without the
  `command:` block it runs stock defaults: 128 MB `shared_buffers` and an fsync
  on every commit.
  The `command:` block sets sane values for an 8 GB Pi on USB flash, including
  `synchronous_commit=off` (a power cut can lose the last ~0.6 s of readings).

`docker logs ipond-timescaledb | grep checkpoint` shows checkpoint timing.
Note that `write=` is the *paced* duration (Postgres deliberately spreads a
checkpoint over 90 % of `checkpoint_timeout`); `sync=` is the number that
reflects disk latency.

### Checks

```bash
curl localhost:3000/api/health        # {"status":"ok","db":"connected",...}
curl localhost:3000/api/license       # {"valid":true,...}
curl localhost:3000/api/sync/status   # {"pendingCount":N,"online":true,...}
```

Never expose port 5432. The Pi serves the LAN only; the cloud link is outbound.

## Project Structure

```
i-pond-frontend/
├── db/
│   └── migrations/          # Numbered SQL (001 → 016), idempotent
├── docs/                    # User, Admin, Full, Technical, Database guides (.md + .docx)
├── docker-compose.yml       # TimescaleDB service
├── esp32_iotgateway.ino     # ESP32 firmware (do not modify from app side)
├── scripts/                 # Simulators, seed scripts, docx generators
├── src/
│   ├── app/                 # Next.js App Router pages + API routes
│   │   ├── api/             # Route handlers (readings, sync, license, etc.)
│   │   ├── admin/logs/      # Ingestion logs (kept for local debugging)
│   │   ├── dashboard/       # All-ponds, per-pond, per-sensor views
│   │   ├── notifications/   # Sensor alerts
│   │   ├── reports/         # PDF / CSV export center
│   │   ├── settings/        # Threshold configuration
│   │   └── utilization/     # Uptime utilization
│   ├── components/          # SensorCard, AlertPopup, SyncStatus, charts/, MainLayout
│   ├── hooks/               # useApi, useAlerts, useThresholds, useDashboardStats, useSystemHealth
│   └── lib/                 # db pool, license, sync, operator, alert checker, pondStatus
└── public/
```

## Documentation

Each guide is available in two formats: a GitHub-friendly Markdown version (renders inline) and a polished `.docx` version (for printing and offline reading).

| Guide | Audience | Markdown | Word |
|---|---|---|---|
| User Guide | Pond owners and viewers | [docs/User-Guide.md](docs/User-Guide.md) | [docs/User-Guide.docx](docs/User-Guide.docx) |
| Admin Guide | System administrators | [docs/Admin-Guide.md](docs/Admin-Guide.md) | [docs/Admin-Guide.docx](docs/Admin-Guide.docx) |
| Full Documentation | End-to-end system reference | [docs/Full-Documentation.md](docs/Full-Documentation.md) | [docs/Full-Documentation.docx](docs/Full-Documentation.docx) |
| Technical Documentation | Developer handover | [docs/Technical-Documentation.md](docs/Technical-Documentation.md) | [docs/Technical-Documentation.docx](docs/Technical-Documentation.docx) |
| Database Documentation | Schema, queries, backup | [docs/Database-Documentation.md](docs/Database-Documentation.md) | [docs/Database-Documentation.docx](docs/Database-Documentation.docx) |
