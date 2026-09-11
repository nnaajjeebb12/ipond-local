import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  pond_id: number;
  pond_name: string | null;
  sensor: string;
  triggered_at: Date;
  consecutive_count: number;
  last_value: number;
  optimal_min: number;
  optimal_max: number;
  acknowledged_at: Date | null;
};

export async function GET() {
  const { rows } = await pool.query<Row>(
    `SELECT a.id, a.pond_id, p.name AS pond_name, a.sensor,
            a.triggered_at, a.consecutive_count,
            ROUND(a.last_value::numeric, 2)::float8 AS last_value,
            ROUND(a.optimal_min::numeric, 2)::float8 AS optimal_min,
            ROUND(a.optimal_max::numeric, 2)::float8 AS optimal_max,
            a.acknowledged_at
       FROM sensor_alerts a
       JOIN ponds p ON p.id = a.pond_id
      WHERE a.resolved_at IS NULL
        AND a.acknowledged_at IS NULL
      ORDER BY a.triggered_at DESC`
  );

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      pondId: r.pond_id,
      pondName: r.pond_name ?? `Pond ${r.pond_id}`,
      sensor: r.sensor,
      triggeredAt: r.triggered_at.toISOString(),
      consecutiveCount: r.consecutive_count,
      lastValue: r.last_value,
      optimalMin: r.optimal_min,
      optimalMax: r.optimal_max,
    }))
  );
}
