const fs = require("fs");
const path = require("path");
const { Packer, Paragraph, ImageRun, AlignmentType, TextRun } = require("docx");
const {
  p, h1, h1First, h2, h3, bullet, code, table,
  titlePage, tocSection, makeDoc,
} = require("./_helpers");

const TITLE = "Owner Manual";
const IMG_DIR = path.join(__dirname, "..", "..", "docs", "images", "owner-manual");

// Decode PNG width/height (bytes 16-19 = width, 20-23 = height, big-endian).
function pngSize(buf) {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

// Embed a PNG scaled to ~600px wide preserving aspect ratio,
// followed by an italic caption.
function imageShot(filename, caption) {
  const file = path.join(IMG_DIR, filename);
  const data = fs.readFileSync(file);
  const { w, h } = pngSize(data);
  const targetW = 600;
  const targetH = Math.round((h / w) * targetW);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 80 },
      children: [
        new ImageRun({ data, transformation: { width: targetW, height: targetH } }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: caption, italics: true, size: 18, color: "595959" })],
    }),
  ];
}

const children = [
  ...titlePage(TITLE, "For Pond Owners"),
  ...tocSection(TITLE),

  h1First("1. Signing In"),
  p("Open the application URL provided by your administrator. You will land on the See ME — Aquaculture Control sign-in page. Enter the email address and password your administrator created for you and press Sign In →. The page will redirect to the dashboard on success or show a generic \"Invalid email or password\" message on failure. Passwords are stored as bcrypt hashes — only your administrator can reset them."),
  ...imageShot("01-login.png", "Sign-in screen with email and password fields"),
  h3("What you cannot do here"),
  bullet("Self-register — accounts must be created by an administrator."),
  bullet("Reset your own password — request a reset through your administrator."),
  bullet("Sign in with a username — only email addresses are accepted."),

  h1("2. Dashboard — Control Center"),
  p("After login, the dashboard becomes your home screen at /dashboard, titled Control Center. It contains three areas: a system-overview strip across the top, a Pond Network grid of minimal pond cards, and a Sensor Trends comparison area below them."),
  h3("Left Sidebar"),
  p("The collapsible sidebar shows the navigation available to owners:"),
  bullet("Dashboard — this Control Center page."),
  bullet("Reports — PDF and CSV export centre."),
  bullet("Thresholds — optimal-range configuration."),
  bullet("Notifications — maintenance requests and sensor alerts."),
  p("Your name, email, and OWNER badge sit at the bottom of the sidebar, above the Sign Out button. A small theme toggle lives next to your name."),
  h3("System Overview Strip"),
  p("The strip summarizes the health of the ponds you can access:"),
  bullet("Total Ponds — count of ponds shared with you in user_pond_access."),
  bullet("Active Sensors — sensors reporting in the last minute, as a fraction of expected (4 sensors per pond)."),
  bullet("System Status (My Ponds) — Healthy when every pond is online, Degraded when one or more is stale, Offline when nothing has reported recently."),
  bullet("Last Update — wall-clock time of the most recent reading received."),
  h3("Pond Network"),
  p("Every pond you can access appears as a card showing the pond name, location, and a Request Maintenance button. A coloured dot in the corner of each card follows the shared getPondStatus() rules:"),
  bullet("Green (Online) — last reading less than 1 minute ago."),
  bullet("Amber (Stale) — last reading between 1 and 3 minutes ago."),
  bullet("Red (Offline) — no reading in the last 3 minutes."),
  bullet("Blue (Maintenance) — an open maintenance request overrides every other colour."),
  p("Click anywhere on the card to open the pond's detail page. The hint \"tap to view\" appears above the grid."),
  h3("Sensor Trends — Aggregated and Compare"),
  p("Beneath the cards, the Sensor Trends block shows charts for the ponds you have selected. Use the chip row to pick All Ponds or specific ponds, the range picker (Today / 7d / 14d / 30d) to scope the time window, and the Aggregated vs Compare Ponds toggle to switch between one averaged line and one line per pond."),
  ...imageShot("02-dashboard-light.png", "Control Center in the light theme — overview, Pond Network, and Sensor Trends"),

  h1("3. Pond Detail View"),
  p("Each pond has its own page at /dashboard/{pondId}. The header repeats the status dot, the pond code (e.g. PND-001), and the pond name, followed by three info tiles (Location, Capacity, Surface Area)."),
  p("Beneath the header is the Real-Time Sensors strip with four tiles — Temperature, pH Level, Dissolved Oxygen, Salinity. Each tile shows the latest reading rounded to two decimal places, the optimal range for the pond, and the timestamp of the last update. A coloured badge on each tile flags whether the current reading is OPTIMAL or in ALERT."),
  p("A ← Back to Ponds link in the top-left takes you back to the Control Center."),
  ...imageShot("04-pond-detail.png", "Pond Detail showing real-time sensor tiles and pond information"),

  h1("4. Single-Sensor Deep Dive"),
  p("Click any sensor tile on the pond detail page to drill into one sensor at /dashboard/{pondId}/{sensorType}. The deep-dive page has four sections:"),
  bullet("Range picker — Today / 7d / 14d / 30d with a manual refresh button and the \"last sync\" timestamp."),
  bullet("Current Reading — large tile with the latest value, the optimal range, and the time of last update."),
  bullet("Statistics — Current, Average, Maximum, Minimum across the chosen range, each in its own coloured tile."),
  bullet("Trend Analysis — a chart with optimal-range shading plus NOW / AVG / MIN / MAX summary rows."),
  p("This is the right view when you are investigating a specific event — for example, why dissolved oxygen dropped overnight, or whether a pH excursion was a sensor glitch or a real water-quality event."),
  ...imageShot("05-sensor-deep-dive.png", "Single-sensor deep dive for Temperature with statistics and trend chart"),

  h1("5. Reports — PDF and CSV Export"),
  p("The Reports page at /reports, labelled Export Center, is split into two cards: Export All Sensors and Single Sensor Report."),
  h3("Export All Sensors"),
  p("The top card exports every sensor for the pond(s) you choose, with all four sensors as columns."),
  bullet("Ponds — choose All My Ponds or click Select Specific to pick a subset."),
  bullet("Date Range — Today / Last 7 Days / Last 14 Days / Last 30 Days / Custom."),
  bullet("Download CSV — All Sensors — one CSV with timestamp, pond_code, temperature, ph, salinity, dissolved_oxygen."),
  bullet("Download PDF — All Sensors — a multi-page PDF with a cover page, per-sensor summary tables, and chart images. Both exports are generated client-side with jsPDF, so they download instantly."),
  h3("Single Sensor Report"),
  p("The bottom card produces a focused report on one sensor of one pond. Pick the pond, the sensor (Temperature, pH, Salinity, Dissolved Oxygen), the date range, and click Load Report Data →."),
  ...imageShot("06-reports.png", "Reports / Export Center with the Export All Sensors and Single Sensor cards"),

  h1("6. Optimal Range Settings"),
  p("Owners can tune the optimal range per sensor per pond at /settings/thresholds, labelled Optimal Range Settings."),
  h3("Apply To"),
  p("The top of the page lets you scope the change:"),
  bullet("Single Pond — apply to one selected pond."),
  bullet("Select Multiple — apply to several ponds at once."),
  bullet("All My Ponds — apply across every pond you own."),
  h3("Per-Sensor Cards"),
  p("Each sensor (Temperature, pH Level, Salinity, Dissolved Oxygen) has its own card with three fields:"),
  bullet("Optimal Min — lower bound of the healthy range."),
  bullet("Optimal Value — optional target value used by the chart as a centre line."),
  bullet("Optimal Max — upper bound of the healthy range."),
  p("The CURRENT label on the right shows the values currently stored for that sensor. Save writes the change immediately and inserts an audit row into pond_sensor_thresholds_audit. Show history expands a log of past changes for that sensor on that pond."),
  p("Changing the optimal range affects two things on the next refresh:"),
  bullet("The anomaly count on your charts is recalculated."),
  bullet("The alert engine uses the new range on the next 7-in-a-row check."),
  table(
    ["Sensor", "Unit", "Default Optimal Range", "Why It Matters"],
    [
      ["Temperature", "°C", "22.0 to 27.0", "Drives metabolism. Too high reduces dissolved oxygen; too low slows growth."],
      ["pH", "—", "6.5 to 7.5", "Affects ammonia toxicity and nutrient availability. Sudden drops indicate stress."],
      ["Salinity", "ppt", "15.0 to 30.0", "Critical for brackish species. Drift outside range can be lethal."],
      ["Dissolved Oxygen", "mg/L", "5.0 to 8.0", "Below 5 mg/L is dangerous; sustained low DO causes fish kill events."],
    ],
    { widths: [1800, 1200, 2400, 3960] },
  ),
  ...imageShot("07-thresholds.png", "Optimal Range Settings — Single Pond scope with Temperature, pH and Salinity cards"),

  h1("7. Notifications and Maintenance Requests"),
  p("The bell icon in the sidebar shows the count of unread notifications. Open /notifications to see your maintenance request history filterable by Status and Pond. Resolved requests show a green RESOLVED badge; pending ones show PENDING until an administrator acts."),
  h3("Submitting a Maintenance Request"),
  p("On any pond card or pond detail page, click Request Maintenance. Pick the pond, describe what is wrong, and submit. The pond's status dot turns blue (Maintenance) and the request appears here with status Pending. An administrator will acknowledge and resolve it; you will see the resolution note on the same row."),
  h3("Sensor Alerts"),
  p("When seven readings in a row fall outside the optimal range for a sensor, the platform inserts a sensor alert. A popup appears in the bottom-right corner of the screen with an Acknowledge button. Acknowledging stops the popup from re-appearing for the same event, but a new alert is raised if seven new out-of-range readings come in afterwards, so silent persistent issues keep surfacing."),
  ...imageShot("08-notifications.png", "Notifications page listing maintenance requests with status and pond filters"),

  h1("8. Light and Dark Themes"),
  p("The theme toggle is the small icon next to your name in the sidebar footer. The platform remembers your preference per browser via next-themes; on a new device you will need to choose the theme again. Both themes show identical data and identical controls — only the colours change. Dark mode is gentler on the eyes for night-shift monitoring; light mode prints better when you take screenshots for reports."),
  ...imageShot("03-dashboard-dark.png", "Control Center in the dark theme"),

  h1("9. Troubleshooting"),
  table(
    ["Symptom", "Likely Cause", "What To Do"],
    [
      ["A pond card shows red (Offline) and no values.", "The ESP32 gateway for that pond has not posted in 3+ minutes.", "Check power and Wi-Fi at the pond. If still offline, submit a maintenance request."],
      ["A pond card shows blue (Maintenance) but you didn't request it.", "An administrator opened a request on your behalf.", "Open /notifications to read the request details."],
      ["Your Control Center is empty after login.", "No ponds have been shared with your account yet.", "Ask your administrator to add you to user_pond_access for the relevant ponds."],
      ["An alert popup keeps re-appearing.", "Seven new out-of-range readings have arrived since you last acknowledged.", "Investigate the sensor and the optimal range — the issue is real, not a stuck popup."],
      ["Saving a threshold returns a validation error.", "Optimal Min is not strictly less than Optimal Max.", "Adjust the values so min < max; the API rejects equal or inverted bounds."],
      ["The Sign In button does nothing.", "Your password was likely reset.", "Contact your administrator to confirm and re-issue your password."],
    ],
    { widths: [3000, 3000, 3360] },
  ),
];

const doc = makeDoc(children, TITLE);

const out = path.join(__dirname, "..", "..", "docs", "Owner-Manual.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log("wrote", out);
});
