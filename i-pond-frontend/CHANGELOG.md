# Changelog

## [2026-09-12] — Pi deployment checklist + a seed that actually works

### Changed
- **`docs/Pi-Deployment-Checklist.md`** (new) — end-to-end deployment guide written for a reader with no Linux, Docker or Node experience. 12 phases from flashing the SD card to an acceptance test, every command copy-paste, each step paired with the expected output, plus a troubleshooting table keyed on the actual error strings the app emits.
- **`db/seeds/002_local_appliance.sql`** (new) — first-boot seed for the appliance: one operator row (matching the `getOperatorId()` fallback UUID), ponds 1-10 with `pond_code`, and default optimal ranges for all four sensors. Idempotent.
- **README** — links the checklist and documents the seed step, which it had never mentioned.

### Files Modified
- docs/Pi-Deployment-Checklist.md *(new)*
- db/seeds/002_local_appliance.sql *(new)*
- README.md, CLAUDE.md

### Notes
- **A fresh install was broken and nobody would have known until the sensors failed.** Reproduced on a genuinely empty database: `docker compose up -d` auto-runs the migrations and creates all 10 tables, but `db/seeds/001_seed.sql` then fails with `insert or update on table "ponds" violates foreign key constraint "ponds_owner_id_fkey"` — it assigns ponds to owners `...0002` and `...0003` that it never creates. Result: 1 owner, **0 ponds**, and every ESP32 POST rejected with `unknown_pond`. `001_seed.sql` is left untouched for the old multi-tenant deployment; the appliance uses `002_local_appliance.sql`.
- **Default thresholds were missing too.** Migration 004 seeds them with `SELECT ... FROM ponds`, but on a fresh install it runs before any pond exists and inserts nothing — so charts would have had no optimal band and the alert worker would never have fired. The new seed inserts them after the ponds.
- Verified the whole first-boot path on a wiped volume: fresh `docker compose up -d` → 10 tables → seed → `owners=1 ponds=10 thresholds=40` → `npm run build` → standalone boot → a real ESP32-shaped payload (`{"data":{"pnd":3,...}}`) accepted with `{"ok":true}` 201 → the reading visible via `/api/readings/latest?pond=3` and 10 ponds on `/api/ponds`. The `.env` validation one-liners in step 4.3 were run against a deliberately mismatched file to confirm they detect the failure rather than always printing OK.
- The checklist flags the two things the deployer cannot fix alone: the licence must be signed by Soletronix against that Pi's `/proc/cpuinfo` serial, and the TimescaleDB image must have an `arm64` build for the pinned tag — worth confirming on real hardware before a site visit.
- **Still outstanding from earlier work**: `src/lib/license.ts` embeds a development keypair. It must be swapped for the production public key before any appliance ships, or every licence can be forged by anyone holding the matching private key in `keys/`.

## [2026-09-09] — Pi deployment config: standalone output, drop Vercel

### Changed
- **`.env.example` rewritten for the appliance**: `DATABASE_URL` on the `soletronix` role, `API_TOKEN` (ESP32), `TZ`/`APP_TIMEZONE`/`NEXT_PUBLIC_APP_TIMEZONE` set to `Asia/Manila`, `SYNC_TOKEN`, `MAIN_SERVER_URL`, `LICENSE_PATH=/home/pi/ipond-local/license.json`. Dead `AUTH_SECRET` and `AUTH_TRUST_HOST` removed (unused since NextAuth was dropped). `POSTGRES_USER`/`PASSWORD`/`DB` kept and aligned to the new role — `docker-compose.yml` interpolates them, so dropping them would break `docker compose up`.
- **`SYNC_TARGET_URL` renamed to `MAIN_SERVER_URL`** in `src/lib/sync.ts`, README and CLAUDE.md, so the name in `.env.example` is the name the code actually reads.
- **`next.config.ts`**: added `output: "standalone"`. `serverExternalPackages: ["pg", "pg-native"]` kept — pg has native bindings and must stay external for tracing.
- **`vercel.json` deleted** (`functions.maxDuration`, `env.NODE_ENV` — serverless-only settings with no meaning on a Pi).
- **README**: new "Raspberry Pi Deployment" section — first-time setup, build + asset copy, a systemd unit, an nginx site, both cron lines, redeploy and migration commands, and health checks. Env table cleaned of `AUTH_SECRET`/`NEXTAUTH_URL` and given `LICENSE_PATH`, `NEXT_PUBLIC_APP_TIMEZONE` and `TZ`.
- **README intro, stack list and project tree corrected** — they still described next-auth, multi-tenancy, `/admin`, `/login`, `src/auth.ts` and the Zustand auth store, all removed in earlier prompts. Left in place they would actively mislead someone following the deploy steps.

### Files Modified
- .env.example, next.config.ts, README.md, CLAUDE.md
- src/lib/sync.ts
- *Deleted*: vercel.json

### Notes
- **`output: "standalone"` changes how the app runs, in three ways that each break a naive deploy.** All three were found by actually building and booting the bundle:
  1. The entry point becomes `node .next/standalone/server.js`; `npm start` is no longer the way in.
  2. Next does **not** copy `public/` or `.next/static/` into the bundle. Verified: without `cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/`, the app serves HTML with no CSS, fonts or favicon. With it, CSS/favicon/public assets all return 200.
  3. `server.js` **chdirs to its own directory**. Booting from the project root still reported the license as `missing`, because `process.cwd()` had become `.next/standalone` and the `<cwd>/license.json` fallback no longer pointed at the project root. Setting an absolute `LICENSE_PATH` fixed it — which is why the value belongs in `.env.example`. Without it, switching to standalone would have bricked the appliance behind the "License Expired" screen.
- **The build copies `.env` into `.next/standalone/.env`**, and the standalone server reads that copy. Editing the project `.env` after a build therefore has no effect on the running server. Confirmed that real process environment variables take precedence over the bundled file, so the systemd unit uses `EnvironmentFile=` — that is the reliable way to change config without a rebuild. It is also worth knowing that a built bundle contains a copy of your secrets.
- **Verified end to end**: standalone bundle built, assets copied, booted, and exercised. All 16 API endpoints and all 7 pages returned their expected status; the license validated with `LICENSE_PATH` set; `/api/sync/status` responded; CSS, favicon and `public/` assets served.
- The `TZ` variable was not in the requested list but is present in the working `.env` and matters for cron and Node on the Pi, so it is documented as optional rather than silently dropped.
- **Follow-up**: `docs/*.md` and `scripts/docs/*.js` remain the last stale documentation — they still describe login, roles, tenancy, the admin console and PM2. The README is now accurate; those are not.

## [2026-09-09] — Cloud sync: local Pi → main server

### Changed
- **`db/migrations/016_sync.sql`** — adds `sensor_readings.synced_at` (local: NULL = not yet shipped) and `sensor_readings.source` (main server: `'local-pi'` vs direct ESP32 ingest), a UNIQUE index on `(pond_id, time)` as the `ON CONFLICT` target, and a partial index on unsynced rows. Applied to both deployments; the unused half is harmless on either side.
- **`src/lib/sync.ts`** — the sync core, shared by the worker and the trigger route so there is one implementation. Free of Next.js and `@/lib/db` imports. Exports `runSync(pool, log)`, `checkOnline()`, `countPending()`, `lastSyncAt()`. Batches of 500, ceiling of 20 batches (10,000 readings) per run so a backlog cannot overrun the 5-minute cron slot.
- **`scripts/sync-worker.ts`** — cron entry point: loads `.env`, own pool (`max: 3`), logs to `~/logs/sync-worker.log` (override with `SYNC_LOG_PATH`), prints a one-line summary, always exits 0.
- **`POST /api/sync`** — the receiver, for the **main server**. Bearer `SYNC_TOKEN`, bulk insert via `unnest`, `ON CONFLICT (pond_id, time) DO NOTHING`, returns `{ synced, received }`. Unknown `pond_id`s are filtered rather than rejected so one misconfigured pond cannot block a batch. Caps at 5,000 readings per request.
- **`GET /api/sync/status`** — `{ lastSyncAt, pendingCount, online, serverReachable, configured }`. The connectivity probe is cached 30s because every open tab polls it and each miss costs a real round trip.
- **`POST /api/sync/trigger`** — runs `runSync` inline for the dashboard button; returns 409 while one is already running in-process.
- **`src/components/SyncStatus.tsx`** in the sidebar footer — coloured dot, "Last synced: X mins ago" / "Not synced — no internet" / "Cloud server unreachable", pending count, and a **Sync to Cloud** button with a spinner and result message.
- **`package.json`** — `"sync-worker": "tsx scripts/sync-worker.ts"` and `tsx` added to devDependencies (it was not installed; the bare `tsx` binary would not have resolved, and `npx tsx` would try to reach the network on an offline Pi).
- **README** — Cloud Sync section: migration, `SYNC_TOKEN`, `mkdir -p ~/logs`, the manual run, and the `*/5 * * * *` crontab line.

### Files Modified
- db/migrations/016_sync.sql *(new)*
- src/lib/sync.ts *(new)*
- scripts/sync-worker.ts *(new)*
- src/app/api/sync/route.ts, src/app/api/sync/status/route.ts, src/app/api/sync/trigger/route.ts *(new)*
- src/components/SyncStatus.tsx *(new)*
- src/components/MainLayout.tsx, package.json, package-lock.json, README.md, CLAUDE.md

### Notes
- **The spec's `WHERE id = ANY($1)` was not implementable: `sensor_readings` has no `id` column.** It is a hypertable of `(time, pond_id, temperature, ph, salinity, dissolved_oxygen)`. Rows are identified by `(pond_id, time)` throughout, and migration 016 adds the UNIQUE index that both the local UPDATE and the server-side `ON CONFLICT` need. There was no unique constraint before, so `ON CONFLICT DO NOTHING` had nothing to conflict on. Verified there were no pre-existing duplicates before creating it.
- **Two real bugs were caught by end-to-end testing, not by the typechecker.**
  1. *Microsecond truncation.* Postgres stores `time` to microseconds (`.975346`); `Date.toISOString()` emits milliseconds. The first live run sent 500 rows twenty times and marked **zero**, because the UPDATE could never match. Timestamps are now carried as full-precision ISO strings end to end and never pass through a JS `Date`.
  2. *Exit code 127 on every offline run.* Tearing down a failed fetch leaves an async handle mid-close; calling `process.exit()` on top of it aborts with a libuv assertion. The sync logic had already completed correctly, but cron would have seen a failure every time the Pi was offline. The worker now sets `process.exitCode = 0` and lets the loop drain, with an unref'd 2s backstop. `AbortSignal.timeout()` was also replaced with a clearable `AbortController` + `setTimeout`, since its timer cannot be cancelled.
- **Verified end to end against a real receiver**, not a stub: a second instance of this app on port 3142 backed by a separate `soletronix_cloud` database, so the actual `/api/sync` route was exercised. 45,000 readings moved across five runs. Confirmed: batch resumption across runs; row-for-row fidelity including microseconds and sensor values; `source = 'local-pi'`; idempotency under load (5,000 rows deliberately un-marked and re-sent produced zero duplicates and zero cloud growth); nothing marked when the server is down; ESP32 `API_TOKEN` rejected by `/api/sync` (401); malformed times rejected (400); unknown pond filtered (received 2, synced 1); the 409 concurrency guard; and the sidebar UI rendering "Last synced: just now" with the pending count and working button.
- **`/api/sync` ships in this repo, which is now the local-appliance build.** It is intended for the main server. On a Pi it is inert unless `SYNC_TOKEN` is set, and the appliance is LAN-only, but it is a live bulk-insert endpoint — worth excluding from the appliance build if the two deployments are ever split.
- The test databases and rows were cleaned up: `soletronix_cloud` dropped and all local `synced_at` values reset to NULL, so a first real sync will not skip anything.
- **Follow-up**: README still describes next-auth, multi-tenancy and `/admin` in its intro, stack table and project tree — pre-existing drift from Prompts A–C, alongside `docs/*.md` and `scripts/docs/*.js`. The new Cloud Sync section and env rows are accurate; the surrounding document is not.

## [2026-09-08] — Drop the in-app subscription/expiry system

### Changed
- **`db/migrations/015_drop_subscription.sql`** (new) drops `owners.expires_at`, `owners.subscription_notified_30`, `owners.subscription_notified_7` and the `idx_owners_expires_at` index. Idempotent (`DROP ... IF EXISTS`), verified by running it twice.
- Migration 013 is deliberately left in place — migration history is append-only, so a fresh install adds these columns and then drops them again.
- CLAUDE.md: the "Subscription Model" section is gone; expiry is now documented once, under Licensing. Migration count 14 → 15.

### Files Modified
- db/migrations/015_drop_subscription.sql *(new)*
- CLAUDE.md

### Notes
- **The application code needed no changes** — Prompts A and B had already removed every part of this feature, and re-reading the tree confirmed it:
  - No query anywhere referenced `expires_at` or the `subscription_notified_*` flags; the only `expiresAt` identifiers left in `src/` belong to the license system.
  - No auth logic exists to hold an expiry check (the login-time `SubscriptionExpiredError` went with NextAuth in Prompt A).
  - `ExpiryBanner` was replaced by `LicenseBanner` in Prompt A.
  - The user table with its Expiry column, the "Expiring Subscriptions" tab, `ExpiringSubscriptions`, `AdminUserRow` and `/api/admin/users` were all deleted in Prompt B.
  - `/notifications` already had exactly two tabs — Maintenance Requests and Sensor Alerts.
  So the only work left was the schema, which is what this entry covers.
- Verified against a running production build on the live TimescaleDB with the columns dropped: `\d owners` shows the three columns and the index gone; all 16 endpoints return 200 with data; every page renders; `/notifications` shows only the two expected tabs; and a maintenance POST — which both reads `owners.name` and writes the `requested_by` FK — succeeds. The test row was reverted.
- The subscription docs never existed, so there is no doc drift from this change. The **pre-existing** drift stands: `docs/*.md` and `scripts/docs/*.js` still describe login, roles, tenancy and the admin console, all removed in Prompts A and B. That regeneration has now been deferred three times and is worth doing as one pass.
- `owners.role` and `owners.password_hash` remain in the schema, unread. Dropping those is a separate migration, not done here.

## [2026-09-08] — Remove multi-tenant scoping and all API role checks

### Changed
- **Tenant scoping gone.** `user_pond_access` is no longer read by any query. Every route returns all ponds; the admin/owner SQL forks and their `isAdmin ? ... : ...` parameter juggling are deleted, leaving one query per route.
  - `GET /api/ponds` is now a plain `SELECT ... FROM ponds ORDER BY id`.
  - `/api/ponds/status`, `/api/dashboard/stats`, `/api/alerts/active`, `/api/maintenance`, `/api/notifications/unread-count`, `/api/readings` (today + aggregated branches), `/api/readings/all`, `/api/readings/compare`, `/api/utilization` all lost their owner-scoped variants.
  - `ownsPond()` / `ownerPondIds()` / `resolveAccessiblePondIds()` helpers replaced by `pondExists()` / `allPondIds()` where a route still needs to validate the pond argument.
  - Where a route answered **403** for a pond outside the caller's access it now answers **404 when the pond does not exist**, and serves it otherwise. `/api/readings/all` and `/api/utilization` dropped the `ponds=mine` scope.
- **Auth guards gone from every API route.** No `auth()`, no `session.user`, no `requireAdmin()`, no 401/403. `src/auth.ts` and `src/lib/admin.ts` are deleted.
- **`src/lib/operator.ts` added.** `getOperatorId()` returns the first `owners` row by `created_at` (fallback `00000000-0000-0000-0000-000000000001`), cached per process. This is identity for record-keeping, not authorization: `maintenance_requests.requested_by` is `NOT NULL` and `sensor_alerts.acknowledged_by`, `maintenance_requests.acknowledged_by`/`resolved_by`, `pond_sensor_thresholds.updated_by` and `pond_sensor_thresholds_audit.changed_by` are all FKs to `owners(id)`. Dropping it would have broken those writes.
- **Admin console removed.** Deleted `src/app/admin/page.tsx`, `/api/admin/users/**` and `/api/admin/ponds/**` (user CRUD, pond CRUD, `next-code`). The "User Management" nav item is gone.
- **`/admin/logs` kept** for local debugging, with the guard removed; its pond-filter dropdown now reads the open `/api/ponds` instead of the deleted `/api/admin/ponds`.
- **UI cleanup.** Notifications lost the Expiring Subscriptions tab, its `/api/admin/users` fetch, the `AdminUserRow` type and the `ExpiringSubscriptions` component. Reports and Utilization lost the "All My Ponds" scope pill; `AllReadingsScope` in `useApi` lost its `'mine'` member. `useDashboardStats` lost the `scope` field, and `/api/dashboard/stats` no longer returns it. Dead `User` and `DashboardData` types dropped from `src/types`.

### Files Modified
- src/lib/operator.ts *(new)*
- src/app/api/ponds/route.ts, src/app/api/ponds/status/route.ts, src/app/api/dashboard/stats/route.ts *(rewritten)*
- src/app/api/alerts/route.ts, src/app/api/alerts/active/route.ts, src/app/api/alerts/[id]/acknowledge/route.ts
- src/app/api/maintenance/route.ts, src/app/api/maintenance/[id]/route.ts
- src/app/api/notifications/unread-count/route.ts
- src/app/api/readings/route.ts, .../all/route.ts, .../compare/route.ts, .../latest/route.ts, .../raw/route.ts
- src/app/api/thresholds/route.ts, src/app/api/thresholds/history/route.ts
- src/app/api/utilization/route.ts, src/app/api/admin/logs/route.ts
- src/app/admin/logs/page.tsx, src/app/notifications/page.tsx, src/app/reports/page.tsx, src/app/utilization/page.tsx
- src/components/MainLayout.tsx, src/hooks/useApi.ts, src/hooks/useDashboardStats.ts, src/types/index.ts
- CLAUDE.md
- *Deleted*: src/auth.ts, src/lib/admin.ts, src/app/admin/page.tsx, src/app/api/admin/users/, src/app/api/admin/ponds/

### Notes
- Verified against a running production build on a seeded TimescaleDB. The seed's operator row resolves to **Owner Two**, an `owner` whose `user_pond_access` covers only ponds 6-10 — so it is a real proof that scoping is gone: `/api/ponds` returns all 11 ponds, `/api/dashboard/stats` reports `totalPonds: 11`, `/api/readings/compare` returns 11 series, and ponds 1-5 serve readings, thresholds, history and maintenance writes normally.
- All 16 endpoints return 200 with data and none can return 401/403. Unknown ponds return 404 (`/api/readings`, `latest`, `raw`, `compare`, `maintenance` POST). All three write paths (maintenance POST, thresholds PATCH, alert acknowledge) succeed and stamp the operator id.
- Test rows written during verification were reverted (maintenance request, synthetic alert, threshold change restored from its audit row). The ~1,600 sample `sensor_readings` inserted for the test remain in the local Docker volume — drop with `docker compose down -v` if you want a clean DB.
- `user_pond_access` and the `owners` role/password columns are **left in the schema untouched**; nothing reads them any more. Dropping them is a separate migration, not done here.
- **Follow-up**: `scripts/docs/*.js` and `docs/*.md` still document roles, tenancy, login and the admin console. Regenerating them remains out of scope.

## [2026-09-08] — Remove NextAuth, gate app behind signed license

### Changed
- **Auth removed entirely.** No login page, no sessions, no route protection. This is a single-operator local appliance; the license file is the only gate.
  - Deleted `src/app/api/auth/`, `src/app/login/`, `src/app/actions/auth.ts`, `src/middleware.ts`, `src/auth.config.ts`, `src/types/next-auth.d.ts`, `src/store/authStore.ts`.
  - Dropped `next-auth` from `package.json` and the lockfile.
  - `src/auth.ts` rewritten as a **no-auth shim** exporting `auth()` — resolves the first `owners` row with `role='admin'` (fallback `00000000-0000-0000-0000-000000000001`), cached per process. API routes keep their role checks and tenant scoping untouched, and rows they write (maintenance requests, threshold audits) keep valid foreign keys. Prompt B deletes this together with those checks.
  - `SessionProvider` / `SessionSync` gone from `Providers`; `AlertPopup` no longer reads auth state.
  - Every `if (!isAuthenticated) router.push('/login')` and `sessionStatus` guard removed from the 8 pages.
  - All UI role checks removed: sidebar shows every nav item, dashboard always renders company name + Request Maintenance, reports/utilization always offer "All Ponds", notifications always shows Sensor Alerts / Expiring Subscriptions / By / Actions, `/admin` and `/admin/logs` no longer self-deny.
  - `MainLayout` footer lost the user card and Sign Out; it now shows "Local Appliance" + theme toggle.
  - `/` is a server redirect straight to `/dashboard`.
  - `AUTH_SECRET` dropped from `src/lib/env.ts` required vars; auth paths dropped from `src/constants/endpoints.ts`.
- **License gate added.** `src/lib/license.ts` verifies a Soletronix-signed `license.json` offline with RSA-SHA256.
  - Public key embedded in the module. Signed fields: `licenseId`, `client`, `piSerial`, `issuedAt`, `expiresAt`; canonical form is key-sorted JSON of exactly those five.
  - Lookup order `$LICENSE_PATH` → `/license.json` → `<cwd>/license.json`.
  - `piSerial` is matched against the `Serial` line of `/proc/cpuinfo`; the signed value `"ANY"` is a wildcard for dev boxes and VMs.
  - Exports `isLicenseValid()`, `getLicenseInfo()`, `getDaysUntilExpiry()`, plus `resetLicenseCache()` for tooling.
  - File read, signature check and serial check are cached per process; **expiry is re-evaluated on every call**, so a long-running server locks itself out on the day the license lapses.
  - Fail-closed reasons: `missing`, `malformed`, `bad_signature`, `serial_mismatch`, `expired`. On a bad signature nothing from the file is shown as fact.
- **Gate wired into `src/app/layout.tsx`** (server component). Invalid license renders `<LicenseExpired>` full screen and the app tree is never constructed — no route, no client toggle, no env flag gets past it. Layout is `dynamic = 'force-dynamic'` so the check runs per request instead of being frozen into a static prerender.
- **`<LicenseBanner>`** replaces `ExpiryBanner` in `MainLayout`: amber at ≤30 days, red at ≤7, fed by `/api/license`.
- **`GET /api/license`** returns `{ valid, client, expiresAt, daysLeft, reason }`.
- **`scripts/generate-license.ts`** signs license files (`npm run license:generate -- --client "Name" --serial <serial|ANY> --days 1825`).

### Files Modified
- src/lib/license.ts *(new)*
- src/app/api/license/route.ts *(new)*
- src/components/LicenseExpired.tsx *(new)*
- src/components/LicenseBanner.tsx *(new)*
- scripts/generate-license.ts *(new)*
- src/auth.ts *(rewritten as no-auth shim)*
- src/app/layout.tsx, src/app/page.tsx
- src/components/Providers.tsx, src/components/MainLayout.tsx, src/components/AlertPopup.tsx
- src/app/dashboard/page.tsx, src/app/dashboard/[pondId]/page.tsx, src/app/dashboard/[pondId]/[sensorType]/page.tsx
- src/app/reports/page.tsx, src/app/utilization/page.tsx, src/app/notifications/page.tsx
- src/app/settings/thresholds/page.tsx, src/app/admin/page.tsx, src/app/admin/logs/page.tsx
- src/lib/env.ts, src/constants/endpoints.ts
- package.json, package-lock.json, .gitignore, CLAUDE.md
- *Deleted*: src/app/api/auth/, src/app/login/, src/app/actions/, src/middleware.ts, src/auth.config.ts, src/types/next-auth.d.ts, src/store/authStore.ts, src/components/ExpiryBanner.tsx

### Notes
- **The embedded public key is a keypair generated during this change**, with the private half at `keys/soletronix_private.pem` (gitignored, as is `license.json`). Replace both halves with the real Soletronix production keypair before shipping appliances, and keep the private key off every deployed host.
- A demo license (`client: Soletronix Demo Farm`, `piSerial: ANY`, 5 years) sits at `i-pond-frontend/license.json` so the app runs locally. Production appliances need their own file signed for that Pi's `/proc/cpuinfo` serial.
- Verified end-to-end against a running production build: valid → app renders; expired, wrong-device, tampered, malformed and missing → full-screen block on `/`, `/dashboard`, `/admin`, `/reports`, `/notifications`, `/settings/thresholds`, `/utilization`. Tampering with `client`, `expiresAt` or `piSerial` breaks the signature.
- `AUTH_SECRET` and `AUTH_TRUST_HOST` are now dead entries in `.env` / `.env.example` — harmless, clean up when convenient.
- The `owners` table, `expires_at`, `password_hash` and the admin console's user CRUD are all untouched; only the app's use of them for login is gone.
- **Follow-up**: `scripts/docs/*.js` and `docs/*.md` still document NextAuth and the login flow. Regenerating them is out of scope for this prompt.
- **Follow-up (Prompt B)**: remove role checks from the API routes and delete `src/auth.ts` and `src/lib/admin.ts` with them.

## [2026-07-18] — Mirror LCD output to Serial (new gateway firmware)
### Changed
- lcdLine() now Serial.println() every non-empty message as "[LCD Ln] msg"
- lcdShow() unchanged (mirrors via lcdLine); empty lines skipped by length check
- printToLCD() adds "=== SENSOR DATA ===" block to Serial (temp/pH/sal/dox/pond)
- No LCD calls removed, no logic changed
### Files Modified
- esp32_iotgateway_new_soletronix.ino
### Notes
- For running with LCD disconnected — all UI now visible in Serial Monitor (9600 baud)

## [2026-07-18] — SD card backlog in new gateway firmware
### Changed
- Added SD card offline backlog to esp32_iotgateway_new_soletronix.ino (separate from production esp32_iotgateway.ino)
- SD init + pond1..5 dir creation in setup(); sdAvailable flag
- saveToSD(): writes payload to /pondN/<millis>.txt on WiFi down OR HTTP non-2xx
- replayBacklog(): re-POSTs stored files, removes on 2xx; runs on setup (if WiFi) and on WiFi reconnect in loop()
- Payload saved to SD uses identical format to sendToServer() body
- LCD feedback for all SD ops
### Files Modified
- esp32_iotgateway_new_soletronix.ino
### Notes
- SD_CS_PIN = 5 (matches sd_card_test.ino wiring)
- Production firmware esp32_iotgateway.ino unchanged
- IDE "cannot open SD.h/SPI.h" diagnostic is expected (Arduino libs not on VSCode include path)

## [2026-07-18] — SD test re-run via Serial command
### Changed
- Refactored all 7 tests into runTests()
- setup() calls runTests() once; loop() waits for 'run' command to re-run (no reset needed)
- Unknown commands echoed back with hint
### Files Modified
- sd_card_test.ino
### Notes
- Serial Monitor: line ending = Newline, baud = 9600 (matches firmware; NOT 115200)
- Test logic, SD library, CS pin unchanged

## [2026-07-18] — Add SD card test sketch
### Changed
- New standalone Arduino sketch to diagnose SD card via Serial Monitor
- Mirrors old firmware SD setup: SD.h over SPI, default VSPI CS (GPIO5), 9600 baud
- 7 tests in setup(): init, write, read, recursive list, create pond dirs, simulate backlog save, cleanup
### Files Modified
- sd_card_test.ino (new)
### Notes
- Baud is 9600 to match esp32_iotgateway_old_code_working.ino (NOT 115200)
- CS_PIN 5 = ESP32 default VSPI CS; old code used bare SD.begin()
- Test 6 uses millis()-based filename + {"data":{...}} payload shape
- Firmware files are diagnostics only; production ESP32 firmware unchanged

## [2026-05-19] — Initial production state
### System
- App deployed on Ubuntu Server 24.04 at office
- Cloudflare Tunnel (seeme-db.com) HTTP routing
- TimescaleDB in Docker
- PM2 + Nginx
- Background alert worker cron every 5 mins
### Features Complete
- Dashboard with pond cards, sensor trends, system overview
- Per-pond and per-sensor charts (uPlot)
- Reports (PDF/CSV, date range, export all)
- Utilization page
- Notifications (alerts + maintenance)
- Threshold settings with audit log
- Admin console (user/pond CRUD)
- Ingestion logs
- Dark/light mode
- Remember me (30 days)
- Subscription/expiry model
- Sensor health status (Normal/Warning/Critical)
- Pond multi-select filter + compare mode
- Background alert worker (sensor + connectivity)
### Database
- 13 migrations applied
- 10 tables including hypertable, audit, subscription columns

## [2026-06-08] — Rewrite CLAUDE.md + add changelog rule
### Changed
- Rewrote CLAUDE.md to match current production state (live at seeme-db.com, 5-year nationwide PH license)
- Added CRITICAL rule: update CLAUDE.md + append CHANGELOG.md after every change
- Updated stack: NextAuth v5 JWT 30-day remember me, pg pool max:5, uPlot (never Recharts)
- Documented all 14 migrations, 10 tables, all current pages and API routes
- Added new routes: auth/precheck, auth/remember, auth/expiry, health, system/status, readings/compare
- Documented alert worker (sensor + connectivity), subscription model, deployment, chart behavior
### Files Modified
- CLAUDE.md
- CHANGELOG.md (created)
### Notes
- CRITICAL BEHAVIOR + RESPONSE FORMAT sections preserved verbatim, changelog rule appended
- Migration files now 001→014 (was documented as 010); 011 deprecates old status-logger job; 012 adds optimal_value; 013 subscription; 014 connectivity alerts
