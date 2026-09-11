# Admin Guide

**For System Administrators** — Soletronix iPond, the IoT Aquaculture Monitoring System.

## Table of Contents

1. [Admin Overview](#1-admin-overview)
2. [User Management](#2-user-management)
3. [Pond Management](#3-pond-management)
4. [Ingestion Logs](#4-ingestion-logs)
5. [Notifications](#5-notifications)
6. [Threshold Settings](#6-threshold-settings)
7. [Utilization Page](#7-utilization-page)
8. [Alert System](#8-alert-system)
9. [System Status](#9-system-status)

---

## 1. Admin Overview

System administrators are the highest privilege role in Soletronix iPond. An admin can see and edit every pond, every user, every alert, and every log. Owners and viewers are scoped to the ponds your administrator has assigned them through the `user_pond_access` table.

### Admin Capabilities

- Create, edit, suspend, or delete users (admin, owner, or viewer roles).
- Create, edit, or delete ponds and assign them to one or more users.
- Read the ingestion log: every ESP32 POST is recorded with HTTP status, IP, and raw payload.
- Acknowledge and resolve maintenance requests; view the full alert history.
- Set or override threshold ranges for any pond; the audit log captures every change.
- Review the utilization page across all ponds and all users.

### What Admins Cannot Do

Admins cannot impersonate other users to write data on their behalf, cannot delete ingestion log rows from inside the application (they are append-only by design), and cannot edit the ESP32 firmware from the dashboard.

> 📷 *Screenshot: Admin home dashboard*

---

## 2. User Management

Open `/admin` and choose the **Users** tab to manage user accounts. Each user has an email (unique), display name, optional company name, role, and the set of ponds they can access.

### Roles Explained

| Role | What it sees | What it can do |
|---|---|---|
| **admin** | Everything across all ponds. | Full CRUD on users, ponds, thresholds; reads logs, alerts, maintenance. |
| **owner** | Only ponds assigned via `user_pond_access`. | Reads dashboard data, edits thresholds for owned ponds, submits maintenance requests. |
| **viewer** | Only ponds assigned via `user_pond_access`. | Reads dashboard data only. Cannot submit maintenance requests. |

### Adding a User

- Click **Add User**. Enter name, email, optional company, role, and an initial password.
- The password is hashed with `bcryptjs` before being stored in `owners.password_hash`.
- Tick the checkboxes next to ponds to grant access; the form writes `user_pond_access` rows on save.
- Email comparison is case-insensitive on login (a unique index on `LOWER(email)` enforces uniqueness).

### Editing or Deleting a User

Use the pencil icon to edit a user; you can change name, company, role, and pond access. Use the trash icon to delete a user — the database cascades deletions of their `user_pond_access` rows but preserves audit references via `ON DELETE SET NULL`.

> 📷 *Screenshot: User management page with Add/Edit dialog*

---

## 3. Pond Management

Open `/admin` and choose the **Ponds** tab to manage pond records. Every physical pond in the field needs a row here before its ESP32 can stream data.

### Pond Codes

Each pond has a unique code in the form `PND-001` through `PND-010`. The ESP32 firmware sends an integer in the `pnd` field; the ingest route translates `1..10` into `PND-001..PND-010` and looks up the row. The endpoint `/api/admin/ponds/next-code` suggests the next free code so you do not collide with existing ones.

### Pond Fields

- **Pond code** (auto-suggested, must be unique).
- **Name** (human-readable, e.g. "Maluso Bay #3").
- **Company name** (optional, for multi-tenant displays).
- **Location** (text).
- **Capacity** (cubic meters or your chosen unit).
- **Area** (square meters).

### Removing a Pond

Deleting a pond cascades deletes its readings (via `ON DELETE CASCADE` on `sensor_readings.fk_sensor_readings_pond`), its thresholds, alerts, status logs, and maintenance requests. **Export the data first if you need to keep history.**

> 📷 *Screenshot: Pond management form with code, name, capacity*

---

## 4. Ingestion Logs

Open `/admin/logs` to inspect every ESP32 POST to `/api/send-sensor-data`. The page lists rows from the `ingestion_logs` table in descending time order.

### Reading a Row

- **Received At** — server timestamp at the moment the POST was processed.
- **Pond** — `pond_code` resolved from the payload (blank if the pond did not exist).
- **HTTP Status** — `201` on success; `400`/`401`/`404`/`500` on various failure modes.
- **IP Address** — taken from `X-Forwarded-For` or `X-Real-IP`, useful to identify which gateway hit the server.
- **Error Message** — short tag like `invalid_payload`, `pond_out_of_range`, `unknown_pond`, `db_error`.
- **Raw Payload** — the JSON body the ESP32 sent, stored as `JSONB`.

### Filtering and Exporting

Use the filter bar to limit by pond, by HTTP status, or by date range. The **Export CSV** button downloads the current filter as a comma-separated file for offline analysis. Use this when you need to diagnose a flaky gateway.

> 📷 *Screenshot: Ingestion logs page with filters and table*

---

## 5. Notifications

Open `/notifications`. The page has two tabs: **Maintenance Requests** and **Sensor Alerts**. The header bell shows the total unread count.

### Maintenance Requests

Owners submit requests via the **Request Maintenance** button. Each request lands in the **Pending** state and shows pond, requester, message, and timestamp.

- Click **Acknowledge** to mark the request as seen. The status becomes **Acknowledged** and the pond keeps its blue Maintenance dot.
- Click **Resolve** to mark it fixed. You can attach an `admin_note` explaining what you did. The pond's blue dot disappears immediately on the next status poll.

### Sensor Alerts

The Sensor Alerts tab lists rows from `sensor_alerts`. Each row shows pond, sensor, the value that triggered, the optimal range at trigger time, and the consecutive count (always **7** in the current configuration).

- Click **Acknowledge** to silence the alert. The alert engine will only fire a new alert for the same pond/sensor combination after another 7 consecutive out-of-range readings.
- Alerts cannot be deleted, only acknowledged — the table is an append-only audit log.

> 📷 *Screenshot: Notifications page showing both tabs*

---

## 6. Threshold Settings

Thresholds drive the alert engine and the anomaly count on charts. Open `/settings/thresholds`. Admins can edit any pond; owners can only edit ponds they own.

### Editing a Threshold

- Pick a sensor (`temperature`, `pH`, `salinity`, or `dissolved_oxygen`).
- Enter `optimal_min` and `optimal_max` — min must be strictly less than max.
- Pick which ponds to apply to — bulk update is supported.
- Save. The PATCH writes an audit row for every affected pond before upserting.

### Audit History

`GET /api/thresholds/history?pond=N&sensor=X` returns the audit trail. The dashboard exposes this as a small **History** link per row. Use it to debug "why did this alert fire?" by checking whether the range was changed recently.

> 📷 *Screenshot: Threshold edit page with bulk-update selector*

---

## 7. Utilization Page

Open `/utilization`. Pick the ponds you want to compare, the from and to dates, and the page renders a stacked-bar chart showing what percentage of each pond's time was **Online**, **Stale**, **Offline**, or in **Maintenance**.

### How Percentages Are Computed

Utilization is derived from the `pond_status_log` table. Every successful ESP32 ingest writes one heartbeat row. The `/api/utilization` endpoint looks at the gaps between consecutive heartbeats inside the window and classifies them: gap below 60 seconds is **Online**, below 180 seconds is **Stale**, otherwise **Offline**. Maintenance intervals (from `maintenance_requests`) override every other status — those minutes are counted as **Maintenance**.

Maintenance time always wins over heartbeat-derived time so the same wall-clock minute is never double-counted. Percentages are computed from raw minutes (never rounded display values), so the four numbers always sum to 100% unless the pond has zero history in the window.

### Range Limits and Export

- Maximum window: **90 days**. Larger windows return an error.
- Use pond IDs (comma separated), the literal `"all"`, or `"mine"` in the API.
- Export CSV from the page header for offline reporting.

> 📷 *Screenshot: Utilization stacked-bar chart and date picker*

---

## 8. Alert System

### Trigger Logic

Implemented in `src/lib/alerts.ts`. The function `runAlertChecks` is called from `/api/send-sensor-data` after every successful ingest. For each non-null sensor value:

- Load `optimal_min` and `optimal_max` from `pond_sensor_thresholds` for that `(pond, sensor)`.
- Pull the last 7 readings for that sensor on that pond, ordered DESC.
- If all 7 are below min or all 7 are above max, attempt to create an alert.
- If an unacknowledged alert already exists for that `(pond, sensor)`, do nothing (avoids spam).
- Otherwise insert a new `sensor_alerts` row and the popup appears on next dashboard poll.

### Re-trigger Behaviour

Migration `010` removed the strict one-active-alert constraint and replaced it with a non-unique index on unacknowledged rows. After you acknowledge an alert, the next time 7 consecutive bad readings come in, a new alert is created. This prevents silent failure on long-running issues.

> 📷 *Screenshot: Alert detail with triggered_at, consecutive_count, and Acknowledge button*

---

## 9. System Status

System Status on the dashboard tells you the platform's health at a glance. Each pond contributes its own status as derived by `getPondStatus()` in `src/lib/pondStatus.ts`, and the aggregator is documented below.

| Aggregate | Meaning |
|---|---|
| **Healthy** | Every pond reporting is Online (last seen < 1 minute). |
| **Degraded** | At least one pond is Stale (last seen 1-3 minutes). |
| **Offline** | Every pond is Offline or no pond has reported recently. |

Maintenance does not by itself flip System Status to Degraded — it only flips the affected pond's individual dot. This avoids alarming admins when a planned outage is scheduled.
