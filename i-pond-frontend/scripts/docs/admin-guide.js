const fs = require("fs");
const path = require("path");
const { Packer } = require("docx");
const {
  p, h1, h1First, h2, h3, bullet, code, screenshot, table,
  titlePage, tocSection, makeDoc,
} = require("./_helpers");

const TITLE = "Admin Guide";

const children = [
  ...titlePage(TITLE, "For System Administrators"),
  ...tocSection(TITLE),

  h1First("1. Admin Overview"),
  p("System administrators are the highest privilege role in Soletronix iPond. An admin can see and edit every pond, every user, every alert, and every log. Owners and viewers are scoped to the ponds your administrator has assigned them through the user_pond_access table."),
  h2("Admin Capabilities"),
  bullet("Create, edit, suspend, or delete users (admin, owner, or viewer roles)."),
  bullet("Create, edit, or delete ponds and assign them to one or more users."),
  bullet("Read the ingestion log: every ESP32 POST is recorded with HTTP status, IP, and raw payload."),
  bullet("Acknowledge and resolve maintenance requests; view the full alert history."),
  bullet("Set or override threshold ranges for any pond; the audit log captures every change."),
  bullet("Review the utilization page across all ponds and all users."),
  h2("What Admins Cannot Do"),
  p("Admins cannot impersonate other users to write data on their behalf, cannot delete ingestion log rows from inside the application (they are append-only by design), and cannot edit the ESP32 firmware from the dashboard."),
  screenshot("Admin home dashboard"),

  h1("2. User Management"),
  p("Open /admin and choose the Users tab to manage user accounts. Each user has an email (unique), display name, optional company name, role, and the set of ponds they can access."),
  h2("Roles Explained"),
  table(
    ["Role", "What it sees", "What it can do"],
    [
      ["admin", "Everything across all ponds.", "Full CRUD on users, ponds, thresholds; reads logs, alerts, maintenance."],
      ["owner", "Only ponds assigned via user_pond_access.", "Reads dashboard data, edits thresholds for owned ponds, submits maintenance requests."],
      ["viewer", "Only ponds assigned via user_pond_access.", "Reads dashboard data only. Cannot submit maintenance requests."],
    ],
    { widths: [1600, 3600, 4160] },
  ),
  h2("Adding a User"),
  bullet("Click Add User. Enter name, email, optional company, role, and an initial password."),
  bullet("The password is hashed with bcryptjs before being stored in owners.password_hash."),
  bullet("Tick the checkboxes next to ponds to grant access; the form writes user_pond_access rows on save."),
  bullet("Email comparison is case-insensitive on login (a unique index on LOWER(email) enforces uniqueness)."),
  h2("Editing or Deleting a User"),
  p("Use the pencil icon to edit a user; you can change name, company, role, and pond access. Use the trash icon to delete a user — the database cascades deletions of their user_pond_access rows but preserves audit references via ON DELETE SET NULL."),
  screenshot("User management page with Add/Edit dialog"),

  h1("3. Pond Management"),
  p("Open /admin and choose the Ponds tab to manage pond records. Every physical pond in the field needs a row here before its ESP32 can stream data."),
  h2("Pond Codes"),
  p("Each pond has a unique code in the form PND-001 through PND-010. The ESP32 firmware sends an integer in the `pnd` field; the ingest route translates 1..10 into PND-001..PND-010 and looks up the row. The endpoint /api/admin/ponds/next-code suggests the next free code so you do not collide with existing ones."),
  h2("Pond Fields"),
  bullet("Pond code (auto-suggested, must be unique)."),
  bullet("Name (human-readable, e.g. \"Maluso Bay #3\")."),
  bullet("Company name (optional, for multi-tenant displays)."),
  bullet("Location (text)."),
  bullet("Capacity (cubic meters or your chosen unit)."),
  bullet("Area (square meters)."),
  h2("Removing a Pond"),
  p("Deleting a pond cascades deletes its readings (via ON DELETE CASCADE on sensor_readings.fk_sensor_readings_pond), its thresholds, alerts, status logs, and maintenance requests. Export the data first if you need to keep history."),
  screenshot("Pond management form with code, name, capacity"),

  h1("4. Ingestion Logs"),
  p("Open /admin/logs to inspect every ESP32 POST to /api/send-sensor-data. The page lists rows from the ingestion_logs table in descending time order."),
  h2("Reading a Row"),
  bullet("Received At — server timestamp at the moment the POST was processed."),
  bullet("Pond — pond_code resolved from the payload (blank if the pond did not exist)."),
  bullet("HTTP Status — 201 on success; 400/401/404/500 on various failure modes."),
  bullet("IP Address — taken from X-Forwarded-For or X-Real-IP, useful to identify which gateway hit the server."),
  bullet("Error Message — short tag like invalid_payload, pond_out_of_range, unknown_pond, db_error."),
  bullet("Raw Payload — the JSON body the ESP32 sent, stored as JSONB."),
  h2("Filtering and Exporting"),
  p("Use the filter bar to limit by pond, by HTTP status, or by date range. The Export CSV button downloads the current filter as a comma-separated file for offline analysis. Use this when you need to diagnose a flaky gateway."),
  screenshot("Ingestion logs page with filters and table"),

  h1("5. Notifications"),
  p("Open /notifications. The page has two tabs: Maintenance Requests and Sensor Alerts. The header bell shows the total unread count."),
  h2("Maintenance Requests"),
  p("Owners submit requests via the Request Maintenance button. Each request lands in the Pending state and shows pond, requester, message, and timestamp."),
  bullet("Click Acknowledge to mark the request as seen. The status becomes Acknowledged and the pond keeps its blue Maintenance dot."),
  bullet("Click Resolve to mark it fixed. You can attach an admin_note explaining what you did. The pond's blue dot disappears immediately on the next status poll."),
  h2("Sensor Alerts"),
  p("The Sensor Alerts tab lists rows from sensor_alerts. Each row shows pond, sensor, the value that triggered, the optimal range at trigger time, and the consecutive count (always 7 in the current configuration)."),
  bullet("Click Acknowledge to silence the alert. The alert engine will only fire a new alert for the same pond/sensor combination after another 7 consecutive out-of-range readings."),
  bullet("Alerts cannot be deleted, only acknowledged — the table is an append-only audit log."),
  screenshot("Notifications page showing both tabs"),

  h1("6. Threshold Settings"),
  p("Thresholds drive the alert engine and the anomaly count on charts. Open /settings/thresholds. Admins can edit any pond; owners can only edit ponds they own."),
  h2("Editing a Threshold"),
  bullet("Pick a sensor (temperature, pH, salinity, or dissolved oxygen)."),
  bullet("Enter optimal_min and optimal_max — min must be strictly less than max."),
  bullet("Pick which ponds to apply to — bulk update is supported."),
  bullet("Save. The PATCH writes an audit row for every affected pond before upserting."),
  h2("Audit History"),
  p("GET /api/thresholds/history?pond=N&sensor=X returns the audit trail. The dashboard exposes this as a small History link per row. Use it to debug \"why did this alert fire?\" by checking whether the range was changed recently."),
  screenshot("Threshold edit page with bulk-update selector"),

  h1("7. Utilization Page"),
  p("Open /utilization. Pick the ponds you want to compare, the from and to dates, and the page renders a stacked-bar chart showing what percentage of each pond's time was Online, Stale, Offline, or in Maintenance."),
  h2("How Percentages Are Computed"),
  p("Utilization is derived from the pond_status_log table. Every successful ESP32 ingest writes one heartbeat row. The /api/utilization endpoint looks at the gaps between consecutive heartbeats inside the window and classifies them: gap below 60 seconds is Online, below 180 seconds is Stale, otherwise Offline. Maintenance intervals (from maintenance_requests) override every other status — those minutes are counted as Maintenance."),
  p("Maintenance time always wins over heartbeat-derived time so the same wall-clock minute is never double-counted. Percentages are computed from raw minutes (never rounded display values), so the four numbers always sum to 100% unless the pond has zero history in the window."),
  h2("Range Limits and Export"),
  bullet("Maximum window: 90 days. Larger windows return an error."),
  bullet("Use pond IDs (comma separated), the literal \"all\", or \"mine\" in the API."),
  bullet("Export CSV from the page header for offline reporting."),
  screenshot("Utilization stacked-bar chart and date picker"),

  h1("8. Alert System"),
  h2("Trigger Logic"),
  p("Implemented in src/lib/alerts.ts. The function runAlertChecks is called from /api/send-sensor-data after every successful ingest. For each non-null sensor value:"),
  bullet("Load optimal_min and optimal_max from pond_sensor_thresholds for that (pond, sensor)."),
  bullet("Pull the last 7 readings for that sensor on that pond, ordered DESC."),
  bullet("If all 7 are below min or all 7 are above max, attempt to create an alert."),
  bullet("If an unacknowledged alert already exists for that (pond, sensor), do nothing (avoids spam)."),
  bullet("Otherwise insert a new sensor_alerts row and the popup appears on next dashboard poll."),
  h2("Re-trigger Behaviour"),
  p("Migration 010 removed the strict one-active-alert constraint and replaced it with a non-unique index on unacknowledged rows. After you acknowledge an alert, the next time 7 consecutive bad readings come in, a new alert is created. This prevents silent failure on long-running issues."),
  screenshot("Alert detail with triggered_at, consecutive_count, and Acknowledge button"),

  h1("9. System Status"),
  p("System Status on the dashboard tells you the platform's health at a glance. Each pond contributes its own status as derived by getPondStatus() in src/lib/pondStatus.ts, and the aggregator is documented below."),
  table(
    ["Aggregate", "Meaning"],
    [
      ["Healthy", "Every pond reporting is Online (last seen < 1 minute)."],
      ["Degraded", "At least one pond is Stale (last seen 1-3 minutes)."],
      ["Offline", "Every pond is Offline or no pond has reported recently."],
    ],
    { widths: [2000, 7360] },
  ),
  p("Maintenance does not by itself flip System Status to Degraded — it only flips the affected pond's individual dot. This avoids alarming admins when a planned outage is scheduled."),
];

const doc = makeDoc(children, TITLE);

const out = path.join(__dirname, "..", "..", "docs", "Admin-Guide.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log("wrote", out);
});
