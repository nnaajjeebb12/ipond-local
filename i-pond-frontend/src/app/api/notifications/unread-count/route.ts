import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await pool.query<{
    maintenance: string;
    alerts: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM maintenance_requests WHERE status = 'pending') AS maintenance,
       (SELECT COUNT(*) FROM sensor_alerts
          WHERE resolved_at IS NULL AND acknowledged_at IS NULL) AS alerts`
  );

  const maintenance = Number(rows[0]?.maintenance ?? 0);
  const alerts = Number(rows[0]?.alerts ?? 0);
  return NextResponse.json({
    total: maintenance + alerts,
    maintenance,
    alerts,
  });
}
