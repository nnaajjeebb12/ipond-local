import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPondStatus } from "@/lib/pondStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  pond_id: number;
  last_seen: Date | null;
  has_maintenance: boolean;
};

export async function GET() {
  const { rows } = await pool.query<Row>(
    `SELECT p.id AS pond_id,
            MAX(sr.time) AS last_seen,
            EXISTS (
              SELECT 1 FROM maintenance_requests mr
               WHERE mr.pond_id = p.id AND mr.status = 'pending'
            ) AS has_maintenance
       FROM ponds p
       LEFT JOIN sensor_readings sr ON sr.pond_id = p.id
        AND sr.time >= NOW() - INTERVAL '25 minutes'
      GROUP BY p.id
      ORDER BY p.id`
  );

  const now = Date.now();
  const offlinePondIds: number[] = [];
  const out = rows.map((r) => {
    const lastSeenMs = r.last_seen ? r.last_seen.getTime() : null;
    const minutes = lastSeenMs === null ? null : (now - lastSeenMs) / 60_000;
    const status = getPondStatus(lastSeenMs, r.has_maintenance, now);
    if (status === "offline" && !r.has_maintenance) {
      offlinePondIds.push(r.pond_id);
    }
    return {
      pondId: r.pond_id,
      status,
      hasMaintenance: r.has_maintenance,
      lastSeen: r.last_seen ? r.last_seen.toISOString() : null,
      minutesSinceLastData: minutes,
    };
  });

  // Raise a connectivity alert for each newly offline pond. The partial unique
  // index on (pond_id, sensor) WHERE resolved_at IS NULL prevents duplicates,
  // and ON CONFLICT DO NOTHING keeps the call idempotent.
  if (offlinePondIds.length > 0) {
    try {
      await pool.query(
        `INSERT INTO sensor_alerts
           (pond_id, sensor, triggered_at, consecutive_count, last_value, optimal_min, optimal_max)
         SELECT id, 'connectivity', NOW(), 1, 0, 0, 0
           FROM ponds
          WHERE id = ANY($1::int[])
         ON CONFLICT DO NOTHING`,
        [offlinePondIds]
      );
    } catch (err) {
      console.error("connectivity_alert_insert_error", err);
    }
  }

  return NextResponse.json(out);
}
