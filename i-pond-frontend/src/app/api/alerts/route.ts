import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full alert history (for /notifications page Sensor Alerts tab).

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
  acknowledged_by_name: string | null;
  resolved_at: Date | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const pondParam = url.searchParams.get("pond");
  const sensorParam = url.searchParams.get("sensor");
  const statusParam = url.searchParams.get("status"); // active|acknowledged|resolved|all

  const filters: string[] = [];
  const params: unknown[] = [];
  if (pondParam) {
    params.push(Number(pondParam));
    filters.push(`a.pond_id = $${params.length}`);
  }
  if (sensorParam) {
    params.push(sensorParam);
    filters.push(`a.sensor = $${params.length}`);
  }
  if (statusParam === "active") {
    filters.push(`a.resolved_at IS NULL AND a.acknowledged_at IS NULL`);
  } else if (statusParam === "acknowledged") {
    filters.push(`a.acknowledged_at IS NOT NULL AND a.resolved_at IS NULL`);
  } else if (statusParam === "resolved") {
    filters.push(`a.resolved_at IS NOT NULL`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows } = await pool.query<Row>(
    `SELECT a.id, a.pond_id, p.name AS pond_name, a.sensor,
            a.triggered_at, a.consecutive_count,
            ROUND(a.last_value::numeric, 2)::float8 AS last_value,
            ROUND(a.optimal_min::numeric, 2)::float8 AS optimal_min,
            ROUND(a.optimal_max::numeric, 2)::float8 AS optimal_max,
            a.acknowledged_at, ack.name AS acknowledged_by_name,
            a.resolved_at
       FROM sensor_alerts a
       JOIN ponds p ON p.id = a.pond_id
       LEFT JOIN owners ack ON ack.id = a.acknowledged_by
       ${where}
       ORDER BY a.triggered_at DESC
       LIMIT 500`,
    params
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
      acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
      acknowledgedByName: r.acknowledged_by_name,
      resolvedAt: r.resolved_at?.toISOString() ?? null,
    }))
  );
}
