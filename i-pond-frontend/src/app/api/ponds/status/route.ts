import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPondStatus } from "@/lib/pondStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep in step with scripts/alert-worker.ts.
const REALERT_COOLDOWN = "24 hours";

type Row = {
  pond_id: number;
  last_seen: Date | null;
};

export async function GET() {
  const { rows } = await pool.query<Row>(
    // True last reading per pond, not "last reading in the past 25 minutes":
    // the old window made a pond offline for an hour look identical to one
    // that never sent anything, so the popup said "unknown duration" and no
    // never-seen rule could be applied. LATERAL + ORDER BY time DESC LIMIT 1
    // is one backward index probe per pond on (pond_id, time DESC).
    `SELECT p.id AS pond_id,
            last.time AS last_seen
       FROM ponds p
       LEFT JOIN LATERAL (
         SELECT sr.time FROM sensor_readings sr
          WHERE sr.pond_id = p.id
          ORDER BY sr.time DESC
          LIMIT 1
       ) last ON TRUE
      ORDER BY p.id`
  );

  const now = Date.now();
  const offlinePondIds: number[] = [];
  const offlineMinutes: number[] = [];
  const out = rows.map((r) => {
    const lastSeenMs = r.last_seen ? r.last_seen.getTime() : null;
    const minutes = lastSeenMs === null ? null : (now - lastSeenMs) / 60_000;
    const status = getPondStatus(lastSeenMs, now);
    // Never-seen ponds are not alerted on (no gateway = nothing to lose),
    // same rule as the worker. They still show as offline.
    if (status === "offline" && minutes !== null) {
      offlinePondIds.push(r.pond_id);
      offlineMinutes.push(Math.round(minutes));
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
  // Same rule as scripts/alert-worker.ts (mayRaise): skip when an alert for
  // this pond is still open, OR was acknowledged inside the cooldown —
  // otherwise acknowledging a pond that stays offline brought the popup
  // straight back on the next poll.
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
                 AND a.resolved_at IS NULL
                 AND (a.acknowledged_at IS NULL
                      OR a.acknowledged_at > NOW() - $3::interval)
            )`,
        [offlinePondIds, offlineMinutes, REALERT_COOLDOWN]
      );
    } catch (err) {
      console.error("connectivity_alert_insert_error", err);
    }
  }

  return NextResponse.json(out);
}
