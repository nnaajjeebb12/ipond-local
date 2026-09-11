import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENSORS_PER_POND = 4;
const ACTIVE_WINDOW = "25 minutes";

type StatusRow = {
  total_ponds: string;
  active_ponds: string;
  last_received_at: Date | null;
};

export async function GET() {
  const { rows } = await pool.query<StatusRow>(
    `
      SELECT
        (SELECT COUNT(*) FROM ponds) AS total_ponds,
        (SELECT COUNT(DISTINCT sr.pond_id)
           FROM sensor_readings sr
          WHERE sr.time >= NOW() - INTERVAL '${ACTIVE_WINDOW}') AS active_ponds,
        (SELECT MAX(sr.time) FROM sensor_readings sr) AS last_received_at
    `
  );

  const totalPonds = Number(rows[0]?.total_ponds ?? 0);
  const activePonds = Number(rows[0]?.active_ponds ?? 0);
  const lastReceivedAt = rows[0]?.last_received_at ?? null;

  const minutesSinceLastData =
    lastReceivedAt === null
      ? null
      : (Date.now() - lastReceivedAt.getTime()) / 60_000;

  let systemStatus: "healthy" | "degraded" | "offline" = "offline";
  if (minutesSinceLastData !== null) {
    if (minutesSinceLastData < 20) systemStatus = "healthy";
    else if (minutesSinceLastData < 45) systemStatus = "degraded";
    else systemStatus = "offline";
  }

  return NextResponse.json({
    activePonds,
    activeSensors: activePonds * SENSORS_PER_POND,
    totalPonds,
    totalSensors: totalPonds * SENSORS_PER_POND,
    systemStatus,
    lastReceivedAt: lastReceivedAt ? lastReceivedAt.toISOString() : null,
    minutesSinceLastData,
  });
}
