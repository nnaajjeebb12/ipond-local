// scripts/seed-utilization.ts
// Generate simulated utilization data: heartbeats (pond_status_log) and
// maintenance_requests covering a fixed historical window. Used to populate
// the Utilization page with all four statuses for visual testing.
//
// Window default: 2026-05-07 00:00 UTC -> 2026-05-14 00:00 UTC (7 days
// ending 2026-05-13 inclusive).
//
// Run: npm run seed:utilization

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

// ---------- env ----------

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    // .env optional
  }
  return out;
}

const fileEnv = loadEnv();
const DATABASE_URL =
  process.env.DATABASE_URL ?? fileEnv.DATABASE_URL ?? null;

if (!DATABASE_URL) {
  console.error("DATABASE_URL missing. Set it in .env");
  process.exit(1);
}

// ---------- window ----------

const WIN_START = new Date("2026-05-07T00:00:00Z");
const WIN_END = new Date("2026-05-14T00:00:00Z"); // exclusive

// ---------- status mix ----------

type SeedStatus = "online" | "stale" | "offline" | "maintenance";

const STATUS_WEIGHTS: Record<SeedStatus, number> = {
  online: 50,
  stale: 15,
  offline: 25,
  maintenance: 10,
};

const HEARTBEAT_INTERVAL_SEC: Record<
  Exclude<SeedStatus, "maintenance">,
  [number, number]
> = {
  online: [20, 45],
  stale: [65, 160],
  offline: [220, 480],
};

const CHUNK_MIN_MINUTES = 20;
const CHUNK_MAX_MINUTES = 120;

const BATCH_SIZE = 1000;

// ---------- helpers ----------

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pickStatus(): SeedStatus {
  const total =
    STATUS_WEIGHTS.online +
    STATUS_WEIGHTS.stale +
    STATUS_WEIGHTS.offline +
    STATUS_WEIGHTS.maintenance;
  let r = Math.random() * total;
  for (const k of Object.keys(STATUS_WEIGHTS) as SeedStatus[]) {
    if ((r -= STATUS_WEIGHTS[k]) <= 0) return k;
  }
  return "online";
}

// ---------- main ----------

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const { rows: ponds } = await client.query<{ id: number }>(
      `SELECT id FROM ponds ORDER BY id`
    );
    if (ponds.length === 0) {
      console.error("No ponds found. Run admin/pond setup first.");
      process.exit(1);
    }

    const { rows: admins } = await client.query<{ id: string }>(
      `SELECT id FROM owners WHERE role = 'admin' ORDER BY email LIMIT 1`
    );
    if (admins.length === 0) {
      console.error("No admin owner found. Cannot seed maintenance_requests.");
      process.exit(1);
    }
    const adminId = admins[0].id;

    console.log(
      `Seeding window ${WIN_START.toISOString()} -> ${WIN_END.toISOString()}`
    );
    console.log(
      `Ponds: ${ponds.length}, admin owner: ${adminId.slice(0, 8)}…`
    );

    // Clean only the seed window so today's live heartbeats stay intact.
    const winStartIso = WIN_START.toISOString();
    const winEndIso = WIN_END.toISOString();
    const cleared = await client.query(
      `DELETE FROM pond_status_log
        WHERE recorded_at >= $1::timestamptz
          AND recorded_at <  $2::timestamptz`,
      [winStartIso, winEndIso]
    );
    const clearedMaint = await client.query(
      `DELETE FROM maintenance_requests
        WHERE created_at >= $1::timestamptz
          AND created_at <  $2::timestamptz`,
      [winStartIso, winEndIso]
    );
    console.log(
      `Cleared ${cleared.rowCount ?? 0} heartbeats, ${clearedMaint.rowCount ?? 0} maintenance rows from window.`
    );

    let totalHeartbeats = 0;
    let totalMaint = 0;

    for (const { id: pondId } of ponds) {
      const heartbeats: Date[] = [];
      const maintRanges: [Date, Date][] = [];

      let cursor = WIN_START.getTime();
      const end = WIN_END.getTime();

      while (cursor < end) {
        const chunkMinutes = randInt(CHUNK_MIN_MINUTES, CHUNK_MAX_MINUTES);
        const chunkEnd = Math.min(cursor + chunkMinutes * 60_000, end);
        const status = pickStatus();

        if (status === "maintenance") {
          maintRanges.push([new Date(cursor), new Date(chunkEnd)]);
        } else {
          const [lo, hi] = HEARTBEAT_INTERVAL_SEC[status];
          let t = cursor + randInt(0, 5) * 1000;
          while (t < chunkEnd) {
            heartbeats.push(new Date(t));
            t += randInt(lo, hi) * 1000;
          }
        }

        cursor = chunkEnd;
      }

      // Bulk insert heartbeats.
      for (let i = 0; i < heartbeats.length; i += BATCH_SIZE) {
        const slice = heartbeats.slice(i, i + BATCH_SIZE);
        const placeholders = slice
          .map((_, j) => `($1, 'online', $${j + 2}::timestamptz)`)
          .join(",");
        const values: (number | string)[] = [pondId];
        for (const d of slice) values.push(d.toISOString());
        await client.query(
          `INSERT INTO pond_status_log (pond_id, status, recorded_at) VALUES ${placeholders}`,
          values
        );
      }

      // Maintenance rows: insert one per range, requested_by = admin.
      for (const [s, e] of maintRanges) {
        await client.query(
          `INSERT INTO maintenance_requests
             (pond_id, requested_by, message, status,
              created_at, acknowledged_at, resolved_at)
           VALUES ($1, $2, $3, 'resolved', $4, $4, $5)`,
          [
            pondId,
            adminId,
            `Simulated maintenance window for utilization seed.`,
            s.toISOString(),
            e.toISOString(),
          ]
        );
      }

      totalHeartbeats += heartbeats.length;
      totalMaint += maintRanges.length;

      console.log(
        `pond ${pondId}: ${heartbeats.length} heartbeats, ${maintRanges.length} maintenance windows`
      );
    }

    console.log(
      `\nDone. ${totalHeartbeats} heartbeats, ${totalMaint} maintenance windows seeded.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
