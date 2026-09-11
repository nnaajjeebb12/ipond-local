import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SENSORS = new Set([
  "temperature",
  "ph",
  "salinity",
  "dissolved_oxygen",
]);

type AuditRow = {
  id: string;
  pond_id: number;
  sensor: string;
  old_min: number | null;
  old_max: number | null;
  new_min: number;
  new_max: number;
  old_value: number | null;
  new_value: number | null;
  changed_at: Date;
  changed_by: string | null;
  changed_by_name: string | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const pondParam = url.searchParams.get("pond");
  const sensor = String(url.searchParams.get("sensor") ?? "");

  if (pondParam === null) {
    return NextResponse.json({ error: "missing_pond" }, { status: 400 });
  }
  const pondId = Number(pondParam);
  if (!Number.isFinite(pondId)) {
    return NextResponse.json({ error: "invalid_pond" }, { status: 400 });
  }
  if (!VALID_SENSORS.has(sensor)) {
    return NextResponse.json({ error: "invalid_sensor" }, { status: 400 });
  }

  const { rows } = await pool.query<AuditRow>(
    `SELECT a.id, a.pond_id, a.sensor, a.old_min, a.old_max, a.new_min, a.new_max,
            a.old_value, a.new_value,
            a.changed_at, a.changed_by, o.name AS changed_by_name
       FROM pond_sensor_thresholds_audit a
       LEFT JOIN owners o ON o.id = a.changed_by
      WHERE a.pond_id = $1 AND a.sensor = $2
      ORDER BY a.changed_at DESC
      LIMIT 200`,
    [pondId, sensor]
  );

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      pondId: r.pond_id,
      sensor: r.sensor,
      old_min: r.old_min,
      old_max: r.old_max,
      new_min: r.new_min,
      new_max: r.new_max,
      old_value: r.old_value,
      new_value: r.new_value,
      changed_at: r.changed_at.toISOString(),
      changed_by: r.changed_by,
      changed_by_name: r.changed_by_name,
    }))
  );
}
