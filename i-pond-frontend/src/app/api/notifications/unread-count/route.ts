import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Maintenance requests are a main-server feature (owner -> Soletronix
  // tickets); the appliance has no one on the other end, so it counts alerts only.
  const { rows } = await pool.query<{ alerts: string }>(
    `SELECT COUNT(*)::text AS alerts FROM sensor_alerts
      WHERE resolved_at IS NULL AND acknowledged_at IS NULL`
  );
  const alerts = Number(rows[0]?.alerts ?? 0);
  return NextResponse.json({ total: alerts, alerts });
}
