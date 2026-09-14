import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPondStatus } from "@/lib/pondStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  pond_id: number;
  last_seen: Date | null;
};

export async function GET() {
  const { rows } = await pool.query<Row>(
    `SELECT p.id AS pond_id,
            MAX(sr.time) AS last_seen
       FROM ponds p
       LEFT JOIN sensor_readings sr ON sr.pond_id = p.id
        AND sr.time >= NOW() - INTERVAL '25 minutes'
      GROUP BY p.id
      ORDER BY p.id`
  );

  const now = Date.now();
  const offlinePondIds: number[] = [];
  const offlineMinutes: number[] = [];
  const out = rows.map((r) => {
    const lastSeenMs = r.last_seen ? r.last_seen.getTime() : null;
    const minutes = lastSeenMs === null ? null : (now - lastSeenMs) / 60_000;
    const status = getPondStatus(lastSeenMs, now);
    if (status === "offline") {
      offlinePondIds.push(r.pond_id);
      // Same convention as the worker: -1 = never received anything.
      offlineMinutes.push(minutes === null ? -1 : Math.round(minutes));
    }
    return {
      pondId: r.pond_id,
      status,
      lastSeen: r.last_seen ? r.last_seen.toISOString() : null,
      minutesSinceLastData: minutes,
    };
  });

  // Raise a connectivity alert for each newly offline pond.
  //
  // There is NO unique index to lean on here: migration 010 dropped
  // idx_sensor_alerts_active on purpose so sensor alerts can re-fire after
  // acknowledgement, and ON CONFLICT DO NOTHING then conflicts on nothing.
  // Left unguarded, this endpoint — polled every 30 s by every open dashboard —
  // inserted a fresh connectivity alert per offline pond on every poll.
  // Guard the same way scripts/alert-worker.ts does: only when that pond has
  // no unacknowledged connectivity alert already.
  if (offlinePondIds.length > 0) {
    try {
      await pool.query(
        `INSERT INTO sensor_alerts
           (pond_id, sensor, triggered_at, consecutive_count, last_value, optimal_min, optimal_max)
         SELECT p.id, 'connectivity', NOW(), 1, o.minutes, 0, 0
           FROM unnest($1::int[], $2::float8[]) AS o(pond_id, minutes)
           JOIN ponds p ON p.id = o.pond_id
          WHERE NOT EXISTS (
              SELECT 1 FROM sensor_alerts a
               WHERE a.pond_id = p.id
                 AND a.sensor = 'connectivity'
                 AND a.acknowledged_at IS NULL
            )`,
        [offlinePondIds, offlineMinutes]
      );
    } catch (err) {
      console.error("connectivity_alert_insert_error", err);
    }
  }

  return NextResponse.json(out);
}
