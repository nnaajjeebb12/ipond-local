# User Guide

**For Pond Owners and Viewers** — Soletronix iPond, the IoT Aquaculture Monitoring System.

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard](#2-dashboard)
3. [Pond Cards](#3-pond-cards)
4. [Per Pond View](#4-per-pond-view)
5. [Sensor Values](#5-sensor-values)
6. [Alerts](#6-alerts)
7. [Reports](#7-reports)
8. [Notifications](#8-notifications)
9. [Settings — Optimal Ranges](#9-settings--optimal-ranges)
10. [Light and Dark Mode](#10-light-and-dark-mode)

---

## 1. Getting Started

Welcome to Soletronix iPond. This guide walks you, the pond owner or viewer, through everything you can do from your account. The platform gives you live readings, history, alerts, exports, maintenance requests, and customizable optimal ranges for each pond assigned to you.

### Signing In

Open the application URL provided by your administrator and you will land on the login screen. Enter the email address and password your administrator created for you and press **Sign In**. If your credentials are valid, you will be redirected to the dashboard. If they are not, the page will show a generic error — contact your administrator for a password reset.

> 📷 *Screenshot: Login screen with email and password fields*

### Dashboard Overview

After you sign in, you will see the main dashboard with three blocks. The left side shows global statistics for the ponds you can access: active sensors, system status, and pond count. The right side shows a card for every pond you own, each card showing the current values for the four sensors. The header bar shows your name, role, the notifications bell, and the light/dark theme toggle.

> 📷 *Screenshot: Dashboard overview with stats and pond cards*

---

## 2. Dashboard

The dashboard is your home screen. It refreshes automatically every few seconds and shows three pieces of information.

### Active Sensors

The Active Sensors card counts how many sensors are reporting recent data across all the ponds assigned to you. A sensor is counted as active when at least one reading has arrived from its pond within the last minute. The number can change quickly as ESP32 gateways come and go from the network.

### System Status

System Status summarizes how healthy the platform is right now: **Healthy** when every pond is online, **Degraded** when one or more ponds are stale, and **Offline** when no pond has reported in the last few minutes. The pill color matches the status (green, amber, or red).

### Pond Network

Pond Network is a count of how many ponds you are currently authorized to view. Admins see all ponds; owners and viewers see only the ponds your administrator has shared with you in the `user_pond_access` table.

> 📷 *Screenshot: Stats strip showing Active Sensors, System Status, Pond Network*

---

## 3. Pond Cards

Every pond you can see is rendered as a card in the dashboard grid. Each card refreshes in the background using SWR and shows four sensor tiles: temperature, pH, salinity, and dissolved oxygen.

### Status Dot

Each card has a coloured dot next to the pond name. The colour is the pond's overall status, derived from the most recent reading and any open maintenance request:

- 🟢 **Green (Online)** — last reading less than 1 minute ago.
- 🟡 **Amber (Stale)** — last reading between 1 and 3 minutes ago.
- 🔴 **Red (Offline)** — no reading in the last 3 minutes.
- 🔵 **Blue (Maintenance)** — a maintenance request is open for this pond, overrides every other status.

### Reading Live Values

The four tiles show the latest measured value, rounded to two decimal places. A dash is shown when no value has been recorded yet. Hover over a tile (or tap it on touch devices) to see additional context such as the units.

### Opening a Pond

Click anywhere on the card to open the per-pond detail view, where you can pick a date range, see history charts, and dig into each sensor.

> 📷 *Screenshot: Single pond card showing live values, status dot, and tile layout*

---

## 4. Per Pond View

Each pond has its own detail page at `/dashboard/[pondId]`. The header at the top of the page repeats the pond code (`PND-001` to `PND-010`), the human name, and the current status. Below the header is a chart strip with one chart per sensor.

### Time Range

Use the range picker at the top of the chart strip to switch between presets:

- **Today** — 5-minute buckets for every reading received since midnight.
- **7 Days** — 1-hour buckets across the last week.
- **14 Days** — 2-hour buckets across the last fortnight.
- **30 Days** — 6-hour buckets across the last month.
- **1 Year** — daily buckets across the last 365 days.

Today mode is fully live: new readings are appended to the chart without re-fetching the full window. Aggregated ranges re-fetch periodically.

### Trend Arrows and Anomaly Badges

Each sensor chart has a small badge on top showing the current trend (rising, falling, or stable) for the chosen range. A second badge shows how many readings in the window were outside the optimal range — these are the anomalies. A high anomaly count usually means the sensor needs attention or the optimal range needs to be adjusted.

### Drilling Into One Sensor

Click any chart to open the deep-dive page at `/dashboard/[pondId]/[sensorType]`. You will see a full-width chart, optimal-range shading, anomaly markers, and a numerical summary (min / max / average / current).

> 📷 *Screenshot: Per pond view with four charts and the range picker*

---

## 5. Sensor Values

The platform monitors four water-quality variables. Each one has a default optimal range, but your administrator (or you, depending on your role) can override the range per pond.

| Sensor | Unit | Default Optimal Range | Why It Matters |
|---|---|---|---|
| Temperature | °C | 22.0 to 27.0 | Water temperature drives metabolism. Too high reduces dissolved oxygen; too low slows growth. |
| pH | — | 6.5 to 7.5 | Affects ammonia toxicity and nutrient availability. Sudden drops indicate stress events. |
| Salinity | ppt | 15.0 to 30.0 | Critical for brackish species. Drift outside range can be lethal. |
| Dissolved Oxygen | mg/L | 5.0 to 8.0 | Below 5 mg/L is dangerous; sustained low DO causes fish kill events. |

Numbers are always rounded to two decimal places on screen. If a reading is missing, you will see a dash.

---

## 6. Alerts

The platform triggers an alert when a sensor produces seven consecutive out-of-range readings. The alert appears as a popup in the bottom-right of the screen and as a numbered badge on the bell in the header. Only unacknowledged alerts contribute to the badge.

### What Triggers an Alert

Every successful ESP32 ingest runs a check. The check looks at the last seven readings for each sensor of the pond. If all seven are below the `optimal_min` or all seven are above the `optimal_max` for the pond's current threshold, an alert row is inserted and the popup appears next time the dashboard polls.

### Acknowledging an Alert

Click **Acknowledge** on the popup or on the row inside the Notifications page. Acknowledging stops the popup from re-appearing for the same event, but the system will trigger a new alert if seven new out-of-range readings come in afterwards. This protects against silent persistent issues.

> 📷 *Screenshot: Alert popup in the bottom-right with Acknowledge button*

---

## 7. Reports

The Reports page lets you export historical data as PDF or CSV. Open it from the side navigation. You can pick which ponds, which sensors, and which date range to include.

### Choosing a Date Range

- Use the preset buttons (Today, 7d, 14d, 30d, Custom).
- Pick a custom range with the from/to date pickers.
- **Export All** exports every pond you can access for the chosen range.

### PDF Export

PDF exports include a cover page with the pond list, generation timestamp, and the requested range. Inside, each sensor has its own section with a summary table (min, max, average, anomaly count) and a chart image. PDFs are generated client-side using jsPDF, so they download instantly.

### CSV Export

CSV exports are one row per reading: `timestamp, pond_code, temperature, ph, salinity, dissolved_oxygen`. Open the file in Excel, Google Sheets, or any analysis tool. Times are in your local timezone.

> 📷 *Screenshot: Reports page with date range and pond pickers*

---

## 8. Notifications

The Notifications page collects two streams: maintenance requests and sensor alerts. Use the two tabs at the top to switch between them. The bell in the header shows the total count of unread notifications across both streams.

### Submitting a Maintenance Request

On any pond card or per-pond view, the **Request Maintenance** button opens a dialog. Pick the pond, write what is wrong, and submit. The request immediately becomes a row with status **Pending**; the pond's status dot will turn blue (Maintenance) until an admin marks it resolved.

### Tracking Status

Each request has three possible states: **Pending** (just submitted), **Acknowledged** (an admin has seen it and is working on it), and **Resolved** (the issue is fixed). You will see the date and the admin's note once the request is resolved.

> 📷 *Screenshot: Notifications page with maintenance and alert tabs*

---

## 9. Settings — Optimal Ranges

Open Settings then Thresholds (`/settings/thresholds`) to view or change the optimal range for each sensor on each pond you own. Pick a sensor at the top, enter the new min and max, choose which ponds to apply the change to, and save.

The platform validates that min is strictly less than max and writes an audit row to `pond_sensor_thresholds_audit` every time you save. This lets your administrator review who changed what and when.

Changing the optimal range immediately affects two things:

- The anomaly count in your charts (recalculated on the next chart refresh).
- The alert engine (the next 7-in-a-row check uses the new range).

> 📷 *Screenshot: Thresholds page with min/max inputs and pond selector*

---

## 10. Light and Dark Mode

The header has a sun/moon toggle. Click it to switch the theme. The platform remembers your preference in the browser using `next-themes`; if you switch devices, you may need to pick the theme again on each device.

Both themes use the same data and same controls — only the colours change. Dark mode is gentler on the eyes for night-shift monitoring; light mode prints better when you take screenshots for reports.

> 📷 *Screenshot: Side-by-side: same dashboard in light and dark mode*
