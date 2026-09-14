# Changelog

## [2026-09-14] — Alerts eased: no re-nagging after acknowledge/ignore, instant popup, sustained-window sensor rule

### Changed
- **Root cause of "the alert keeps coming back":** acknowledging marked the row, but the *condition* was re-checked and a **new** row inserted — by `/api/ponds/status` on the next 30 s poll for any pond still offline, and by the worker every 5 min for a sensor still out of range. Acknowledging bought 30 seconds of quiet.
- **Re-alert cooldown (24 h)** in both the worker (`mayRaise`) and `/api/ponds/status`: the same pond + sensor is not raised again while an alert is open or was acknowledged within the cooldown. Verified: 2 polls → 1 alert per offline pond; acknowledge → 2 more polls → 0 new; acknowledgement aged past 24 h → raised again.
- **Popup suppression is per condition and per session.** Ignore *or* acknowledge records `pondId:sensor` in `sessionStorage`; that pond + sensor does not pop again in this tab even if the server raises a fresh row. New tab / new day starts clean. Replaces the per-alert-id `localStorage` list, which a re-raised row (new id) bypassed.
- **Popup is optimistic** — cards vanish on click; the POST and the three view refetches run in the background; a failure brings the card back with the reason. This is the "why is it slow" answer for the UI part: the button used to await the POST *plus* refetches of `/api/alerts/active`, `/api/alerts` and the unread count, each queued behind the saturated dashboard queries on the current Pi build. (The other part is the pending performance update.) `/notifications` acknowledge no longer awaits the refetches either.
- **Sensor alert rule is a sustained window:** every reading in the last 30 minutes out of range, minimum 7 readings — was "last 7 readings", i.e. under a minute at the gateway's cadence. Popup text now says so instead of the hardcoded "~1h 45m". **Sensor alerts auto-resolve** when a reading comes back in range (connectivity already did).
- **Ponds that have never sent a reading are not alerted on** (worker and status route) — no gateway, nothing to lose; still shown offline. On a site with one gateway and ten seeded ponds this alone removes nine permanent alerts.
- **`/api/ponds/status` reads the true last reading per pond** (LATERAL `ORDER BY time DESC LIMIT 1`, index-only backward scan) instead of "last reading in the past 25 minutes". The old window made a pond offline for an hour look identical to one that never sent data — the popup said "no data for an unknown duration" — and would have defeated the never-seen rule. `minutesSinceLastData` is now real for every pond.
- `AlertPopup` uses `useSyncExternalStore` for the mounted flag (the lint rule rejects setState in an effect).

### Files Modified
- src/components/AlertPopup.tsx, src/hooks/useAlerts.ts, src/app/notifications/page.tsx
- scripts/alert-worker.ts, src/app/api/ponds/status/route.ts
- CLAUDE.md

### Notes
- Not tested in a browser (dev license gate). The worker and status route were exercised against the dev DB: never-seen ponds skipped, a 30-minute-old acknowledgement respected, an aged one re-raised, EXPLAIN shows index-only scans.
- The 24 h cooldown and the 30 min / 7-reading window are constants at the top of `scripts/alert-worker.ts` (cooldown duplicated in the status route — keep them equal).

## [2026-09-14] — Maintenance requests removed from the appliance

### Changed
- **"Request Maintenance" is gone from the local dashboard**, along with the Maintenance Requests tab on `/notifications`, `/api/maintenance` (GET/POST/PATCH), `RequestMaintenanceButton`, and `useMaintenance`. A request filed on the Pi went into the Pi's own database where nobody at Soletronix could see it — the feature only makes sense on the main server, and the main server is not to be changed, so there is nothing to forward to.
- The read side is cleaned up with it rather than left showing a permanent 0: pond status is `online | stale | offline` (`getPondStatus(lastSeenMs, nowMs)` — the `hasMaintenance` argument is gone), `/api/ponds/status` no longer queries `maintenance_requests`, `/api/utilization` drops the maintenance interval merging and the `maintenance` bucket, the utilization page loses the "Most Maintenance" tile, the "Maint %" column, the legend entry and the two CSV columns, and the notification badge counts open alerts only (`{ total, alerts }`).
- `/notifications` is now a single alerts view with the same Status/Pond filters and acknowledge actions.
- `maintenance_requests` stays in the schema (migrations, FK to `owners`) but nothing reads or writes it.

### Files Modified
- src/app/api/maintenance/route.ts, src/app/api/maintenance/[id]/route.ts, src/components/RequestMaintenanceButton.tsx, src/hooks/useMaintenance.ts *(deleted)*
- src/app/notifications/page.tsx, src/app/dashboard/page.tsx, src/app/utilization/page.tsx
- src/app/api/notifications/unread-count/route.ts, src/app/api/ponds/status/route.ts, src/app/api/utilization/route.ts
- src/lib/pondStatus.ts, src/hooks/useAlerts.ts, src/hooks/useDashboardStats.ts
- CLAUDE.md, README.md

## [2026-09-14] — Cloud owner by signing in, not by UUID; pond import from the main server

### Changed
- **"Sign in with the site's seeme-db.com account"** on Settings → Appliance replaces remembering an owner UUID. `@/lib/cloudAccount` drives the main server's **existing** NextAuth credentials login (`/api/auth/csrf` → `/api/auth/callback/credentials` → `/api/auth/session`) — the same exchange its login page does — so nothing on the main server changes. The session's `id`/`name` become the cloud owner; `/api/ponds` (with the session) lists the account's ponds.
- **Pond import with "main server wins".** `POST /api/settings/cloud-connect` reconciles by `pond_code`: on both → local row updated from the main server (name, location, capacity, area, company) and reported; main only → created here; local only → reported as needing creation on the main server. Ponds without a code are listed as unsyncable.
- **Role handling:** viewer accounts are refused (cannot own ponds → sync could never match); admin accounts set the owner but skip the import, because `/api/ponds` returns every site's ponds for admins.
- Requires the main server reachable (503 with the reason otherwise); the form is disabled offline with "Requires internet connection…". Password is used for one round trip, never stored, never logged (verified by grepping the server log).
- Manual UUID entry stays as the offline fallback, now folded under "No internet? Enter the owner manually (admin)".
- `GET /api/settings/owner` reports `online`/`serverReachable` again (3 s probe, 30 s cache) so the page can enable/disable the sign-in form.
- `SYNC_OWNER_ID` in `.env` is now optional — an offline seed only.

### Files Modified
- src/lib/cloudAccount.ts *(new)*, src/app/api/settings/cloud-connect/route.ts *(new)*
- src/app/api/settings/owner/route.ts, src/lib/settings.ts (`Queryable`), src/app/settings/appliance/page.tsx
- .env.example, CLAUDE.md, README.md, docs/Pi-Deployment-Checklist.md

### Notes
- **Tested against the real main-server code:** the clone (`cloned main/`, b0c3b75) was run locally with its own database (owner/viewer/admin accounts with bcrypt passwords, ponds with `owner_id`, a second site's `PND-001` with NULL owner). Wrong password and unknown email → 401; viewer → 403; admin → owner set, no import, note; owner → id/name saved, `PND-001`/`PND-002` updated from the main server (Pond 1/Site → Main Pond A/North field/Bayside), `PND-030` created, `PND-003..010` reported local-only, the other site's `PND-001` **not** imported. A sync run afterwards landed readings for the three account ponds under the right owner and left `PND-003` waiting with its message.
- Success is judged by `/api/auth/session` returning a user, not by where the callback redirected — Auth.js redirect targets vary by version; the session route does not.
- `cloned main/` now has `node_modules` installed for this test; it is ignored by both repos.

## [2026-09-14] — Worker matched to the real sync receiver; one missing pond no longer blocks the site

### Changed
- **The real receiver is now known** (`cloned main/…/src/app/api/sync/route.ts`, commit b0c3b75) and mirrored verbatim into `src/app/api/sync/route.ts`. It answers `{ ok, inserted, skipped }` only; `inserted` counts duplicates; `skipped` = no pond for `(owner_id, pond_code)`; it matches `ponds.owner_id`, not `user_pond_access`.
- **Bug fixed before it shipped:** the worker treated a response without an `unknown` field as "old receiver, mark everything" — against the real receiver, a pond missing on the main server would have had its readings marked `synced_at` locally and lost. `postBatch` now reads `skipped` as "not on the server".
- **One missing pond no longer wedges sync.** The receiver does not say which rows it skipped, so on `skipped > 0` the worker probes one reading per pond code (a re-send is a free no-op), marks only the ponds the server has, and excludes the unknown codes from later batches this run. Result gains `unknownPonds`; the sidebar message names them. `pond_mismatch` is returned only when nothing could ship.
- Verified against the real receiver code on a second instance/database: ponds 1–2 under the owner synced while a console-style pond with NULL `owner_id` was isolated (`synced 3, 2 waiting — PND-003`); a repeat run marked nothing; after `UPDATE ponds SET owner_id` on the main side the 2 shipped; a wrong owner → `pond_mismatch`, nothing marked.

### Files Modified
- src/lib/sync.ts, src/app/api/sync/route.ts *(now a verbatim mirror)*
- CLAUDE.md, README.md, docs/Pi-Deployment-Checklist.md

### Notes
- **Two main-server DB prerequisites, per site — data, not code:** (1) `ponds.owner_id` must be set to the site's owner UUID for every pond that syncs (the admin console leaves it NULL — `UPDATE ponds SET owner_id = … WHERE pond_code = …`); (2) a unique index on `sensor_readings (pond_id, time)` must exist or `ON CONFLICT` makes every batch 500. Neither is in the main repo's migrations; both must be true on the live DB already if sync has ever worked there.
- The middleware change in b0c3b75 exempts `/api/sync` from the login redirect — that is why the live site answers 401 rather than a redirect.

## [2026-09-14] — Cloud owner is local-only; main server is never changed

### Changed
- **Decision: nothing on the main server changes, ever.** A clone of the live main server (`../cloned main/`, gitignored) confirmed it has no token-authenticated way to read owners or create ponds — `precheck` needs the owner's password and returns only ok/invalid/expired; pond creation is `/api/admin/ponds` behind a NextAuth admin session. The live site has `POST /api/sync` (answers 401 = exists, though it is *not* in the clone — the deployed receiver is ahead of the repo) and nothing else for this appliance.
- **Removed the two reference endpoints** (`src/app/api/sync/owner`, `src/app/api/sync/ponds`) and the worker's `registerPonds` / `lookupOwner` calls. They only made sense as additions to the main server.
- **Owner card is now entirely local.** The admin types the owner's *name* and *ID* (both required) after the local admin login; saved to `app_settings` with no remote verification and no reachability requirement. The card explains that a wrong ID is not data loss: the next sync stops with `pond_mismatch`, marks nothing, and the log now names the pond codes and owner involved.
- **Add Pond** copy and the checklist now say the same code must be created by hand under this site's account in the main server's admin console.
- `GET /api/settings/owner` no longer probes the main server (dropped `online`, `serverReachable`, `live`); `PUT` adds `name` (required).

### Files Modified
- src/lib/sync.ts, src/lib/settings.ts
- src/app/api/settings/owner/route.ts, src/app/settings/appliance/page.tsx, src/components/AddPondButton.tsx
- src/app/api/sync/owner/route.ts *(deleted)*, src/app/api/sync/ponds/route.ts *(deleted)*
- CLAUDE.md, README.md, docs/Pi-Deployment-Checklist.md, root .gitignore

### Notes
- Verified with the main server unreachable: GET shows the `.env` seed; PUT 401 anonymous, 400 without a name, 200 after admin login; `/api/sync/status` reports `configured: true` from the DB owner.
- Owners = users on the main server: one `owners` table (`id` = `SYNC_OWNER_ID`, `name`, `email`, `password_hash`, `role`, `expires_at`). The appliance's owner is the customer's login account.
- The previous commit briefly recorded `cloned main/i-pond-frontend` as an embedded-repo gitlink; removed here and the folder is ignored at the repo root.

## [2026-09-14] — Add ponds from the dashboard, license status page, cloud-owner panel with admin gate

### Changed
- **`POST /api/ponds` + "+ Add Pond"** on the dashboard (Pond Network header, and the empty state). Name required; `pond_code` auto-numbers to the next free `PND-###` after the highest in use, under a table lock so two operators cannot draw the same code; explicit codes are upper-cased and validated; 409 on a taken code. Verified: 7 request variants incl. auto/explicit/duplicate/bad-number.
- **Ingest accepts any positive `pnd` (1–9999)**, was hard-capped at 10. Without this an added pond could never receive data. Unknown codes still 404.
- **Ponds are created on the main server automatically before their readings ship.** The worker calls `POST {main}/api/sync/ponds` for every pond with pending readings, then sends the batch. Verified end to end against a second instance on a second database: 4 ponds created under the owner, 7 readings shipped, `unknown = 0`; second run creates nothing.
- **Cloud owner is now a runtime setting.** New `app_settings` table (migration 019). `getSyncOwner()` reads `sync_owner_id` from the DB first and `SYNC_OWNER_ID` from `.env` as the seed. Rationale: `.env` cannot be the store — `process.env` is fixed at start, standalone bakes it into the bundle, and a systemd `EnvironmentFile` overrides it anyway. `syncConfig(pool)` is async now; `/api/sync/status` and the worker both use it. Verified: after a change, sync ran under the new owner with no restart and the new pond was created under *that* owner on the main server.
- **`/settings/appliance` page** ("Appliance" in the sidebar): license card — client, days remaining, expiry, status — always visible (the ≤30-day banner is unchanged); cloud owner card — id, source (`.env` / set here), last confirmed name, live check, main-server reachability, and the change form.
- **Local admin gate for changing the owner** (`@/lib/adminSession`, `/api/admin/login|logout|session`): fixed credential `soletronix` / `Soletronix@pi2026`, timing-safe compare, HMAC-signed 8 h cookie, secret derived from `API_TOKEN`. Not main-server auth; guards nothing else. `PUT /api/settings/owner` also requires the main server reachable (503 otherwise, with the "Requires internet connection to verify with main server" message) and the owner to exist there (404) before saving.
- **Two additive main-server endpoints as reference copies** (nothing in the main repo is modified): `GET /api/sync/owner?id=` and `POST /api/sync/ponds`, both Bearer `SYNC_TOKEN`. Until they are deployed on seeme-db.com the appliance degrades gracefully — verified against a bare-404 server and an unreachable host: pond registration logs "main server has no /api/sync/ponds endpoint" and the run continues on the old `pond_mismatch` path; the owner panel shows the id with "name lookup not available" and disables the change form with the reason.

### Files Modified
- db/migrations/019_app_settings.sql *(new)*, src/lib/settings.ts *(new)*, src/lib/adminSession.ts *(new)*
- src/app/api/ponds/route.ts, src/app/api/send-sensor-data/route.ts
- src/lib/sync.ts, src/app/api/sync/status/route.ts
- src/app/api/sync/owner/route.ts *(new, main-server reference)*, src/app/api/sync/ponds/route.ts *(new, main-server reference)*
- src/app/api/settings/owner/route.ts *(new)*, src/app/api/admin/login|logout|session/route.ts *(new)*
- src/components/AddPondButton.tsx *(new)*, src/app/dashboard/page.tsx, src/components/MainLayout.tsx
- src/app/settings/appliance/page.tsx *(new)*
- .env.example, CLAUDE.md, README.md, docs/Pi-Deployment-Checklist.md

### Notes
- **Main server: nothing changed there, by request.** The only local clone (`5. github iPond/i-pond-frontend`) has no `/api/sync` route on any branch, so the deployed receiver's source is elsewhere. To get the seamless pond path and owner names, copy the two reference files into the main server's `src/app/api/sync/owner/route.ts` and `src/app/api/sync/ponds/route.ts` — no existing file is touched. `/api/sync/ponds` inserts `(owner_id, name, pond_code, location)`; if the main server's `ponds` table has other NOT NULL columns, add defaults there.
- `/api/license` already returned the full status unconditionally; item 5 needed no change.
- The hardcoded admin credential is in source (`adminSession.ts`) as specified. Anyone with the repo can read it; treat it as a convenience gate on a trusted LAN, not a secret.
- Dev-machine note: two `next dev` instances must not share one project directory — they corrupt each other's `.next/` and produce random HTML 404s. The second instance was run from a copy with a `node_modules` junction on the same drive.

## [2026-09-14] — Dashboard performance on the Pi: rollups, compression, fsync-free ingest

### Changed
- **Root cause of the "very slow" dashboard found and measured.** The gateway posts a reading every few seconds, and every dashboard chart was a `GROUP BY` over every raw row in its range, polled every 10 s, for four sensors, in **both** view modes at once (the page called `useMultiPondReadings` and `useCompareReadings` unconditionally — 8 queries per tick, 4 of which were never shown). With just 3 days x 3 ponds at 1 Hz (777k rows) on a desktop, compare-today took **363 ms** and 7d **483 ms** per query — ~3.4 s of DB time per 10-second tick before any Pi slowdown factor. The Pi was permanently saturated and grew slower every day.
- **Migration 017 — continuous aggregate `sensor_readings_15m`.** Per pond, per 15 minutes: `n`, and `sum/cnt/min/max` per sensor. Sum+count (not avg) so 1 h / 3 h / 6 h / 1 day buckets re-aggregate exactly. Real-time aggregation on; refresh policy every 5 min. Applied in ~1 s over 777k rows. Same queries now: **10 ms and 3 ms**, 0 mismatched buckets against the raw query over 73 hourly buckets (avg to 4 dp, min, max, count).
- **Migration 018 — compression** of `sensor_readings` chunks older than 30 days (`segmentby pond_id`, `orderby time DESC`). Test chunk: 3.9 MB -> 224 kB. Verified the sync worker's `UPDATE ... synced_at` works on compressed rows, the unique index still rejects duplicates, and the partial `unsynced` index still sees them.
- **`/api/readings` and `/api/readings/compare` read the rollup** for every range except Today-single-pond. Today-single-pond is now **1-minute averages** from raw (<= 1440 points) instead of raw rows with `LIMIT 5000` — at 1 Hz the old query silently stopped at ~01:20 and uPlot was asked to draw tens of thousands of points. The `since` incremental poll re-sends the last (still filling) bucket and `useReadings` replaces it instead of appending a duplicate x. New `@/lib/rollup` holds the SQL fragments.
- **Anomaly count semantics changed** (disclosed, not hidden): it is now counted at 15-minute resolution — a 15-minute bucket whose average is out of range contributes all its readings. This is the rule the health colour already used, so the tooltip's count and colour now always agree; a single spike inside a normal quarter hour is no longer counted.
- **Dashboard polls only the visible view mode** — `active` flag on both hooks; the parked set keeps its cache. `/api/ponds` polled every 60 s instead of 10 s. Pool `max` 5 -> 8.
- **Ingest is one transaction, `SET LOCAL synchronous_commit TO off`.** Was three autocommit INSERTs, i.e. three WAL fsyncs on USB flash per reading, with every dashboard query queuing behind them on the shared pool. Heartbeat rows (`pond_status_log`) throttled to one per pond per 60 s — /utilization's finest distinction is a 20-minute gap, so per-reading heartbeats were 60x the writes for zero information. Verified: 3 POSTs -> 3 readings, 1 heartbeat, 3 log rows; failures still logged.
- **Postgres tuned in `docker-compose.yml`** — confirmed on the dev container: 128 MB shared_buffers, 5-min checkpoints, sync commit on, `random_page_cost=4`. The image *would* run timescaledb-tune on first boot, but that script sits in `/docker-entrypoint-initdb.d`, the directory our migrations mount replaces — so every appliance built from this compose file has been running stock defaults. Now: 1 GB shared_buffers, 3 GB effective_cache_size, `synchronous_commit=off`, 15-min checkpoints, `max_wal_size=2GB`, `wal_compression=on`, `random_page_cost=1.1`, `log_checkpoints=on`. Flags verified to boot on a throwaway container.
- **Log retention** — `ipond_prune_logs` daily job (017): `ingestion_logs` 30 days, `pond_status_log` 120 days. `sensor_readings` is never pruned.
- **`scripts/deploy.sh`** — build + copy `public/`, `.next/static/`, `.env`, `license.json` into the bundle + restart via systemd `ipond` or PM2 `ipond-local`, whichever exists. Prints the newest migration number.
- **First-boot bug fixed: `run_remaining.sh` moved from `db/migrations/` to `db/`.** The Postgres entrypoint executes every `*.sh` in the init directory. Found while testing a fresh container: all 18 migrations ran, then the entrypoint ran `run_remaining.sh`, which died on "no .env" and aborted initialisation — the container exited. Under compose's `restart: unless-stopped` it came back (PGDATA already initialised, migrations already applied), so a fresh Pi would have "worked" after one silent crash; under plain `docker run` it stayed dead. Fresh-boot test now: container up, 0 SQL errors, seed OK, rollup + 3 jobs + compression present.

### Files Modified
- db/migrations/017_continuous_aggregate.sql *(new)*, db/migrations/018_compression.sql *(new)*
- docker-compose.yml
- src/app/api/send-sensor-data/route.ts
- src/app/api/readings/route.ts, src/app/api/readings/compare/route.ts, src/lib/rollup.ts *(new)*
- src/hooks/useApi.ts, src/app/dashboard/page.tsx, src/lib/db.ts
- scripts/deploy.sh *(new)*, db/run_remaining.sh *(moved from db/migrations/)*
- CLAUDE.md, README.md, docs/Pi-Deployment-Checklist.md

### Notes
- **The 268-second checkpoint in the Pi notes is not evidence of a slow drive.** Postgres spreads checkpoint writes over `checkpoint_completion_target x checkpoint_timeout` = 0.9 x 300 s ~ 270 s *by design*; `write=268s` for 600 buffers is the checkpointer pacing itself. The `sync=` figure is the one that shows fsync latency. The flash may still be slow, and the tuning above helps either way, but the slowness was the queries.
- **Caught during verification:** the first rollup version returned 289 buckets for every range — `GROUP BY bucket` resolved to the view's own `bucket` column, not the output alias. Postgres prefers input columns for GROUP BY and output columns for ORDER BY, so the result was sorted and plausible-looking but at 15-minute resolution. Now positional; rule added to CLAUDE.md.
- **Existing Pi needs three one-time steps after `git pull`:** `docker compose up -d` (picks up the tuned config), `./db/run_remaining.sh 017`, then `./scripts/deploy.sh`. Order matters: 017 must exist before the new app starts or every chart 500s on a missing view.
- **Not tested in a browser this time:** the dev `license.json` no longer verifies against the production key embedded in f73924d, so the layout gate blocks every page locally. API payload shapes are unchanged and `tsc` is clean.
- **Flagged, not changed:** the reports page's raw export (`/api/readings/raw` `LIMIT 50000`, `/api/readings/all` `LIMIT 100000`) silently truncates at per-second cadence — 50k rows is ~14 hours — and the page never shows the `truncated` flag. A per-reading PDF of a week is not viable at this cadence anyway; the export should probably move to 1-minute averages from the rollup. Also the popup's "(~1h 45m of abnormal data)" text assumes 15-minute readings; 7 consecutive readings is now under a minute.

## [2026-09-14] — Fix: Acknowledge did nothing on a database with no owner row

### Changed
- **`getOperatorId()` is self-healing.** If the `owners` table is empty it now creates the seed's operator row (`00000000-…-0001`, "Local Operator") on first use, `ON CONFLICT DO NOTHING`. Previously it *returned* that UUID without checking it existed, and every write that stamps it — alert acknowledge (single and all), maintenance request POST/PATCH, threshold PATCH — failed with `violates foreign key constraint "sensor_alerts_acknowledged_by_fkey"` → 500.
- **Failures are now visible.** The popup and the notifications page showed a spinner, then nothing, because the `catch` only wrote to the browser console. Both now show a red message ("Could not acknowledge — the server rejected it…") so a failing request looks like a failing request.

### Files Modified
- src/lib/operator.ts, src/components/AlertPopup.tsx, src/app/notifications/page.tsx, CLAUDE.md

### Notes
- Reported as "click Acknowledge, it loads, the popup is still there". Reproduced by emptying `owners`: acknowledge → 500 with the FK error in the server log, nothing in the UI. After the fix on the same empty table: 200, operator row auto-created, maintenance POST also works, and running `002_local_appliance.sql` afterwards is a no-op.
- This is the likely state of any Pi whose database was built with `run_remaining.sh` and seeded by hand rather than with `002_local_appliance.sql`. No action needed there now — the row is created on the next write.

## [2026-09-14] — Firmware receive path restored, alert Ignore/Acknowledge all, sync hardening

### Changed
- **`esp32_iotgateway_new_soletronix_Serial.ino`** rewritten around the receive path from `esp32_iotgateway_old_code_working.ino`, copied verbatim: `Serial2.readString` → `trim` → `{}` extract → `length > 10` → `deserializeJson(jsonDoc, val)` → `deserializeToJSON` → `delay(200)` → `printToLCD` (old cursor layout, "Json Parse Success") → `delay(5000)` → `rtc.read()`, plus the `P1` branch. The previous serial build had changed several of these (parsed the extracted substring, dropped the 5 s hold, different LCD layout). Only the send changed: the SD-card and Wi-Fi block is replaced by `sendToPi()`, which does the old firmware's second parse of the extracted JSON and its exact `sprintf` of `{"data":{...}}`, then `Serial.println`s it. All SD/FS/SPI/WiFi/HTTP includes, credentials, the API token and 280 lines of SD helpers are gone. The old firmware's `Serial.println(val)` raw echo is removed — USB Serial is now the data link and anything starting with `{` is a reading.
- **Alerts: Ignore all / Acknowledge all.** Popup header gets both; each card gets Ignore + Acknowledge. *Acknowledge* is server-side; *Ignore* is this-browser-only — the alert stays open on the server, still counts in the bell badge, still shows as active in `/notifications`. Ignored ids persist in `localStorage` and are pruned against the live list, so a reload does not nag and a re-triggered alert still pops.
- **`/notifications` → Sensor Alerts can now acknowledge** — per-row buttons and an "Acknowledge all" above the table. Before this the popup was the *only* place an alert could be acknowledged, so "ignore" would have stranded alerts with no way to clear them.
- **`POST /api/alerts/acknowledge-all`** — one idempotent UPDATE. **`refreshAlertViews()`** in `useAlerts` pokes the alert list AND the badge; both acknowledge paths call it.
- **Sync — three real problems fixed:**
  1. `/api/sync/status` reported `configured: true` on `SYNC_TOKEN` alone, so the dashboard showed an enabled Sync button while the worker refused with `not_configured` for a missing `SYNC_OWNER_ID`. Now `syncConfig()` checks both and the sidebar names what is missing.
  2. One reading on a pond with no `pond_code` wedged sync permanently: the receiver 400s the whole batch, and time-ordered batching retried the same batch every run. `fetchBatch` now INNER JOINs ponds and requires a code; such rows stay pending, are counted (`countUnsyncable`) and shown in the sidebar, and everything else ships. Verified: 2 bad rows left behind, 2 good rows shipped, previously 0 shipped.
  3. On a Pi with no internet — the normal case — `/api/sync/status` waited two 8 s probes before the sidebar could say "no internet". Status now probes with a 3 s timeout. Failure toasts stay until the next attempt instead of fading after 6 s.
- **`/api/ponds/status` alert spam fixed.** Migration 010 dropped the unique index on open alerts (deliberately, so sensor alerts re-fire after acknowledgement), which left this route's `ON CONFLICT DO NOTHING` conflicting on nothing. Every dashboard load and every 30 s poll inserted a fresh connectivity alert per offline pond. Now guarded with `NOT EXISTS (... acknowledged_at IS NULL)`, the same check the worker uses. Verified: 5 polls → count unchanged; after acknowledgement exactly one re-alert per pond, then stable. It also now records the real offline gap (`-1` = never) instead of a hardcoded `0`, so the popup no longer says "0 minutes".

### Files Modified
- esp32_iotgateway_new_soletronix_Serial.ino
- src/components/AlertPopup.tsx, src/app/notifications/page.tsx, src/hooks/useAlerts.ts
- src/app/api/alerts/acknowledge-all/route.ts *(new)*
- src/app/api/ponds/status/route.ts
- src/lib/sync.ts, src/app/api/sync/status/route.ts, src/components/SyncStatus.tsx
- CLAUDE.md

### Notes
- **The alert spam was found by accident.** The first end-to-end test of "Ignore all" kept re-showing the popup; instrumenting it showed the server had 52 open alerts while the popup had fetched 42 — ten connectivity alerts had been minted *during that page load* by the status poll. That is by-design behaviour for genuinely new alerts, but the count was climbing on every poll, which led to the missing index. On a real site with one gateway offline this would have produced hundreds of alerts per hour.
- Verified in a real browser (Playwright): popup shows both buttons; Ignore all hides it, badge still counts them, hidden after reload and on `/notifications`; per-row acknowledge drops the count by one; Acknowledge all → 0 open and the badge clears immediately.
- **Firmware compiled** in the Arduino IDE: 264,276 bytes (20 % flash), 13,160 bytes (4 % RAM), no errors. Moved into `esp32_iotgateway_new_soletronix_Serial/` because the IDE requires the sketch folder to match the sketch name. `DynamicJsonDocument(200)` → `JsonDocument` (ArduinoJson 7 deprecation; the old firmware had the same construct; behaviour identical for the sensor board's ~80-byte payload). The `LiquidCrystal_I2C` "all architectures" warning is benign. Not yet flashed — watch `sudo journalctl -u ipond-serial -f` for `-> 201` on the first gateway before rolling out.
- **Still on the main server:** the `unknown` field in the `/api/sync` response (so the Pi never marks rows the server could not place), and the `compare` route `$3` fix.

## [2026-09-14] — USB gateway follow-through: sync contract, listener hardening, compose consolidation

Review of commit `f73924d` (USB-wired ESP32), fixing what the switch left inconsistent.

### Changed
- **Sync receiver brought to the production contract.** `src/app/api/sync/route.ts` now accepts `{ time, owner_id, pond_code, … }` and resolves `(owner_id, pond_code)` → `ponds.id` in SQL, matching the receiver on seeme-db.com. Before this the worker in this repo sent a payload the receiver in this repo rejected with `400 invalid_pond_id`.
- **Receiver reports `unknown` and `duplicate` separately** (plus `skipped` = their sum for older clients). A duplicate is already on the server and safe to mark; an unknown `(owner, pond_code)` is not on the server at all.
- **Worker refuses to lose data.** `runSync` now (a) fails closed with `not_configured` when `SYNC_OWNER_ID` is missing or not a UUID, and (b) when the server reports `unknown > 0`, marks nothing from that batch and returns the new reason `pond_mismatch`. Previously a wrong owner id produced `synced N, 0 pending` while the server had inserted nothing — silent, permanent loss. Verified: wrong owner now leaves every row pending; correcting it ships them.
- **`scripts/serial-listener.js` hardened.** Exits on port `close` so systemd's `Restart=always` re-opens the port after an unplug (before, it stayed alive and deaf). Loads `.env` like the other scripts. Waits for in-flight POSTs before exiting. `SERIAL_PORT=-` reads stdin so the whole pipeline can be tested without hardware. Uses Node's `readline` on the serial Duplex directly, so `@serialport/parser-readline` was dropped. `npm run serial-listener` added.
- **`/api/readings/compare` fixed for `range=today`** — the dashboard's default range. The today query never referenced `$3`, so Postgres failed with `could not determine data type of parameter $3` and the route returned 500. Same bug you found on the main server; same fix applies there.
- **One compose file.** The root `docker-compose.yml` from `f73924d` is now the canonical config (`ipond-timescaledb`, db `ipond`, bind-mounted data) but moved to `i-pond-frontend/docker-compose.yml` so `${…}` interpolation reads the app's `.env`; the root copy is deleted. Password comes from `.env`, migrations are mounted for first-boot auto-run, `DB_DATA_PATH` is configurable, and 5432 is bound to `127.0.0.1` only.
- **`run_remaining.sh`** made generic: reads user/db from `.env`, takes an optional start number, iterates whatever files exist.
- **`.env.example`**: `SERIAL_PORT`, `SYNC_OWNER_ID`, `DB_DATA_PATH`; database renamed `ipond`; `API_TOKEN` guidance updated (the gateway no longer carries it).
- **Docs**: checklist §11 rewritten for USB (by-id device path, `dialout` group, `ipond-serial` systemd unit, unplug test, stdin test), every `docker exec` corrected to the real container/db names, troubleshooting entries for the listener and `pond_mismatch`. README and CLAUDE.md updated to match.

### Files Modified
- src/app/api/sync/route.ts, src/lib/sync.ts, src/app/api/sync/trigger/route.ts
- src/app/api/readings/compare/route.ts
- scripts/serial-listener.js, db/migrations/run_remaining.sh
- docker-compose.yml *(rewritten; root copy deleted)*, .env.example, .gitignore, package.json, package-lock.json
- docs/Pi-Deployment-Checklist.md, README.md, CLAUDE.md

### Notes
- **Verified end to end.** Listener: fed the exact bytes the firmware prints (CRLF, `%.2f` floats, ESP32 boot-loader garbage, junk, a `pnd` out of range) → 2 readings landed in the DB, garbage skipped, bad pond rejected 400, exit 0 — and exit 0 with a clear message when the app is down. Receiver: correct owner → `inserted 1`; re-send → `duplicate 1`; wrong owner → `unknown 1`; old `pond_id` payload → `400 invalid_owner_id`; microseconds preserved. Worker: no `SYNC_OWNER_ID` → refuses; wrong owner → `pond_mismatch`, rows stay pending; correct owner → ships. Compare route `range=today` → 200.
- **Reproduced the same libuv crash-on-exit in the listener that the sync worker had** (exit 127 after a fetch teardown on Windows); fixed the same way. Most likely Linux-only-benign, but the exit code contract matters for systemd.
- **On the Pi that already runs the root compose file:** Docker Compose names its project after the directory, so `docker compose up -d` from `i-pond-frontend/` will refuse to start because `ipond-timescaledb` already belongs to the `ipond-local` project. Data is a bind mount at `/mnt/ipond-data`, so it survives. One-time migration: `cd /home/pi/ipond-local && docker compose -p ipond-local down` (stops and removes only the container), then `cd i-pond-frontend && docker compose up -d`. Make sure `POSTGRES_PASSWORD` in `.env` is the password the database was created with — the container reads it on first init only, and the data directory is already initialised.
- **The committed password is still in history.** `f73924d` contains the `POSTGRES_PASSWORD` value in plaintext in the root `docker-compose.yml`. Removing it from the file does not remove it from git. Treat it as burned once the repo has a remote, or rewrite history before pushing.
- **For the production receiver on seeme-db.com:** add `unknown` (rows whose `(owner_id, pond_code)` did not resolve) to its response. Until it does, the Pi falls back to the old behaviour on that receiver — it will mark rows the server skipped, with only a log warning to show for it. The SQL in this repo's route is drop-in.
- Local `license.json` no longer validates (`bad_signature`) — expected, it was signed with the previous dev key. Dev machines need a licence signed with the new key.
- `esp32_iotgateway_new_soletronix.ino.DEPRECATED_NO_WIFI` and `esp32_iotgateway_old_*.ino` remain in the repo as reference.

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
