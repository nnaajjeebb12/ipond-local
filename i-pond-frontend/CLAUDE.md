# CLAUDE.md

---

# CLAUDE CODE RULES - SOLETRONIX LMS

## CRITICAL BEHAVIOR

- ALWAYS ANSWER IN CAVEMAN STYLE. Short. Grunt words. 3-6 words max. No filler.
- ALWAYS PLAN FIRST. Make TODO list.
- CODE AFTER PLAN. 100% code blocks.
- ONLY CODE, PLAN, TODO, CAVEMAN GRUNTS. No explanations.
- AFTER EVERY CHANGE: update CLAUDE.md to reflect what changed.
- AFTER EVERY CHANGE: append an entry to CHANGELOG.md in this format:

```markdown
## [DATE] — [Short title]
### Changed
- What changed and why
### Files Modified
- src/app/...
- db/migrations/...
### Notes
- Any important notes, caveats, or follow-up needed
```

Create CHANGELOG.md if it does not exist. Never skip this step.

## RESPONSE FORMAT

1. PLAN. Short steps.
2. TODO LIST. Bullet tasks.
3. Full working code files.
4. Caveman grunt: "PLAN. TODO. CODE. DONE."

---

## Project Overview

IoT aquaculture monitoring system. Nationwide PH deployment. 5-year license.

- ESP32 sensors → TimescaleDB (PostgreSQL) → Next.js dashboard with real-time charts.
- **Local appliance build**: no login, no user accounts, no roles, no tenant scoping. Access is gated by a signed license file only.
- Single-site: every query returns **all ponds**, always. Alerts, maintenance, utilization tracking.
- **Live**: https://seeme-db.com
- **GitHub**: private repo

## Commands

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run start` — serve build
- `npm run lint` — eslint
- `npm run seed:pond1` — seed today's data for pond 1
- `node --experimental-strip-types scripts/simulate-esp32.ts` — fake ESP32 ingest
- `node --experimental-strip-types scripts/seed-utilization.ts` — seed status logs
- `node --experimental-strip-types scripts/generate-token.ts` — issue API_TOKEN
- `node --experimental-strip-types scripts/alert-worker.ts` — run alert worker once
- `npm run license:generate -- --client "Name" --serial <piSerial|ANY> --days 1825` — sign a license
- `npm run sync-worker` — push unsynced readings to the main server, once
- `npm run serial-listener` — forward the USB gateway's readings into the app (runs forever; `SERIAL_PORT=-` reads stdin for testing)
- `docker compose up -d` — start TimescaleDB

No test suite. Verify changes via dev server + browser.

## Stack

- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4
- **Charts**: **uPlot** (canvas-based) — NOT Recharts, never use Recharts again
- **State**: SWR (data fetching, polling). Zustand still a dep, no longer used for auth
- **Forms**: react-hook-form
- **Theme**: next-themes (light / dark)
- **PDF/CSV export**: jsPDF + jspdf-autotable
- **Auth**: NONE — NextAuth removed. `src/lib/license.ts` (RSA-SHA256 signed license) is the only gate
- **DB driver**: `pg` (node-postgres), raw queries, connection pool `max: 5`
- **HTTP**: axios
- **Time**: moment
- **Database**: TimescaleDB pg16 (Docker, `docker-compose.yml`)
- **Migrations**: 16 files in `/db/migrations/` (001 → 016)
- **Deploy**: Next.js `output: "standalone"` + systemd + Nginx + Docker (no Vercel — `vercel.json` deleted)
- **ESP32 (current)**: `esp32_iotgateway_new_soletronix_Serial/esp32_iotgateway_new_soletronix_Serial.ino` — **USB-wired, no Wi-Fi, no HTTP, no SD**. The RECEIVE path (Serial2 read, trim, `{}` extract, `length > 10`, `deserializeJson(jsonDoc, val)`, LCD layout, the 5 s LCD hold, `rtc.read()`) is copied verbatim from `esp32_iotgateway_old_code_working.ino` — do not "tidy" it, the sensor board timing depends on it. Only the SEND changed: `sendToPi()` prints one `{"data":{...}}` JSON line over USB serial at 9600 baud. `scripts/serial-listener.js` on the Pi forwards each line to `POST /api/send-sensor-data`. **Never `Serial.println` raw input** — anything starting with `{` on USB is treated as a reading. Lives in its own folder because the Arduino IDE requires sketch dir = sketch name. Compiles clean on ArduinoJson 7 (`JsonDocument`); the `LiquidCrystal_I2C` architecture warning is benign.
- **ESP32 (reference)**: `esp32_iotgateway_old_code_working.ino` — the last known-good Wi-Fi/SD build. Untouched; it is the source of truth for the receive path.
- **ESP32 (deprecated)**: `esp32_iotgateway_new_soletronix.ino.DEPRECATED_NO_WIFI` — the old Wi-Fi/HTTP/SD-backlog variant, kept for reference only
- **SD diagnostic**: `sd_card_test.ino` — standalone SD test (SD.h/SPI, CS GPIO5, 9600 baud). Tests in `runTests()`; type `run` in Serial Monitor (Newline ending) to re-run without reset

## Architecture

```
ESP32 gateway (15min interval, USB cable, 9600 baud)
  → scripts/serial-listener.js  (systemd: ipond-serial)
  → POST http://localhost:3000/api/send-sensor-data  (Bearer API_TOKEN)
  → TimescaleDB :5432 (127.0.0.1 only)

Cloudflare Tunnel (HTTP only — no TCP)
  seeme-db.com      → HTTP:80
  ssh.seeme-db.com  → SSH:22

Background cron every 5min
  → scripts/alert-worker.ts
  → checks sensor + connectivity alerts

Local appliance, cron every 5min
  → scripts/sync-worker.ts
  → POST $MAIN_SERVER_URL/api/sync  (Bearer SYNC_TOKEN)
  → ponds identified by (SYNC_OWNER_ID, pond_code), never local pond_id
  → marks sensor_readings.synced_at only for rows the server resolved
```

## Cloud Sync

- `src/lib/sync.ts` — the one implementation. No Next.js or `@/lib/db` imports, so both the tsx worker (own pool) and `POST /api/sync/trigger` (app pool) call the same `runSync(pool, log)`.
- **Timestamps are carried as full-precision ISO strings, never through a JS `Date`.** Postgres stores microseconds, `Date` holds milliseconds; round-tripping truncates and then no row ever matches again. `fetchBatch` uses `to_char(... 'US')`, and the receiver passes the original string straight to `::timestamptz`.
- Rows are marked `synced_at` **only after the server confirms them** — a crash re-sends, and `ON CONFLICT (pond_id, time) DO NOTHING` makes the re-send a no-op.
- Ceiling of `MAX_BATCHES` × `BATCH_SIZE` = 10,000 readings per run so a backlog cannot overrun the 5-min cron slot.
- `SYNC_TOKEN` is deliberately **not** `API_TOKEN`: a compromised ESP32 must not be able to bulk-write history, and a leaked sync token must not be able to pose as a sensor.
- Target host env var is `MAIN_SERVER_URL` (default `https://seeme-db.com`).
- The worker always **exits 0** — "no internet" is a normal outcome. Never call `process.exit()` straight after a failed fetch: it lands on a closing handle and aborts with a libuv assertion (exit 127) even on success.
- `fetchBatch` INNER JOINs `ponds` and requires `pond_code IS NOT NULL`. A reading whose pond has no code is **left pending and counted** (`countUnsyncable`, shown in the sidebar as "cannot sync — pond has no code") instead of being sent — one such row would 400 the whole batch at the receiver and, because batches are time-ordered, wedge sync on that batch forever.
- **On the wire a pond is `(owner_id, pond_code)`, never the local `pond_id`.** Every appliance numbers ponds 1..10 / PND-001..010; the multi-tenant cloud needs `SYNC_OWNER_ID` to tell sites apart. The worker refuses to run without it.
- The receiver answers `{ ok, inserted, duplicate, unknown, skipped, received }`. `duplicate` = already there (safe to mark). `unknown` = no pond for that `(owner, code)` on the server (**NOT** there). **The worker marks nothing and returns `pond_mismatch` when `unknown > 0`** — marking would silently lose those readings forever. A receiver that omits `unknown` gets the old behaviour plus a loud log line.
- The production receiver on seeme-db.com lives in its own repo; `src/app/api/sync/route.ts` here is the reference implementation of the same contract so the two sides cannot drift apart again.

## Sensors (CRITICAL)

- ONLY: `temperature`, `ph`, `salinity`, `dissolved_oxygen`
- **NO humidity** — never add it. ESP32 does not have it.
- ESP32 field names: `rtd`=temperature, `sal`=salinity, `dox`=dissolved_oxygen, `pnd`=pond number, `ph`=ph

### ESP32 Payload Shape

```json
{ "data": { "pnd": 1, "rtd": 28.5, "ph": 7.2, "sal": 15.0, "dox": 6.8 } }
```

- `pnd` 1..10 → `PND-001`..`PND-010`

## Database Tables

- `sensor_readings` — hypertable, partitioned by `time` (TIMESTAMPTZ). Columns: `pond_id`, `temperature`, `ph`, `salinity`, `dissolved_oxygen`, `synced_at`, `source` (016). **No `id` column** — a row is identified by `(pond_id, time)`, which migration 016 made UNIQUE. Compressed after 30 days (018, `segmentby pond_id`); rows in compressed chunks can still be read, upserted and updated (the sync worker's `synced_at` mark works there, just slower). **Never pruned.**
- `sensor_readings_15m` — **continuous aggregate** (017) over `sensor_readings`: per pond per 15-minute bucket, `n` plus `<sensor>_sum / _cnt / _min / _max` for each of the four sensors. Real-time aggregation is on (`materialized_only = false`), so the bucket still filling is computed from raw rows. Refresh policy every 5 min. **Every chart query reads this, never raw** — see `@/lib/rollup` for the SQL fragments and the anomaly-count semantics. The one exception is Today for a single pond, which is 1-minute averages straight from raw (fine: one pond, one day, index scan).
- `owners` — retained for FK targets only (`getOperatorId()` reads the first row). No login, no roles enforced. Subscription columns dropped in migration 015.
- `ponds` — pond metadata, `pond_code` `PND-001`..`PND-010`, `name`. **Fresh installs must seed `db/seeds/002_local_appliance.sql`** — migrations create empty tables, and the old `001_seed.sql` dies on `ponds_owner_id_fkey` (it references two tenant owners it never creates), leaving zero ponds and every ingest failing `unknown_pond`.
- `user_pond_access` — **dead table**. Still in the schema, never read or written by the app.
- `pond_sensor_thresholds` — per-pond optimal range per sensor: `optimal_min`, `optimal_max`, `optimal_value` (target, display-only, migration 012).
- `pond_sensor_thresholds_audit` — threshold change history: `old_value`, `new_value`.
- `ingestion_logs` — every ESP32 POST (success + error). Pruned after 30 days by the `ipond_prune_logs` TimescaleDB job (017).
- `sensor_alerts` — out-of-range alert events. `sensor` allows `temperature/ph/salinity/dissolved_oxygen/connectivity` (migration 014). Fields: `triggered_at`, `consecutive_count`, `last_value`, `optimal_min`, `optimal_max`, `acknowledged_at`, `resolved_at`.
- `pond_status_log` — heartbeat rows written by ingest (`status='online'`), **at most one per pond per 60 s** — the gateway posts every few seconds and /utilization's finest distinction is a 20-minute gap, so per-reading rows were 60x the writes for no information. Utilization derives stale/offline from row gaps. Pruned after 120 days (017).
- `maintenance_requests` — owner → admin maintenance tickets.
- (notifications wiring via migration 008.)

## Licensing (replaces auth)

- `src/lib/license.ts` — verifies `/license.json`, offline, RSA-SHA256.
- Public key **embedded in code** (`SOLETRONIX_PUBLIC_KEY`). Private key lives in `keys/soletronix_private.pem`, gitignored, never ships.
- Signed fields: `licenseId`, `client`, `piSerial`, `issuedAt`, `expiresAt`. Canonical form = key-sorted JSON of those five, no whitespace. `signature` is base64.
- Lookup order: `$LICENSE_PATH` → `/license.json` → `<cwd>/license.json`.
- `piSerial` must equal the `Serial` line in `/proc/cpuinfo`. `"ANY"` is a signed wildcard for dev / VM / x86.
- Exports: `isLicenseValid()`, `getLicenseInfo()`, `getDaysUntilExpiry()`, `resetLicenseCache()`.
- File read + signature + serial cached per process; **expiry re-checked on every call** so a running server locks itself out on the day.
- Fail-closed reasons: `missing`, `malformed`, `bad_signature`, `serial_mismatch`, `expired`.
- Gate lives in `src/app/layout.tsx` (server component, `dynamic = 'force-dynamic'`). Invalid → `<LicenseExpired>` full screen, app tree never renders. No bypass.
- `<LicenseBanner>` in `MainLayout`: amber ≤30 days, red ≤7 days, dismissible, driven by `/api/license`.
- Expiry lives **only** here. There is no per-account subscription: migration 015 dropped `owners.expires_at`, `subscription_notified_30` and `subscription_notified_7`.

## Roles & Tenancy — GONE

- No roles anywhere. No `session`, no `auth()`, no `requireAdmin()`. Every endpoint is open.
- No tenant scoping. `user_pond_access` is **never queried**; every route returns all ponds.
- `src/lib/operator.ts` → `getOperatorId()` is the only remnant: the first `owners` row by `created_at`, cached per process. **Self-healing**: if `owners` is empty it INSERTs the seed's operator row (`00000000-0000-0000-0000-000000000001`) on first use. Before this, a Pi that skipped the seed got a **500 on every acknowledge / maintenance / threshold write** (`acknowledged_by` FK to a non-existent row) and the UI showed nothing. It is **identity for record-keeping only, not authorization** — it exists because `maintenance_requests.requested_by` is NOT NULL and the alert/threshold audit columns are FKs to `owners(id)`.
- Where a route used to answer 403 for a pond outside the caller's access, it now answers **404 if the pond does not exist** and serves it otherwise.

## Pages

All pages are open — no session, no role gate. The license gate wraps them all.

- `/` — server redirect to `/dashboard`
- `/dashboard` — all-ponds overview
- `/dashboard/[pondId]` — per-pond detail
- `/dashboard/[pondId]/[sensorType]` — single sensor deep-dive
- `/reports` — export center PDF / CSV
- `/utilization` — utilization rate
- `/admin/logs` — ingestion logs (kept for local debugging; pond filter reads `/api/ponds`)
- `/notifications` — maintenance + alerts
- `/settings/thresholds` — optimal range config

## API Routes

### Ingestion (Bearer token, no session)
- `POST /api/send-sensor-data` — ESP32 ingest. Writes `sensor_readings` + `ingestion_logs` + `pond_status_log` heartbeat. Server stamps `time = NOW()`.

### License
- `GET /api/license` — `{ valid, client, expiresAt, daysLeft, reason }` (public)

### Health
- `GET /api/health` — DB connectivity + total readings (public)
- `GET /api/system/status` — server online/offline probe (public)

### Dashboard data (open)
- `GET /api/ponds` — all ponds
- `GET /api/ponds/status` — live status per pond (logs snapshot, via `getPondStatus()`)
- `GET /api/dashboard/stats` — system health summary across all ponds
- `GET /api/readings` — aggregated time-series (today/7d/14d/30d/1y)
- `GET /api/readings/latest?pond=N` — latest reading per pond
- `GET /api/readings/raw?sensor=X&pond=N` — raw points
- `GET /api/readings/all?ponds=&from=&to=` — multi-pond export rows
- `GET /api/readings/compare` — multi-pond overlay series for compare mode

### Thresholds (open)
- `GET /api/thresholds?pond=N`
- `PATCH /api/thresholds` — bulk upsert (writes audit)
- `GET /api/thresholds/history?pond=N&sensor=X`

### Alerts (open)
- `GET /api/alerts` — full history
- `GET /api/alerts/active` — unacknowledged
- `POST /api/alerts/[id]/acknowledge`
- `POST /api/alerts/acknowledge-all` — `{ ok, acknowledged }`

### Maintenance (open)
- `GET /api/maintenance` — all requests
- `POST /api/maintenance` — file a request (404 on unknown pond); `requested_by` = `getOperatorId()`
- `PATCH /api/maintenance/[id]` — acknowledge / resolve

### Notifications (open)
- `GET /api/notifications/unread-count`

### Utilization (open)
- `GET /api/utilization?ponds=&from=&to=` — uptime % from `pond_status_log`

### Cloud sync
- `POST /api/sync` — **main server only** (reference copy here). Bearer `SYNC_TOKEN`. Body `{ readings: [{ time, owner_id, pond_code, temperature, ph, salinity, dissolved_oxygen, source }] }`. Resolves `(owner_id, pond_code)` → `ponds.id` in SQL, bulk insert, `ON CONFLICT (pond_id, time) DO NOTHING`. Returns `{ ok, inserted, duplicate, unknown, skipped, received }`.
- `GET /api/sync/status` — local. `{ lastSyncAt, pendingCount, unsyncableCount, online, serverReachable, configured, missing }`. `configured` requires BOTH `SYNC_TOKEN` and a UUID `SYNC_OWNER_ID`; `missing` names the first absent one. Probe timeout 3 s (vs the worker's 8 s) and cached 30 s, because an offline Pi is the normal case and the sidebar must not hang.
- `POST /api/sync/trigger` — local. Runs `runSync` inline for the dashboard button; 409 while one is already running in-process.

### Debugging (open)
- `GET /api/admin/logs` — ingestion logs (with CSV export). Path kept; the admin guard is gone.

## Key Rules (NON-NEGOTIABLE — DO NOT VIOLATE)

- Never hardcode optimal ranges — always from `pond_sensor_thresholds`.
- Never hardcode timezone — always `process.env.APP_TIMEZONE`.
- Sensor values: `ROUND(::numeric, 2)::float8` in SQL AND `toFixed(2)` in UI.
- Never query `user_pond_access` and never scope by user — every query returns all ponds.
- Never reintroduce roles, session checks, or a users/ponds admin console.
- Never open port 5432 to the internet.
- Pond status always via shared `getPondStatus()` (`@/lib/pondStatus`) — never duplicate.
- Alert detection: background worker ONLY — never in ingestion route.
- Status logging: `pond_status_log` written by the ingest route only (throttled to one row per pond per minute) — never via dashboard polling.
- Chart queries (`/api/readings`, `/api/readings/compare`) read `sensor_readings_15m`, never raw `sensor_readings`. Raw scans over a range of per-second readings were what made the Pi "very slow". Only Today-for-one-pond reads raw (1-minute buckets).
- When grouping over the rollup, `GROUP BY` must be **positional** (`GROUP BY 1`). The view has a column named `bucket`; an output alias with the same name loses to it, and the query silently groups at 15 minutes for every range.
- Ingest is one transaction with `SET LOCAL synchronous_commit TO off`. Never split it back into autocommit statements — each one is a WAL fsync on USB flash, and readers on the shared pool queue behind them.
- No client timestamps — server stamps `time = NOW()` always.
- uPlot destroy + recreate on range change — never update in place.
- Default chart range: Today.
- ESP32 firmware (`esp32_iotgateway.ino`) — never change.
- All API routes: `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- Root layout stays `dynamic = "force-dynamic"` — the license gate must never be baked into a static prerender.
- Never add a license bypass flag, env override, or dev short-circuit.
- Never commit `license.json` or `keys/`.

## Chart Behavior

- **Today**: single pond — 1-minute averages from raw (`mode: "raw"` payload, <= 1440 points; `since` re-sends the last bucket and the client replaces it). Several ponds — 15-minute average across them from the rollup. HH:mm x-axis, no rotation
- **7d**: 1h bucket, -30° rotation
- **14d**: 3h bucket, -30° rotation
- **30d**: 6h bucket, -30° rotation
- **Health status**: Normal / Warning / Critical based on % outside optimal range
- **Tooltip**: Time, AVG, MIN, MAX, Anomaly count, Health status
- **Anomaly count** is at 15-minute resolution: a 15-minute bucket whose *average* is out of range contributes all of its readings. That is the same rule the health colour uses, so the two always agree. A lone spike inside a normal quarter hour is not counted.
- **Compare mode**: overlapping lines per pond, unique colors array defined in constants

## Alert System

- **Sensor**: 7 consecutive out-of-range readings → INSERT `sensor_alerts` (re-alerts after acknowledge).
- **Connectivity**: 20+ mins no data → INSERT `sensor_alerts` with `sensor='connectivity'` (auto-resolves on next data).
- **Worker**: `scripts/alert-worker.ts`, cron `*/5 * * * *`.
- **Popup**: shows ALL unacknowledged alerts on load, no time limit. Two exits with different meanings — **Acknowledge** (server-side, clears the badge, shows as acknowledged in `/notifications`) and **Ignore** (this browser only: alert stays open on the server, still counted in the badge, still active in `/notifications`). Ignored ids persist in `localStorage` (`ipond.ignoredAlertIds`), pruned against the live list so a re-triggered alert (new id) still pops. "Ignore all" / "Acknowledge all" in the popup header; per-row and "Acknowledge all" on `/notifications` → Sensor Alerts.
- **`POST /api/alerts/acknowledge-all`** — one UPDATE over every open alert, idempotent.
- **Anything that acknowledges must call `refreshAlertViews()`** — the badge (`/api/notifications/unread-count`) is a separate SWR key and otherwise shows a stale count for up to a minute.
- **There is NO unique index on open alerts** — migration 010 dropped `idx_sensor_alerts_active` on purpose so sensor alerts re-fire after acknowledgement. Any code that inserts an alert must guard with `NOT EXISTS (... acknowledged_at IS NULL)` like the worker does. `ON CONFLICT DO NOTHING` conflicts on nothing here. `/api/ponds/status` relied on it and spammed one connectivity alert per offline pond on every 30 s poll until fixed.

## Deployment (Raspberry Pi, standalone)

`next.config.ts` sets `output: "standalone"`. Three consequences — all three silently break a naive deploy, see README:

1. Entry point is `node .next/standalone/server.js`, **not** `npm start`.
2. `public/` and `.next/static/` are **not** copied into the bundle. Must `cp -r` both after every build or the app serves unstyled HTML.
3. `server.js` **chdirs to its own directory**, so `process.cwd()` is `.next/standalone`. `LICENSE_PATH` must be **absolute** or the license reads as `missing` and the app bricks itself. The build also copies `.env` into `.next/standalone/.env`, so editing the project `.env` post-build does nothing — pass config via systemd `EnvironmentFile`, which takes precedence.

- **Deploy**: `./scripts/deploy.sh [--pull]` — build, copy `public/` + `.next/static/` + `.env` + `license.json` into the bundle, restart (systemd `ipond` if present, else PM2 `ipond-local`). Prints the newest migration number so nobody forgets to apply it.
- **Postgres tuning lives in `docker-compose.yml` `command:`** — 1 GB shared_buffers, `synchronous_commit=off`, 15-min checkpoints, `max_wal_size=2GB`, `wal_compression=on`, `random_page_cost=1.1`, `log_checkpoints=on`. The image's own timescaledb-tune step lives in `/docker-entrypoint-initdb.d`, which our migrations mount replaces, so without this block the DB runs stock defaults (128 MB shared_buffers, fsync every commit). A config change needs `docker compose up -d` (recreate; data is a bind mount, untouched). `synchronous_commit=off` means a power cut can lose the last ~0.6 s of writes — accepted for telemetry.
- **Migration**: `docker exec -i ipond-timescaledb psql -U soletronix -d ipond < db/migrations/XXX.sql`, or `./db/run_remaining.sh 0NN` to apply from a number onward.
- **Compose**: one file, `i-pond-frontend/docker-compose.yml` — container `ipond-timescaledb`, db `ipond`, data bind-mounted at `DB_DATA_PATH`, password from `.env`, port bound to `127.0.0.1` only. Run it from the app directory so `.env` is picked up.
- **Serial listener**: systemd unit `ipond-serial`, `After=ipond.service`, `Restart=always`. The listener **exits on port close** on purpose so systemd re-opens the port when the cable comes back. `pi` must be in `dialout`.
- Never commit `.env`. Never commit `.next` folder.
- Each appliance needs its own signed `license.json` at `LICENSE_PATH`, matching that Pi's `/proc/cpuinfo` serial.

## Conventions

- Env vars in `.env` — never commit.
- Migrations in `/db/migrations/` — numbered, idempotent where possible.
- DB pool: `@/lib/db` (singleton, `max: 8`); worker uses its own pool (`max: 3`).
- No auth guards anywhere. Writes stamp `getOperatorId()` from `@/lib/operator`.
- License: `@/lib/license`.
- Ingestion auth: Bearer token from `API_TOKEN` env var.

## What NOT to Do

- Never use Recharts.
- Never add humidity.
- Never open port 5432 publicly.
- Never hardcode optimal ranges.
- Never hardcode timezone.
- Never trust client timestamps.
- Never check alerts in ingestion route (worker does it).
- Never reintroduce NextAuth, login pages, roles, or client-side route protection.
- Never add `user_pond_access` back into a query.
- Never reintroduce per-account subscription/expiry — the license file is the only expiry mechanism.
- Never add a way to bypass the license gate.
- Never round-trip a `sensor_readings.time` through a JS `Date` — microseconds are lost and sync silently stops matching rows.
- Never mark `synced_at` before the main server has confirmed the batch.
- Never reuse `API_TOKEN` as `SYNC_TOKEN`.
- Never mark a reading synced that the server reported as `unknown`.
- Never commit a database password — `docker-compose.yml` reads it from `.env`.
- Never make the serial listener swallow a port close — it must exit so systemd restarts it.
- Never pass a query parameter the SQL does not reference — Postgres cannot infer its type (`could not determine data type of parameter $N`).
- Never insert a `sensor_alerts` row without a `NOT EXISTS (... acknowledged_at IS NULL)` guard — there is no unique index to catch duplicates.
- Never change the firmware's receive path — copy it from `old_code_working.ino` and only touch `sendToPi()`.
- Never add a chart query that scans raw `sensor_readings` over a multi-day range — go through `sensor_readings_15m`.
- Never `GROUP BY bucket` on the rollup — positional only (see Key Rules).
- Never poll both dashboard view modes at once — pass `active` to `useMultiPondReadings` / `useCompareReadings`.
- Never delete from `sensor_readings` in a retention job — compression (018) handles disk growth; the rows are the record and cloud sync reads them.
- Never put a `*.sh` (or anything but numbered `*.sql`) in `db/migrations/` — it is the Postgres init directory and the entrypoint executes shell scripts it finds there. `run_remaining.sh` lives in `db/` for this reason.
- Never reintroduce Vercel config (`vercel.json`, `NEXTAUTH_URL`, `AUTH_SECRET`) — this is a self-hosted Pi build.
- Never ship a standalone build without copying `public/` and `.next/static/`.
- Never seed a fresh appliance with `001_seed.sql` — use `002_local_appliance.sql`.
- Never swallow a failed write into `console.error` alone — surface it in the UI. "Loads then nothing happens" is a 500 the user cannot see.
- Never skip updating CLAUDE.md and CHANGELOG.md after a change.

## Documentation

Docs live in `/docs/` in two formats — Markdown (GitHub) and Word (`.docx`):

- [User-Guide.md](docs/User-Guide.md) / `User-Guide.docx` — pond owners and viewers
- [Admin-Guide.md](docs/Admin-Guide.md) / `Admin-Guide.docx` — system administrators
- [Full-Documentation.md](docs/Full-Documentation.md) / `Full-Documentation.docx` — end-to-end reference
- [Technical-Documentation.md](docs/Technical-Documentation.md) / `Technical-Documentation.docx` — developer handover
- [Database-Documentation.md](docs/Database-Documentation.md) / `Database-Documentation.docx` — schema, queries, backup

Doc source-of-truth is `scripts/docs/*.js` (regenerates `.docx`). `.md` files are hand-mirrored — when content changes, update **both**.
