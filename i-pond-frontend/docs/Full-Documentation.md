# Full Documentation

**End-to-End System Reference** — Soletronix iPond, the IoT Aquaculture Monitoring System.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Features](#2-features)
3. [User Roles](#3-user-roles)
4. [Pages Reference](#4-pages-reference)
5. [API Reference](#5-api-reference)
6. [Database Schema (Summary)](#6-database-schema-summary)
7. [Alert System](#7-alert-system)
8. [Utilization System](#8-utilization-system)
9. [Notification System](#9-notification-system)
10. [ESP32 Integration](#10-esp32-integration)

---

## 1. System Overview

Soletronix iPond connects ESP32 gateways in the field to a TimescaleDB-backed Next.js web application. Below is the data flow from sensor to screen.

```
  ┌─────────────────┐    HTTPS POST     ┌────────────────────────┐
  │  ESP32 Gateway  │ ────────────────▶ │  /api/send-sensor-data │
  │  (firmware)     │   Bearer token    │  (Next.js route)       │
  └─────────────────┘                   └──────────┬─────────────┘
                                                   │
                                                   ▼
                              ┌────────────────────────────────────┐
                              │  sensor_readings (TimescaleDB)     │
                              │  ingestion_logs                    │
                              │  pond_status_log (heartbeat)       │
                              │  sensor_alerts (alert check)       │
                              └────────────────────┬───────────────┘
                                                   │
                                                   ▼
                              ┌────────────────────────────────────┐
                              │  Next.js API routes                │
                              │  (auth-scoped reads)               │
                              └────────────────────┬───────────────┘
                                                   │
                                                   ▼
                              ┌────────────────────────────────────┐
                              │  React 19 dashboard                │
                              │  SWR polling + uPlot canvas        │
                              └────────────────────────────────────┘
```

---

## 2. Features

- Real-time multi-pond dashboard with status dots, live tiles, and pond grid.
- Per-pond and per-sensor detail views with canvas-based **uPlot** charts.
- Time-range presets: Today (5-minute buckets), 7d (1h), 14d (2h), 30d (6h), 1y (1d).
- Append-only Today mode that streams new points without re-fetching the full window.
- Trend arrows (rising / falling / stable) and per-bucket anomaly counts.
- Threshold-driven alert engine that fires after **seven consecutive** out-of-range readings.
- Maintenance request workflow: owners submit, admins acknowledge and resolve.
- Notifications hub merging maintenance requests and sensor alerts with a header bell.
- Per-pond, per-sensor optimal range configuration with audit log.
- Utilization report deriving online / stale / offline / maintenance percentages from heartbeats.
- Ingestion log with HTTP status, IP address, and raw payload for every ESP32 POST.
- PDF (jsPDF) and CSV export with date range, pond, and sensor pickers.
- Light and dark theme via `next-themes`.
- Multi-tenant role model: **admin**, **owner**, **viewer**.
- Tab-visibility-aware polling that pauses refreshes when the tab is hidden.

---

## 3. User Roles

| Role | Access |
|---|---|
| **admin** | All ponds, all users, all logs, ingest audit, threshold audit, maintenance acknowledgement and resolution, alert history, system health, utilization. |
| **owner** | Only assigned ponds. Reads readings and alerts, edits thresholds, submits maintenance requests, exports data. |
| **viewer** | Only assigned ponds. Reads everything, cannot submit maintenance requests or edit thresholds. |

---

## 4. Pages Reference

| URL | Access | Purpose |
|---|---|---|
| `/` | any | Redirects to `/dashboard` or `/login` depending on session. |
| `/login` | anonymous | Credentials login; redirects logged-in users to `/dashboard`. |
| `/dashboard` | any signed-in | All-ponds overview, system status, pond cards. |
| `/dashboard/[pondId]` | owner / admin | Per-pond detail: header, four-sensor chart strip. |
| `/dashboard/[pondId]/[sensorType]` | owner / admin | Sensor deep-dive: full chart, summary, optimal range shading. |
| `/reports` | any signed-in | Export center: PDF and CSV by date range and pond set. |
| `/utilization` | any signed-in | Online/stale/offline/maintenance breakdown. |
| `/notifications` | any signed-in | Maintenance request and sensor alert tabs. |
| `/settings/thresholds` | owner / admin | Per-pond optimal range editor with audit log. |
| `/admin` | admin | User and pond CRUD. |
| `/admin/logs` | admin | Ingestion log viewer with filter and CSV export. |

---

## 5. API Reference

### 5.1 Ingestion

| Method / Path | Auth | Body / Query | Response |
|---|---|---|---|
| `POST /api/send-sensor-data` | Bearer `API_TOKEN` | `{ data: { pnd, rtd, ph, sal, dox } }` | `201 { ok: true }` on success; `400 invalid_payload`; `401 unauthorized`; `404 unknown_pond`; `500 db_error`. |

### 5.2 Authentication

- `GET/POST /api/auth/[...nextauth]` — next-auth handlers (signin, callback, signout, session).

### 5.3 Ponds and Status

| Method / Path | Description |
|---|---|
| `GET /api/ponds` | Returns ponds scoped to the session user. Admins see every pond. |
| `GET /api/ponds/status` | Returns `{ pondId, status, hasMaintenance, lastSeen, minutesSinceLastData }` per pond. Status follows `getPondStatus()`. |
| `GET /api/dashboard/stats` | System health: counts of online/stale/offline ponds and active sensors. |

### 5.4 Readings

| Method / Path | Query | Description |
|---|---|---|
| `GET /api/readings` | `sensor, range, pond?, since?` | Aggregated time-series, with per-bucket avg/min/max/anomalyCount/trend (`range != today`). Today returns raw 5-minute buckets or raw points if pond is set. |
| `GET /api/readings/latest` | `pond=N` | Latest reading per pond (for tile values). |
| `GET /api/readings/raw` | `sensor=X&pond=N` | Raw points for one sensor on one pond. |
| `GET /api/readings/all` | `ponds=&from=&to=` | Multi-pond export rows: one row per reading. Used by `/reports` CSV. |

### 5.5 Thresholds

| Method / Path | Description |
|---|---|
| `GET /api/thresholds?pond=N` | Returns per-sensor optimal ranges for one pond. |
| `PATCH /api/thresholds` | Body `{ sensor, optimal_min, optimal_max, ponds: [n] }`. Bulk upsert + audit row per pond. |
| `GET /api/thresholds/history?pond=N&sensor=X` | Audit history of threshold changes for one `(pond, sensor)`. |

### 5.6 Alerts

| Method / Path | Description |
|---|---|
| `GET /api/alerts` | Full alert history. Admin only. |
| `GET /api/alerts/active` | Unacknowledged alerts visible to the session user. |
| `POST /api/alerts/[id]/acknowledge` | Marks one alert as acknowledged. |

### 5.7 Maintenance

| Method / Path | Description |
|---|---|
| `GET /api/maintenance` | Maintenance requests scoped to the session user. |
| `POST /api/maintenance` | Submit a new request (admin or owner). Viewers are forbidden. |
| `PATCH /api/maintenance/[id]` | Acknowledge or resolve. Admin only. |

### 5.8 Notifications and Utilization

| Method / Path | Description |
|---|---|
| `GET /api/notifications/unread-count` | Header bell badge count. |
| `GET /api/utilization?ponds=&from=&to=` | Stacked-bar percentages. `ponds` accepts comma-separated ids, `"all"`, or `"mine"`. 90-day max range. |

### 5.9 Admin

| Method / Path | Description |
|---|---|
| `GET/POST /api/admin/users` | List or create users. |
| `PATCH/DELETE /api/admin/users/[id]` | Update or delete a single user. |
| `GET/POST /api/admin/ponds` | List or create ponds. |
| `PATCH/DELETE /api/admin/ponds/[id]` | Update or delete a single pond. |
| `GET /api/admin/ponds/next-code` | Suggests the next unused `PND-XXX` code. |
| `GET /api/admin/logs` | Reads `ingestion_logs` with filters; CSV when `?format=csv`. |

---

## 6. Database Schema (Summary)

Full column-level reference is in [Database-Documentation.md](Database-Documentation.md). Summary here:

| Table | Purpose |
|---|---|
| `sensor_readings` (hypertable) | All raw ESP32 readings, partitioned by `time`. |
| `owners` | User accounts: name, email, password_hash, role, company_name. |
| `ponds` | Pond metadata: pond_code, name, location, capacity, area, company_name. |
| `user_pond_access` | M:N user-to-pond access list. |
| `pond_sensor_thresholds` | Per-pond, per-sensor `optimal_min` and `optimal_max`. |
| `pond_sensor_thresholds_audit` | Append-only history of threshold edits. |
| `ingestion_logs` | Every ESP32 POST: status, IP, payload, error. |
| `sensor_alerts` | Append-only alerts (one row per trigger). |
| `maintenance_requests` | Owner-submitted maintenance with acknowledge/resolve workflow. |
| `pond_status_log` | Heartbeat rows written on every successful ingest. |

---

## 7. Alert System

The alert system enforces "silence is dangerous" — it fires when a sensor stays out of range long enough that the user needs to act. The implementation is intentionally simple.

### Trigger Conditions

- Each successful ingest in `/api/send-sensor-data` calls `runAlertChecks(pondId, values)`.
- Per sensor, the engine reads the `(pond, sensor)` row from `pond_sensor_thresholds`.
- It then reads the last 7 non-null readings for that sensor in descending time order.
- If all 7 are `< optimal_min` OR all 7 are `> optimal_max`, the alert fires.
- If an unacknowledged alert already exists for `(pond, sensor)`, the engine does nothing.
- Otherwise it inserts a row in `sensor_alerts` with `consecutive_count = 7` and the trigger value.

### Re-trigger

Migration `010` dropped the partial unique index on `resolved_at IS NULL` and added a non-unique index on `(pond_id, sensor) WHERE acknowledged_at IS NULL`. After an admin or owner acknowledges an alert, the next time the engine sees 7 consecutive bad readings, it inserts a fresh row. There is no cooldown beyond "don't re-trigger while one is already unacknowledged".

### UI Surfaces

- `AlertPopup.tsx` renders the unacknowledged alerts as toasts in the bottom-right.
- `/notifications` shows the full history with filter and **Acknowledge** button.
- The header bell counts unacknowledged alerts plus maintenance requests.

---

## 8. Utilization System

Utilization measures how much of a window each pond was in each state. It is derived purely from the `pond_status_log` heartbeats and from maintenance intervals.

### Heartbeat-Derived Segments

`/api/utilization` uses a CTE chain that anchors both ends of the window:

- `prior_hb` — last heartbeat before `win_start` (so the first gap is measured correctly).
- `virtual_start` — synthetic row at `win_start` for ponds with no prior heartbeat.
- `window_hb` — every heartbeat inside the window.
- `virtual_end` — synthetic row at `win_end` for trailing-silence detection.

Each consecutive pair of rows forms a segment. The status is derived from the segment length:

- **< 60 seconds** — online.
- **< 180 seconds** — stale.
- **Otherwise** — offline.

### Maintenance Overlay

Maintenance intervals are read from `maintenance_requests`, clipped to the window, and merged per pond. For each heartbeat-derived segment, the engine subtracts any overlap with a maintenance interval and adds it to the maintenance bucket instead. This way wall-clock minutes are never double-counted, and maintenance always wins over heartbeat-derived status.

### Percentage Calculation

Percentages are computed from raw (unrounded) minutes and rounded only for display. This guarantees the four percentages sum to 100% (modulo rounding errors of less than 0.1%).

---

## 9. Notification System

Notifications cover two streams: maintenance requests submitted by owners and sensor alerts fired by the engine. The system is intentionally separate from email — there is no external delivery.

### Maintenance Request Flow

- Owner clicks **Request Maintenance**, fills a short form, POSTs to `/api/maintenance`.
- Row is inserted with `status='pending'`, sets the affected pond's status dot to blue (Maintenance) on the next status poll.
- Admin opens `/notifications`, clicks **Acknowledge** — PATCH `/api/maintenance/[id]` updates `status='acknowledged'` and stamps `acknowledged_at` and `acknowledged_by`.
- Admin clicks **Resolve** — `status='resolved'`, `resolved_at` and `resolved_by` stamped, `admin_note` saved. The pond's blue dot disappears on the next status poll.

### Sensor Alert Stream

Alerts are read-only for users: they fire automatically and can only be Acknowledged. Acknowledging stops the popup; it does not delete the row. The full table is the long-term record of every threshold breach.

---

## 10. ESP32 Integration

### Payload Shape

```http
POST /api/send-sensor-data
Host: ipond.example.com
Authorization: Bearer <API_TOKEN>
Content-Type: application/json

{
  "data": {
    "pnd": 1,      // pond number 1..10
    "rtd": 28.5,   // temperature in °C
    "ph":  7.2,    // pH
    "sal": 15.0,   // salinity in ppt
    "dox": 6.8     // dissolved oxygen in mg/L
  }
}
```

### Authentication

The route compares the Authorization header against `` `Bearer ${process.env.API_TOKEN}` `` byte-for-byte. Missing or wrong tokens return `401` and still write an `ingestion_logs` row so admins can spot intrusion attempts.

### Mapping `pnd` to `ponds.id`

`pnd` is an integer between 1 and 10. The route formats it as `PND-001..PND-010` and queries `ponds.pond_code` to find the matching row. If no row exists, the ingest fails with `404 unknown_pond` — admins must create the pond record first via `/admin`.

### Side Effects of a Successful Ingest

- Insert into `sensor_readings` (`time = NOW()`, `pond_id`, sensor values).
- Insert into `pond_status_log` with `status='online'` — this is the heartbeat used by utilization.
- Insert into `ingestion_logs` with `http_status=201` and the full raw payload.
- Run `runAlertChecks()` — may insert a row in `sensor_alerts`.
