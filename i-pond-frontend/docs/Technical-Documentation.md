# Technical Documentation

**Developer Handover** — Soletronix iPond, the IoT Aquaculture Monitoring System.

## Table of Contents

1. [Project Setup](#1-project-setup)
2. [Architecture](#2-architecture)
3. [Key Libraries](#3-key-libraries)
4. [Authentication](#4-authentication)
5. [Database](#5-database)
6. [API Conventions](#6-api-conventions)
7. [Ingestion Pipeline](#7-ingestion-pipeline)
8. [Real-time Pattern](#8-real-time-pattern)
9. [Shared Utilities](#9-shared-utilities)
10. [Adding a New Page](#10-adding-a-new-page)
11. [Adding a New API Route](#11-adding-a-new-api-route)
12. [Common Gotchas](#12-common-gotchas)
13. [Environment Variables](#13-environment-variables)
14. [Deployment](#14-deployment)

---

## 1. Project Setup

### Prerequisites

- Node.js 20 LTS or newer.
- Docker Desktop (for the TimescaleDB container).
- A package manager (npm 10+).

### Install Steps

```bash
# 1. Clone and install
git clone <repo-url>
cd i-pond-frontend
npm install --legacy-peer-deps   # next-auth beta needs --legacy-peer-deps

# 2. Bring up the database
docker compose up -d
# migrations in db/migrations/ run automatically on first start.

# 3. Configure .env (see Environment Variables section).

# 4. Start dev server
npm run dev
# open http://localhost:3000
```

---

## 2. Architecture

### App Router Layout

All routes live under `src/app/` using the Next.js 16 App Router. Page files are `page.tsx`, server actions are in `src/app/actions/`, API handlers are `route.ts` files under `src/app/api/`. Every API route exports `runtime = "nodejs"` and `dynamic = "force-dynamic"` because we need access to the `pg` pool and never want cached responses.

### Server vs Client

- Pages are React Server Components by default; `"use client"` only for interactive widgets (charts, forms, modals).
- Session is read on the server via `auth()` in route handlers; the client reads through `Providers` (NextAuth `SessionProvider`).
- Data fetching from client components uses SWR with `/api/...` endpoints.

### File Map

| Path | Role |
|---|---|
| `src/app/api/` | All route handlers (auth + tenant-scoped reads, ingest, admin CRUD). |
| `src/app/dashboard/` | All-ponds, per-pond, per-sensor pages. |
| `src/app/admin/` | Admin console pages (users, ponds, logs). |
| `src/lib/` | Cross-cutting helpers: db pool, admin guard, alert engine, pond status. |
| `src/components/` | Re-usable widgets (`SensorCard`, `AlertPopup`, charts, layouts). |
| `src/hooks/` | SWR-backed hooks (`useApi`, `useAlerts`, `useMaintenance`, `useThresholds`, `useDashboardStats`, `useSystemHealth`). |
| `src/store/` | Zustand auth store for client-side mirror of session. |
| `src/auth.ts` / `src/auth.config.ts` | next-auth v5 server config and edge-safe callbacks. |

---

## 3. Key Libraries

| Library | Version | Used For |
|---|---|---|
| `next` | 16.2.3 | App Router, route handlers, server actions, image opt. |
| `next-auth` | 5.0.0-beta.25 | Auth: credentials provider, JWT sessions, middleware. |
| `bcryptjs` | ^2.4.3 | Password hashing in `/api/auth` and `/api/admin/users`. |
| `pg` | ^8.13.1 | PostgreSQL driver, configured as a pooled singleton in `src/lib/db.ts`. |
| `swr` | ^2.4.1 | Client-side data fetching and polling. |
| `zustand` | ^5.0.12 | Tiny store for auth mirror. |
| `uplot` | ^1.6.32 | Canvas charts for dashboards and reports. |
| `jspdf` + `jspdf-autotable` | ^4.2.1 + ^5.0.7 | Client-side PDF export. |
| `moment` | ^2.30.1 | Timezone-aware date formatting. |
| `axios` | ^1.15.0 | Outbound HTTP. |
| `react-hook-form` | ^7.72.1 | Forms in admin and settings pages. |
| `next-themes` | ^0.4.6 | Light/dark mode. |
| `tailwindcss` | ^4 | Styling. |

---

## 4. Authentication

### NextAuth Configuration

`src/auth.ts` wires the **Credentials** provider. `authorize()` looks up `owners` by `LOWER(email)`, compares the password with `bcrypt.compare`, and returns `{ id, email, name, role }` on success. The JWT callback in `src/auth.config.ts` copies `id` and `role` into the token; the session callback copies them back to `session.user`. Result: `session.user.role` is available everywhere.

### Session Shape

```ts
session = {
  user: {
    id: '8d3e...uuid',
    email: 'alice@example.com',
    name:  'Alice',
    role:  'admin' | 'owner' | 'viewer',
  },
  expires: '...'
}
```

### Role Checks

- `requireAdmin()` in `src/lib/admin.ts` returns `{ ok, userId }` for admins and `{ ok: false, res }` for everyone else — call it at the top of admin-only route handlers.
- Owner/viewer routes call `await auth()` directly and use `ownsPond(userId, pondId)` helpers (see `/api/readings`, `/api/thresholds`).

---

## 5. Database

### TimescaleDB

`sensor_readings` is a TimescaleDB hypertable partitioned by `time`, with the default chunk interval (7 days). All other tables are plain Postgres.

### Running Migrations

Migrations live in `db/migrations/` numbered `001..011` and are mounted into the TimescaleDB container at `/docker-entrypoint-initdb.d`. They run only on first start of the container. To re-apply manually:

```bash
# Re-run a single migration
docker exec -i soletronix-timescaledb \
  psql -U $POSTGRES_USER -d $POSTGRES_DB < db/migrations/004_optimal_ranges.sql

# Reset everything (DESTRUCTIVE)
docker compose down -v
docker compose up -d
```

---

## 6. API Conventions

- Every handler exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`.
- **Auth:** call `await auth()` first; respond 401 if no session.
- **Tenant scoping:** non-admins must pass through `ownsPond()` or a JOIN on `user_pond_access`.
- **Errors:** short JSON tags like `'invalid_payload'`, `'invalid_sensor'`, `'forbidden'`, `'db_error'` with appropriate HTTP status.
- **Body validation:** parse JSON inside `try/catch`, validate every field before SQL.
- **Bulk writes** use `BEGIN/COMMIT` with a pooled client (see `/api/thresholds` PATCH).
- All SQL uses **parameterized queries** via the `pg` pool — no string concatenation of user input.

---

## 7. Ingestion Pipeline

`src/app/api/send-sensor-data/route.ts` is the only public-write endpoint. Steps:

- Read `X-Forwarded-For` or `X-Real-IP` into `ip` for logging.
- Validate Authorization header equals `` `Bearer ${process.env.API_TOKEN}` ``. On mismatch: `401` + log.
- Parse JSON body. On parse error: `400 invalid_json` + log.
- Validate `body.data.pnd` is finite and between 1 and 10. Translate to `pond_code` `PND-XXX`.
- `SELECT id FROM ponds WHERE pond_code = $1`. Missing row: `404 unknown_pond` + log.
- `INSERT` into `sensor_readings` with `time = NOW()`.
- `INSERT` a heartbeat row into `pond_status_log` with `status='online'` (drives utilization).
- Call `runAlertChecks(pondId, values)` — may create `sensor_alerts` row.
- Always write an `ingestion_logs` row with raw payload, IP, `http_status`, `error_message`.

---

## 8. Real-time Pattern

The dashboard refreshes with SWR. Key choices:

- `/api/ponds/status` polls every 30 seconds for the dot color.
- `/api/readings?range=today` appends new points using the `since` query parameter; older windows refetch in full.
- SWR's `refreshWhenHidden` is disabled so polling pauses when the tab is hidden, reducing server load.
- `AlertPopup` hooks into `useAlerts` which polls `/api/alerts/active` and renders unacknowledged rows as toasts.
- Notification bell uses `/api/notifications/unread-count` with a short interval.

---

## 9. Shared Utilities

- `src/lib/db.ts` — singleton `pg` Pool, `max=10`, `idleTimeoutMillis 30s`. Reuses one pool across hot reloads.
- `src/lib/admin.ts` — `requireAdmin()` guard.
- `src/lib/alerts.ts` — `runAlertChecks(pondId, values)` + per-sensor `checkForAlert()`.
- `src/lib/pondStatus.ts` — `getPondStatus(lastSeenMs, hasMaintenance)` returns `'online' | 'stale' | 'offline' | 'maintenance'`. Also exports `STATUS_DOT_BG`, `STATUS_DOT_GLOW`, `STATUS_LABEL`, and `fmt(v)` that 2-decimal-rounds a number or returns `'—'`.
- `APP_TIMEZONE` env var controls the timezone used by `time_bucket()` in `/api/readings`.

---

## 10. Adding a New Page

```tsx
// 1. Create the route file:
// src/app/insights/page.tsx
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function InsightsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Insights</h1>
      {/* client widgets go here */}
    </main>
  );
}

// 2. Add a link in MainLayout.tsx so users can navigate to it.
// 3. If admin-only, wrap with requireAdmin or check role inline.
```

---

## 11. Adding a New API Route

```ts
// src/app/api/insights/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const isAdmin = session.user.role === 'admin';
  const { rows } = await pool.query(
    isAdmin
      ? 'SELECT ... FROM ... ORDER BY ...'
      : 'SELECT ... FROM ... JOIN user_pond_access upa ON ... WHERE upa.user_id = $1',
    isAdmin ? [] : [session.user.id]
  );

  return NextResponse.json(rows);
}
```

---

## 12. Common Gotchas

- **Humidity** has been removed everywhere — do not add it back to the ESP32 payload, DB, or UI.
- Timestamps are `TIMESTAMPTZ` in UTC. Convert to `APP_TIMEZONE` only for display.
- Round sensor values in SQL: `ROUND(::numeric, 2)::float8` — do not round on the client.
- Get pond status from `src/lib/pondStatus.ts` — never duplicate the 1-minute / 3-minute logic.
- Optimal ranges come from `pond_sensor_thresholds` — never hardcode.
- Modals use React Portals (`createPortal`) to avoid Tailwind stacking-context issues — do not nest modals deep inside layout components.
- `next-auth` v5 is in beta; `npm install` needs `--legacy-peer-deps`.
- Sensor alerts re-trigger after acknowledgement (migration `010`) — do not assume "one alert per pond per sensor".
- ESP32 firmware sends `rtd`, `ph`, `sal`, `dox` — different from the DB column names. Do not change the firmware mapping.

---

## 13. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. |
| `POSTGRES_USER` | yes | Container superuser, read by `docker-compose.yml`. |
| `POSTGRES_PASSWORD` | yes | Container password. |
| `POSTGRES_DB` | yes | Container DB name. |
| `API_TOKEN` | yes | Bearer token for `/api/send-sensor-data`. |
| `AUTH_SECRET` | yes | next-auth JWT signing secret (32 bytes). |
| `APP_TIMEZONE` | no | IANA tz for `time_bucket()`, default `UTC`. |
| `NEXTAUTH_URL` | no | Base URL in production (e.g. `https://ipond.example.com`). |
| `NODE_ENV` | no | `'development'` or `'production'`. |

---

## 14. Deployment

Recommended deployment splits the frontend from the database:

- **Frontend on Vercel:** `vercel link && vercel deploy --prod`. Set every env var in the Vercel dashboard.
- **Database on a dedicated VPS** or managed Postgres with TimescaleDB extension. Restore from `migrations/` on first run.
- Expose the DB to Vercel through **Cloudflare Tunnel** or **Tailscale** — never open Postgres to the public internet.
- ESP32 gateways POST to the public Next.js URL with the Bearer token, so they only need outbound HTTPS.
- Set `${process.env.DATABASE_URL}` on Vercel to the tunneled DB endpoint.
- Verify by hitting `/api/auth/signin` and `/api/admin/logs` once deployed.
