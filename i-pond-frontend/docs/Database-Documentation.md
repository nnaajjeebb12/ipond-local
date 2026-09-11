# Database Documentation

**Schema, Queries, and Operations** — Soletronix iPond, the IoT Aquaculture Monitoring System.

## Table of Contents

1. [Overview](#1-overview)
2. [Entity Relationship](#2-entity-relationship-text-erd)
3. [Tables](#3-tables)
4. [Migration History](#4-migration-history)
5. [Useful Queries](#5-useful-queries)
6. [Backup and Restore](#6-backup-and-restore)
7. [TimescaleDB Notes](#7-timescaledb-notes)

---

## 1. Overview

The Soletronix iPond database runs on PostgreSQL 16 with the TimescaleDB extension. Schema and seed data are managed through numbered SQL migrations in `db/migrations/`. The application uses a single pooled connection (`max=10`) through `node-postgres` in `src/lib/db.ts`.

### Docker Setup

```yaml
# docker-compose.yml
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    container_name: soletronix-timescaledb
    ports: ['5432:5432']
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB:     ${POSTGRES_DB}
    volumes:
      - timescaledb_data:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d:ro
```

### Connection String

```
DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}
```

---

## 2. Entity Relationship (Text ERD)

```
  owners (id, role)
     │
     │ 1                    1
     │                      │
     ▼                      ▼
  user_pond_access     pond_sensor_thresholds_audit
     │                      ▲
     │ N                    │
     ▼                      │
  ponds (id, pond_code) ────┼──── pond_sensor_thresholds
     │                      │
     │ 1                    │
     ├──────────────────┐   │
     ▼                  ▼   ▼
  sensor_readings   ingestion_logs
     ▲                  │
     │                  ▼
     │              sensor_alerts
     │                  │
     │                  ▼
     │           maintenance_requests
     │                  │
     │                  ▼
     └─────────── pond_status_log
```

---

## 3. Tables

### Table: `sensor_readings` (hypertable)

**Purpose:** Stores every reading received from ESP32 gateways.
**Partition:** `time` (TimescaleDB hypertable, 7-day default chunks).

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `time` | `TIMESTAMPTZ` | NOT NULL | — | Server-stamped ingest time (UTC). |
| `pond_id` | `INT` | NOT NULL | — | FK → `ponds(id)`. `ON DELETE CASCADE` through `fk_sensor_readings_pond`. |
| `temperature` | `DOUBLE PRECISION` | YES | NULL | °C, derived from ESP32 field `rtd`. |
| `ph` | `DOUBLE PRECISION` | YES | NULL | pH units. |
| `salinity` | `DOUBLE PRECISION` | YES | NULL | ppt, from ESP32 field `sal`. |
| `dissolved_oxygen` | `DOUBLE PRECISION` | YES | NULL | mg/L, from ESP32 field `dox`. |

**Indexes**
- `idx_sensor_readings_pond_time: (pond_id, time DESC)` — drives the latest-per-pond and gap queries.
- Hypertable index on `time` created by `create_hypertable()`.

**Notes**
- Originally constrained `pond_id BETWEEN 1 AND 10`. Replaced by FK to `ponds(id) NOT VALID` in migration `002`.
- Round on read with `ROUND(<col>::numeric, 2)::float8` — keep raw precision in storage.

---

### Table: `owners`

**Purpose:** User accounts. Despite the name, this table holds **admin**, **owner**, and **viewer** roles.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `name` | `TEXT` | NOT NULL | — | Display name. |
| `email` | `TEXT` | NOT NULL UNIQUE | — | Login identifier. Lookup is case-insensitive. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Account creation timestamp. |
| `role` | `TEXT` | NOT NULL | `'owner'` | One of `'admin' \| 'owner' \| 'viewer'` (CHECK constraint). |
| `password_hash` | `TEXT` | NOT NULL | `''` | bcrypt hash of the password. |
| `company_name` | `TEXT` | YES | NULL | Optional company label for tenant display. |

**Indexes**
- `idx_owners_email_lower: UNIQUE on LOWER(email)` — enforces case-insensitive email uniqueness.

**Notes**
- `owners_role_check` restricts role to `('admin', 'owner', 'viewer')`.
- Password is hashed by `bcryptjs` before insertion; never stored in clear.

---

### Table: `ponds`

**Purpose:** Physical pond records. The ESP32 looks up ponds via `pond_code`.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `SERIAL` | NOT NULL | — | Primary key (SERIAL). |
| `owner_id` | `UUID` | YES | — | Optional legacy owner (M:N moved to `user_pond_access`). FK → `owners(id)`. |
| `name` | `TEXT` | NOT NULL | — | Human-readable pond name. |
| `location` | `TEXT` | YES | NULL | Free-text location. |
| `capacity` | `FLOAT` | YES | NULL | Volume in your chosen unit (cubic meters typical). |
| `area` | `FLOAT` | YES | NULL | Surface area in m². |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Insertion timestamp. |
| `company_name` | `TEXT` | YES | NULL | Company display name. |
| `pond_code` | `TEXT` | YES | NULL | Unique business code (`PND-001..PND-010`). |

**Indexes**
- `idx_ponds_owner: (owner_id)`.
- `idx_ponds_pond_code: UNIQUE (pond_code) WHERE pond_code IS NOT NULL`.

**Notes**
- ESP32 firmware sends pond number `1..10`; the ingest route converts to `PND-XXX` and joins on `pond_code`.

---

### Table: `user_pond_access`

**Purpose:** Many-to-many table connecting users to the ponds they can read and edit.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `user_id` | `UUID` | NOT NULL | — | FK → `owners(id)`, `ON DELETE CASCADE`. |
| `pond_id` | `INT` | NOT NULL | — | FK → `ponds(id)`, `ON DELETE CASCADE`. |

**Indexes**
- `PRIMARY KEY (user_id, pond_id)`.
- `idx_user_pond_access_user: (user_id)`.
- `idx_user_pond_access_pond: (pond_id)`.

**Notes**
- Created in migration `005`. Backfilled from the legacy `ponds.owner_id` column.

---

### Table: `pond_sensor_thresholds`

**Purpose:** Per-pond, per-sensor optimal range. Drives the alert engine and chart anomaly counts.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `pond_id` | `INT` | NOT NULL | — | FK → `ponds(id)`, `ON DELETE CASCADE`. |
| `sensor` | `TEXT` | NOT NULL | — | `'temperature' \| 'ph' \| 'salinity' \| 'dissolved_oxygen'` (CHECK). |
| `optimal_min` | `FLOAT` | NOT NULL | — | Inclusive lower bound of the optimal range. |
| `optimal_max` | `FLOAT` | NOT NULL | — | Inclusive upper bound. Must be > `optimal_min`. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last edit timestamp. |
| `updated_by` | `UUID` | YES | — | FK → `owners(id)` of the user who saved. |

**Indexes**
- `UNIQUE (pond_id, sensor)` — one row per `(pond, sensor)`.
- `CHECK (optimal_min < optimal_max)`.

**Notes**
- Defaults seeded in migration `004` for every `(pond, sensor)` combination.
- Defaults: temperature `22-27`, ph `6.5-7.5`, salinity `15-30`, dissolved_oxygen `5-8`.

---

### Table: `pond_sensor_thresholds_audit`

**Purpose:** Append-only history of threshold edits. Used by `/api/thresholds/history`.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `pond_id` | `INT` | NOT NULL | — | The pond that was edited. |
| `sensor` | `TEXT` | NOT NULL | — | Sensor name. |
| `old_min` | `FLOAT` | YES | NULL | Previous `optimal_min` (null on first set). |
| `old_max` | `FLOAT` | YES | NULL | Previous `optimal_max`. |
| `new_min` | `FLOAT` | NOT NULL | — | New `optimal_min`. |
| `new_max` | `FLOAT` | NOT NULL | — | New `optimal_max`. |
| `changed_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | When the change occurred. |
| `changed_by` | `UUID` | YES | — | FK → `owners(id)`. |

**Indexes**
- `idx_psta_pond_sensor_time: (pond_id, sensor, changed_at DESC)`.

**Notes**
- Written inside the same transaction as the upsert in `/api/thresholds` PATCH.

---

### Table: `ingestion_logs`

**Purpose:** Audit log of every POST to `/api/send-sensor-data`, success or failure.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `received_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | When the route handled the request. |
| `pond_id` | `INT` | YES | NULL | FK → `ponds(id)`, `ON DELETE SET NULL`. Null when pond was unknown. |
| `pond_code` | `TEXT` | YES | NULL | The `PND-XXX` code as parsed. |
| `raw_payload` | `JSONB` | NOT NULL | — | Original request body (after JSON parse). |
| `temperature` | `FLOAT` | YES | NULL | Parsed value, null if invalid. |
| `ph` | `FLOAT` | YES | NULL | Parsed value. |
| `salinity` | `FLOAT` | YES | NULL | Parsed value. |
| `dissolved_oxygen` | `FLOAT` | YES | NULL | Parsed value. |
| `http_status` | `INT` | NOT NULL | — | `201` on success; `400`/`401`/`404`/`500` on errors. |
| `ip_address` | `TEXT` | YES | NULL | From `X-Forwarded-For` or `X-Real-IP`. |
| `error_message` | `TEXT` | YES | NULL | Short error tag, null on success. |

**Indexes**
- `idx_ingestion_logs_received_at: (received_at DESC)`.
- `idx_ingestion_logs_pond_id: (pond_id)`.
- `idx_ingestion_logs_http_status: (http_status)`.

**Notes**
- Append-only by convention — the dashboard never deletes rows. Apply retention via a TimescaleDB `drop_chunks` policy if size becomes an issue.

---

### Table: `sensor_alerts`

**Purpose:** Append-only log of every threshold-breach alert fired by the engine.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `pond_id` | `INT` | NOT NULL | — | FK → `ponds(id)`, `ON DELETE CASCADE`. |
| `sensor` | `TEXT` | NOT NULL | — | One of four sensor names (CHECK constraint). |
| `triggered_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | When the alert was created. |
| `acknowledged_at` | `TIMESTAMPTZ` | YES | NULL | Set when an admin/owner clicks Acknowledge. |
| `acknowledged_by` | `UUID` | YES | NULL | FK → `owners(id)`, `ON DELETE SET NULL`. |
| `consecutive_count` | `INT` | NOT NULL | — | Number of consecutive bad readings (currently always 7). |
| `last_value` | `FLOAT` | NOT NULL | — | The value that tipped the threshold. |
| `optimal_min` | `FLOAT` | NOT NULL | — | Threshold at the time of trigger. |
| `optimal_max` | `FLOAT` | NOT NULL | — | Threshold at the time of trigger. |
| `resolved_at` | `TIMESTAMPTZ` | YES | NULL | Reserved for future auto-resolution. |

**Indexes**
- `idx_sensor_alerts_unacknowledged: (pond_id, sensor) WHERE acknowledged_at IS NULL`.
- `idx_sensor_alerts_triggered_at: (triggered_at DESC)`.
- `idx_sensor_alerts_pond: (pond_id)`.

**Notes**
- Migration `010` removed the older UNIQUE partial index on `resolved_at IS NULL` so the engine can re-trigger after acknowledgement.

---

### Table: `maintenance_requests`

**Purpose:** Owner-submitted maintenance tickets. Drives the blue Maintenance dot.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `pond_id` | `INT` | NOT NULL | — | FK → `ponds(id)`, `ON DELETE CASCADE`. |
| `requested_by` | `UUID` | NOT NULL | — | FK → `owners(id)`, `ON DELETE CASCADE`. |
| `message` | `TEXT` | NOT NULL | — | Owner-supplied description. |
| `status` | `notification_status` | NOT NULL | `'pending'` | Enum: `'pending' \| 'acknowledged' \| 'resolved'`. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Submission time. |
| `acknowledged_at` | `TIMESTAMPTZ` | YES | NULL | Set when admin acknowledges. |
| `acknowledged_by` | `UUID` | YES | NULL | FK → `owners(id)`, `ON DELETE SET NULL`. |
| `resolved_at` | `TIMESTAMPTZ` | YES | NULL | Set when admin resolves. |
| `resolved_by` | `UUID` | YES | NULL | FK → `owners(id)`, `ON DELETE SET NULL`. |
| `admin_note` | `TEXT` | YES | NULL | Free-text resolution note. |

**Indexes**
- `idx_maintenance_pond: (pond_id)`.
- `idx_maintenance_requested_by: (requested_by)`.
- `idx_maintenance_status: (status)`.
- `idx_maintenance_created_at: (created_at DESC)`.

**Notes**
- An unresolved request (`status != 'resolved'`) gives the pond `status='maintenance'` on the dashboard.
- `/api/utilization` treats time between `created_at` and `COALESCE(resolved_at, window_end)` as Maintenance minutes.

---

### Table: `pond_status_log`

**Purpose:** Heartbeat rows. Driven by the ingest route, used by `/api/utilization`.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `pond_id` | `INT` | NOT NULL | — | FK → `ponds(id)`, `ON DELETE CASCADE`. |
| `status` | `TEXT` | NOT NULL | — | `'online' \| 'stale' \| 'offline' \| 'maintenance'` (CHECK). |
| `recorded_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Time the heartbeat was written. |

**Indexes**
- `idx_pond_status_log: (pond_id, recorded_at DESC)`.
- `idx_pond_status_log_recorded_at: (recorded_at DESC)`.

**Notes**
- Only the ingest route writes rows (always with `status='online'`). Migration `011` removed the older 30-second background job in favour of ingest-driven heartbeats.

---

## 4. Migration History

| File | Summary |
|---|---|
| `001_init.sql` | Creates `sensor_readings` hypertable and `pond_id` index. `pond_id` range `1..10` enforced via CHECK. |
| `002_multitenancy.sql` | Adds `owners` and `ponds` tables; converts `sensor_readings.pond_id` to FK `ponds(id)`. |
| `003_auth.sql` | Adds `role` and `password_hash` to `owners`. Adds unique index on `LOWER(email)`. |
| `004_optimal_ranges.sql` | Creates `pond_sensor_thresholds` + audit. Seeds defaults per pond × sensor. |
| `005_admin_management.sql` | Adds `company_name`, `pond_code`, viewer role, `user_pond_access` M2M, makes `ponds.owner_id` nullable. |
| `006_ingestion_logs.sql` | Creates `ingestion_logs` table with `raw_payload` JSONB. |
| `007_alerts.sql` | Creates `sensor_alerts` with partial unique index on `resolved_at IS NULL`. |
| `008_notifications.sql` | Creates `notification_status` enum and `maintenance_requests` table. |
| `009_pond_status_log.sql` | Creates `pond_status_log`. |
| `010_alerts_retrigger.sql` | Drops the partial unique on `resolved_at`; replaces with non-unique index on `acknowledged_at IS NULL` — alerts can re-trigger. |
| `011_status_logger_job.sql` | Unschedules the 30-second background snapshot job; `pond_status_log` is now ingest-driven. |

---

## 5. Useful Queries

### Latest reading per pond

```sql
SELECT DISTINCT ON (pond_id)
       pond_id, time, temperature, ph, salinity, dissolved_oxygen
  FROM sensor_readings
 ORDER BY pond_id, time DESC;
```

### Anomaly count per sensor over the last 24 hours

```sql
SELECT sr.pond_id, COUNT(*) AS anomalies
  FROM sensor_readings sr
  JOIN pond_sensor_thresholds pst
    ON pst.pond_id = sr.pond_id AND pst.sensor = 'temperature'
 WHERE sr.time >= NOW() - INTERVAL '24 hours'
   AND (sr.temperature < pst.optimal_min OR sr.temperature > pst.optimal_max)
 GROUP BY sr.pond_id;
```

### Manual alert check (used by the engine)

```sql
SELECT temperature AS value
  FROM sensor_readings
 WHERE pond_id = $1 AND temperature IS NOT NULL
 ORDER BY time DESC
 LIMIT 7;

-- If every row is < optimal_min or every row > optimal_max, insert a sensor_alerts row.
```

### Utilization gap calculation

```sql
WITH with_next AS (
  SELECT pond_id, recorded_at,
         LEAD(recorded_at) OVER (PARTITION BY pond_id ORDER BY recorded_at) AS next_at
    FROM pond_status_log
   WHERE pond_id = $1
     AND recorded_at >= $2 AND recorded_at < $3
)
SELECT pond_id, recorded_at, next_at,
       EXTRACT(EPOCH FROM (next_at - recorded_at)) AS gap_seconds
  FROM with_next
 WHERE next_at IS NOT NULL;
```

---

## 6. Backup and Restore

### Logical Backup (`pg_dump`)

```bash
# Full database to a file
docker exec -i soletronix-timescaledb \
  pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --format=custom --file=/tmp/ipond.dump
docker cp soletronix-timescaledb:/tmp/ipond.dump ./ipond_$(date +%F).dump

# Restore from a custom-format dump
docker cp ipond_2026-05-13.dump soletronix-timescaledb:/tmp/ipond.dump
docker exec -i soletronix-timescaledb \
  pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists /tmp/ipond.dump
```

### Hypertable Notes for Restore

- Run `CREATE EXTENSION timescaledb;` **first** in the target database.
- Use `pg_dump --format=custom (-Fc)` to preserve hypertable chunk metadata.
- If restoring to a different machine, leave `SELECT timescaledb_pre_restore();` / `timescaledb_post_restore();` as documented by Timescale.

---

## 7. TimescaleDB Notes

### Hypertable Behaviour

- `sensor_readings` is partitioned by `time` into 7-day chunks (default). Older chunks compress well — enable compression with `ALTER TABLE sensor_readings SET (timescaledb.compress)`.
- Range queries on `time` benefit from chunk pruning; always include a time filter.

### `time_bucket()`

- `/api/readings` uses `time_bucket('5 minutes', time AT TIME ZONE $tz) AT TIME ZONE $tz` to align buckets to the configured `APP_TIMEZONE`.
- Bucket sizes per range: 5m today, 1h 7d, 2h 14d, 6h 30d, 1d 1y.

### Retention Policy (recommended)

```sql
-- Drop chunks older than 1 year (or your policy):
SELECT add_retention_policy('sensor_readings', INTERVAL '365 days');

-- Apply compression to chunks older than 14 days:
ALTER TABLE sensor_readings SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'pond_id'
);
SELECT add_compression_policy('sensor_readings', INTERVAL '14 days');
```
