const fs = require("fs");
const path = require("path");
const { Packer } = require("docx");
const {
  p, h1, h1First, h2, h3, bullet, code, screenshot, table,
  titlePage, tocSection, makeDoc,
} = require("./_helpers");

const TITLE = "Database Documentation";

function tableSection(name, purpose, partition, columns, indexes, notes) {
  const children = [
    h2(`Table: ${name}`),
    p(`Purpose: ${purpose}`),
  ];
  if (partition) {
    children.push(p(`Partition: ${partition}`));
  }
  children.push(table(
    ["Column", "Type", "Nullable", "Default", "Description"],
    columns,
    { widths: [1900, 1700, 1300, 1700, 2760] },
  ));
  if (indexes && indexes.length) {
    children.push(h3("Indexes"));
    indexes.forEach((idx) => children.push(bullet(idx)));
  }
  if (notes && notes.length) {
    children.push(h3("Notes"));
    notes.forEach((n) => children.push(bullet(n)));
  }
  return children;
}

const children = [
  ...titlePage(TITLE, "Schema, Queries, and Operations"),
  ...tocSection(TITLE),

  h1First("1. Overview"),
  p("The Soletronix iPond database runs on PostgreSQL 16 with the TimescaleDB extension. Schema and seed data are managed through numbered SQL migrations in db/migrations/. The application uses a single pooled connection (max 10) through node-postgres in src/lib/db.ts."),
  h2("Docker Setup"),
  ...code([
    "# docker-compose.yml",
    "services:",
    "  timescaledb:",
    "    image: timescale/timescaledb:latest-pg16",
    "    container_name: soletronix-timescaledb",
    "    ports: ['5432:5432']",
    "    environment:",
    "      POSTGRES_USER: ${POSTGRES_USER}",
    "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}",
    "      POSTGRES_DB:     ${POSTGRES_DB}",
    "    volumes:",
    "      - timescaledb_data:/var/lib/postgresql/data",
    "      - ./db/migrations:/docker-entrypoint-initdb.d:ro",
  ].join("\n")),
  h2("Connection String"),
  ...code([
    "DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}",
  ].join("\n")),

  h1("2. Entity Relationship (Text ERD)"),
  ...code([
    "  owners (id, role)",
    "     │",
    "     │ 1                    1",
    "     │                      │",
    "     ▼                      ▼",
    "  user_pond_access     pond_sensor_thresholds_audit",
    "     │                      ▲",
    "     │ N                    │",
    "     ▼                      │",
    "  ponds (id, pond_code) ────┼──── pond_sensor_thresholds",
    "     │                      │",
    "     │ 1                    │",
    "     ├──────────────────┐   │",
    "     ▼                  ▼   ▼",
    "  sensor_readings   ingestion_logs",
    "     ▲                  │",
    "     │                  ▼",
    "     │              sensor_alerts",
    "     │                  │",
    "     │                  ▼",
    "     │           maintenance_requests",
    "     │                  │",
    "     │                  ▼",
    "     └─────────── pond_status_log",
  ].join("\n")),

  h1("3. Tables"),

  ...tableSection(
    "sensor_readings (hypertable)",
    "Stores every reading received from ESP32 gateways.",
    "time (TimescaleDB hypertable, 7-day default chunks)",
    [
      ["time", "TIMESTAMPTZ", "NOT NULL", "—", "Server-stamped ingest time (UTC)."],
      ["pond_id", "INT", "NOT NULL", "—", "FK → ponds(id). ON DELETE CASCADE through fk_sensor_readings_pond."],
      ["temperature", "DOUBLE PRECISION", "YES", "NULL", "°C, derived from ESP32 field `rtd`."],
      ["ph", "DOUBLE PRECISION", "YES", "NULL", "pH units."],
      ["salinity", "DOUBLE PRECISION", "YES", "NULL", "ppt, from ESP32 field `sal`."],
      ["dissolved_oxygen", "DOUBLE PRECISION", "YES", "NULL", "mg/L, from ESP32 field `dox`."],
    ],
    [
      "idx_sensor_readings_pond_time: (pond_id, time DESC) — drives the latest-per-pond and gap queries.",
      "Hypertable index on time created by create_hypertable().",
    ],
    [
      "Originally constrained pond_id BETWEEN 1 AND 10. Replaced by FK to ponds(id) NOT VALID in migration 002.",
      "Round on read with ROUND(<col>::numeric, 2)::float8 — keep raw precision in storage.",
    ],
  ),

  ...tableSection(
    "owners",
    "User accounts. Despite the name, this table holds admin, owner, and viewer roles.",
    null,
    [
      ["id", "UUID", "NOT NULL", "gen_random_uuid()", "Primary key."],
      ["name", "TEXT", "NOT NULL", "—", "Display name."],
      ["email", "TEXT", "NOT NULL UNIQUE", "—", "Login identifier. Lookup is case-insensitive."],
      ["created_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "Account creation timestamp."],
      ["role", "TEXT", "NOT NULL", "'owner'", "One of 'admin' | 'owner' | 'viewer' (CHECK constraint)."],
      ["password_hash", "TEXT", "NOT NULL", "''", "bcrypt hash of the password."],
      ["company_name", "TEXT", "YES", "NULL", "Optional company label for tenant display."],
    ],
    [
      "idx_owners_email_lower: UNIQUE on LOWER(email) — enforces case-insensitive email uniqueness.",
    ],
    [
      "owners_role_check restricts role to ('admin', 'owner', 'viewer').",
      "Password is hashed by bcryptjs before insertion; never stored in clear.",
    ],
  ),

  ...tableSection(
    "ponds",
    "Physical pond records. The ESP32 looks up ponds via pond_code.",
    null,
    [
      ["id", "SERIAL", "NOT NULL", "—", "Primary key (SERIAL)."],
      ["owner_id", "UUID", "YES", "—", "Optional legacy owner (M:N moved to user_pond_access). FK → owners(id)."],
      ["name", "TEXT", "NOT NULL", "—", "Human-readable pond name."],
      ["location", "TEXT", "YES", "NULL", "Free-text location."],
      ["capacity", "FLOAT", "YES", "NULL", "Volume in your chosen unit (cubic meters typical)."],
      ["area", "FLOAT", "YES", "NULL", "Surface area in m²."],
      ["created_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "Insertion timestamp."],
      ["company_name", "TEXT", "YES", "NULL", "Company display name."],
      ["pond_code", "TEXT", "YES", "NULL", "Unique business code (PND-001..PND-010)."],
    ],
    [
      "idx_ponds_owner: (owner_id).",
      "idx_ponds_pond_code: UNIQUE (pond_code) WHERE pond_code IS NOT NULL.",
    ],
    [
      "ESP32 firmware sends pond number 1..10; the ingest route converts to PND-XXX and joins on pond_code.",
    ],
  ),

  ...tableSection(
    "user_pond_access",
    "Many-to-many table connecting users to the ponds they can read and edit.",
    null,
    [
      ["user_id", "UUID", "NOT NULL", "—", "FK → owners(id), ON DELETE CASCADE."],
      ["pond_id", "INT", "NOT NULL", "—", "FK → ponds(id), ON DELETE CASCADE."],
    ],
    [
      "PRIMARY KEY (user_id, pond_id).",
      "idx_user_pond_access_user: (user_id).",
      "idx_user_pond_access_pond: (pond_id).",
    ],
    [
      "Created in migration 005. Backfilled from the legacy ponds.owner_id column.",
    ],
  ),

  ...tableSection(
    "pond_sensor_thresholds",
    "Per-pond, per-sensor optimal range. Drives the alert engine and chart anomaly counts.",
    null,
    [
      ["id", "UUID", "NOT NULL", "gen_random_uuid()", "Primary key."],
      ["pond_id", "INT", "NOT NULL", "—", "FK → ponds(id), ON DELETE CASCADE."],
      ["sensor", "TEXT", "NOT NULL", "—", "'temperature' | 'ph' | 'salinity' | 'dissolved_oxygen' (CHECK)."],
      ["optimal_min", "FLOAT", "NOT NULL", "—", "Inclusive lower bound of the optimal range."],
      ["optimal_max", "FLOAT", "NOT NULL", "—", "Inclusive upper bound. Must be > optimal_min."],
      ["updated_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "Last edit timestamp."],
      ["updated_by", "UUID", "YES", "—", "FK → owners(id) of the user who saved."],
    ],
    [
      "UNIQUE (pond_id, sensor) — one row per (pond, sensor).",
      "CHECK (optimal_min < optimal_max).",
    ],
    [
      "Defaults seeded in migration 004 for every (pond, sensor) combination.",
      "Defaults: temperature 22-27, ph 6.5-7.5, salinity 15-30, dissolved_oxygen 5-8.",
    ],
  ),

  ...tableSection(
    "pond_sensor_thresholds_audit",
    "Append-only history of threshold edits. Used by /api/thresholds/history.",
    null,
    [
      ["id", "UUID", "NOT NULL", "gen_random_uuid()", "Primary key."],
      ["pond_id", "INT", "NOT NULL", "—", "The pond that was edited."],
      ["sensor", "TEXT", "NOT NULL", "—", "Sensor name."],
      ["old_min", "FLOAT", "YES", "NULL", "Previous optimal_min (null on first set)."],
      ["old_max", "FLOAT", "YES", "NULL", "Previous optimal_max."],
      ["new_min", "FLOAT", "NOT NULL", "—", "New optimal_min."],
      ["new_max", "FLOAT", "NOT NULL", "—", "New optimal_max."],
      ["changed_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "When the change occurred."],
      ["changed_by", "UUID", "YES", "—", "FK → owners(id)."],
    ],
    [
      "idx_psta_pond_sensor_time: (pond_id, sensor, changed_at DESC).",
    ],
    [
      "Written inside the same transaction as the upsert in /api/thresholds PATCH.",
    ],
  ),

  ...tableSection(
    "ingestion_logs",
    "Audit log of every POST to /api/send-sensor-data, success or failure.",
    null,
    [
      ["id", "UUID", "NOT NULL", "gen_random_uuid()", "Primary key."],
      ["received_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "When the route handled the request."],
      ["pond_id", "INT", "YES", "NULL", "FK → ponds(id), ON DELETE SET NULL. Null when pond was unknown."],
      ["pond_code", "TEXT", "YES", "NULL", "The PND-XXX code as parsed."],
      ["raw_payload", "JSONB", "NOT NULL", "—", "Original request body (after JSON parse)."],
      ["temperature", "FLOAT", "YES", "NULL", "Parsed value, null if invalid."],
      ["ph", "FLOAT", "YES", "NULL", "Parsed value."],
      ["salinity", "FLOAT", "YES", "NULL", "Parsed value."],
      ["dissolved_oxygen", "FLOAT", "YES", "NULL", "Parsed value."],
      ["http_status", "INT", "NOT NULL", "—", "201 on success; 400/401/404/500 on errors."],
      ["ip_address", "TEXT", "YES", "NULL", "From X-Forwarded-For or X-Real-IP."],
      ["error_message", "TEXT", "YES", "NULL", "Short error tag, null on success."],
    ],
    [
      "idx_ingestion_logs_received_at: (received_at DESC).",
      "idx_ingestion_logs_pond_id: (pond_id).",
      "idx_ingestion_logs_http_status: (http_status).",
    ],
    [
      "Append-only by convention — the dashboard never deletes rows. Apply retention via a TimescaleDB drop_chunks policy if size becomes an issue.",
    ],
  ),

  ...tableSection(
    "sensor_alerts",
    "Append-only log of every threshold-breach alert fired by the engine.",
    null,
    [
      ["id", "UUID", "NOT NULL", "gen_random_uuid()", "Primary key."],
      ["pond_id", "INT", "NOT NULL", "—", "FK → ponds(id), ON DELETE CASCADE."],
      ["sensor", "TEXT", "NOT NULL", "—", "One of four sensor names (CHECK constraint)."],
      ["triggered_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "When the alert was created."],
      ["acknowledged_at", "TIMESTAMPTZ", "YES", "NULL", "Set when an admin/owner clicks Acknowledge."],
      ["acknowledged_by", "UUID", "YES", "NULL", "FK → owners(id), ON DELETE SET NULL."],
      ["consecutive_count", "INT", "NOT NULL", "—", "Number of consecutive bad readings (currently always 7)."],
      ["last_value", "FLOAT", "NOT NULL", "—", "The value that tipped the threshold."],
      ["optimal_min", "FLOAT", "NOT NULL", "—", "Threshold at the time of trigger."],
      ["optimal_max", "FLOAT", "NOT NULL", "—", "Threshold at the time of trigger."],
      ["resolved_at", "TIMESTAMPTZ", "YES", "NULL", "Reserved for future auto-resolution."],
    ],
    [
      "idx_sensor_alerts_unacknowledged: (pond_id, sensor) WHERE acknowledged_at IS NULL.",
      "idx_sensor_alerts_triggered_at: (triggered_at DESC).",
      "idx_sensor_alerts_pond: (pond_id).",
    ],
    [
      "Migration 010 removed the older UNIQUE partial index on resolved_at IS NULL so the engine can re-trigger after acknowledgement.",
    ],
  ),

  ...tableSection(
    "maintenance_requests",
    "Owner-submitted maintenance tickets. Drives the blue Maintenance dot.",
    null,
    [
      ["id", "UUID", "NOT NULL", "gen_random_uuid()", "Primary key."],
      ["pond_id", "INT", "NOT NULL", "—", "FK → ponds(id), ON DELETE CASCADE."],
      ["requested_by", "UUID", "NOT NULL", "—", "FK → owners(id), ON DELETE CASCADE."],
      ["message", "TEXT", "NOT NULL", "—", "Owner-supplied description."],
      ["status", "notification_status", "NOT NULL", "'pending'", "Enum: 'pending' | 'acknowledged' | 'resolved'."],
      ["created_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "Submission time."],
      ["acknowledged_at", "TIMESTAMPTZ", "YES", "NULL", "Set when admin acknowledges."],
      ["acknowledged_by", "UUID", "YES", "NULL", "FK → owners(id), ON DELETE SET NULL."],
      ["resolved_at", "TIMESTAMPTZ", "YES", "NULL", "Set when admin resolves."],
      ["resolved_by", "UUID", "YES", "NULL", "FK → owners(id), ON DELETE SET NULL."],
      ["admin_note", "TEXT", "YES", "NULL", "Free-text resolution note."],
    ],
    [
      "idx_maintenance_pond: (pond_id).",
      "idx_maintenance_requested_by: (requested_by).",
      "idx_maintenance_status: (status).",
      "idx_maintenance_created_at: (created_at DESC).",
    ],
    [
      "An unresolved request (status != 'resolved') gives the pond status='maintenance' on the dashboard.",
      "/api/utilization treats time between created_at and COALESCE(resolved_at, window_end) as Maintenance minutes.",
    ],
  ),

  ...tableSection(
    "pond_status_log",
    "Heartbeat rows. Driven by the ingest route, used by /api/utilization.",
    null,
    [
      ["id", "UUID", "NOT NULL", "gen_random_uuid()", "Primary key."],
      ["pond_id", "INT", "NOT NULL", "—", "FK → ponds(id), ON DELETE CASCADE."],
      ["status", "TEXT", "NOT NULL", "—", "'online' | 'stale' | 'offline' | 'maintenance' (CHECK)."],
      ["recorded_at", "TIMESTAMPTZ", "NOT NULL", "NOW()", "Time the heartbeat was written."],
    ],
    [
      "idx_pond_status_log: (pond_id, recorded_at DESC).",
      "idx_pond_status_log_recorded_at: (recorded_at DESC).",
    ],
    [
      "Only the ingest route writes rows (always with status='online'). Migration 011 removed the older 30-second background job in favour of ingest-driven heartbeats.",
    ],
  ),

  h1("4. Migration History"),
  table(
    ["File", "Summary"],
    [
      ["001_init.sql", "Creates sensor_readings hypertable and pond_id index. pond_id range 1..10 enforced via CHECK."],
      ["002_multitenancy.sql", "Adds owners and ponds tables; converts sensor_readings.pond_id to FK ponds(id)."],
      ["003_auth.sql", "Adds role and password_hash to owners. Adds unique index on LOWER(email)."],
      ["004_optimal_ranges.sql", "Creates pond_sensor_thresholds + audit. Seeds defaults per pond × sensor."],
      ["005_admin_management.sql", "Adds company_name, pond_code, viewer role, user_pond_access M2M, makes ponds.owner_id nullable."],
      ["006_ingestion_logs.sql", "Creates ingestion_logs table with raw_payload JSONB."],
      ["007_alerts.sql", "Creates sensor_alerts with partial unique index on resolved_at IS NULL."],
      ["008_notifications.sql", "Creates notification_status enum and maintenance_requests table."],
      ["009_pond_status_log.sql", "Creates pond_status_log."],
      ["010_alerts_retrigger.sql", "Drops the partial unique on resolved_at; replaces with non-unique index on acknowledged_at IS NULL — alerts can re-trigger."],
      ["011_status_logger_job.sql", "Unschedules the 30-second background snapshot job; pond_status_log is now ingest-driven."],
    ],
    { widths: [3000, 6360] },
  ),

  h1("5. Useful Queries"),
  h2("Latest reading per pond"),
  ...code([
    "SELECT DISTINCT ON (pond_id)",
    "       pond_id, time, temperature, ph, salinity, dissolved_oxygen",
    "  FROM sensor_readings",
    " ORDER BY pond_id, time DESC;",
  ].join("\n")),
  h2("Anomaly count per sensor over the last 24 hours"),
  ...code([
    "SELECT sr.pond_id, COUNT(*) AS anomalies",
    "  FROM sensor_readings sr",
    "  JOIN pond_sensor_thresholds pst",
    "    ON pst.pond_id = sr.pond_id AND pst.sensor = 'temperature'",
    " WHERE sr.time >= NOW() - INTERVAL '24 hours'",
    "   AND (sr.temperature < pst.optimal_min OR sr.temperature > pst.optimal_max)",
    " GROUP BY sr.pond_id;",
  ].join("\n")),
  h2("Manual alert check (used by the engine)"),
  ...code([
    "SELECT temperature AS value",
    "  FROM sensor_readings",
    " WHERE pond_id = $1 AND temperature IS NOT NULL",
    " ORDER BY time DESC",
    " LIMIT 7;",
    "",
    "-- If every row is < optimal_min or every row > optimal_max, insert a sensor_alerts row.",
  ].join("\n")),
  h2("Utilization gap calculation"),
  ...code([
    "WITH with_next AS (",
    "  SELECT pond_id, recorded_at,",
    "         LEAD(recorded_at) OVER (PARTITION BY pond_id ORDER BY recorded_at) AS next_at",
    "    FROM pond_status_log",
    "   WHERE pond_id = $1",
    "     AND recorded_at >= $2 AND recorded_at < $3",
    ")",
    "SELECT pond_id, recorded_at, next_at,",
    "       EXTRACT(EPOCH FROM (next_at - recorded_at)) AS gap_seconds",
    "  FROM with_next",
    " WHERE next_at IS NOT NULL;",
  ].join("\n")),

  h1("6. Backup and Restore"),
  h2("Logical Backup (pg_dump)"),
  ...code([
    "# Full database to a file",
    "docker exec -i soletronix-timescaledb \\",
    "  pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --format=custom --file=/tmp/ipond.dump",
    "docker cp soletronix-timescaledb:/tmp/ipond.dump ./ipond_$(date +%F).dump",
    "",
    "# Restore from a custom-format dump",
    "docker cp ipond_2026-05-13.dump soletronix-timescaledb:/tmp/ipond.dump",
    "docker exec -i soletronix-timescaledb \\",
    "  pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists /tmp/ipond.dump",
  ].join("\n")),
  h2("Hypertable Notes for Restore"),
  bullet("Run CREATE EXTENSION timescaledb; FIRST in the target database."),
  bullet("Use pg_dump --format=custom (-Fc) to preserve hypertable chunk metadata."),
  bullet("If restoring to a different machine, leave SELECT timescaledb_pre_restore(); / timescaledb_post_restore(); as documented by Timescale."),

  h1("7. TimescaleDB Notes"),
  h2("Hypertable Behaviour"),
  bullet("sensor_readings is partitioned by time into 7-day chunks (default). Older chunks compress well — enable compression with ALTER TABLE sensor_readings SET (timescaledb.compress)."),
  bullet("Range queries on time benefit from chunk pruning; always include a time filter."),
  h2("time_bucket()"),
  bullet("/api/readings uses time_bucket('5 minutes', time AT TIME ZONE $tz) AT TIME ZONE $tz to align buckets to the configured APP_TIMEZONE."),
  bullet("Bucket sizes per range: 5m today, 1h 7d, 2h 14d, 6h 30d, 1d 1y."),
  h2("Retention Policy (recommended)"),
  ...code([
    "-- Drop chunks older than 1 year (or your policy):",
    "SELECT add_retention_policy('sensor_readings', INTERVAL '365 days');",
    "",
    "-- Apply compression to chunks older than 14 days:",
    "ALTER TABLE sensor_readings SET (",
    "  timescaledb.compress,",
    "  timescaledb.compress_segmentby = 'pond_id'",
    ");",
    "SELECT add_compression_policy('sensor_readings', INTERVAL '14 days');",
  ].join("\n")),
];

const doc = makeDoc(children, TITLE);

const out = path.join(__dirname, "..", "..", "docs", "Database-Documentation.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log("wrote", out);
});
