import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LatestRow = {
  time: Date;
  pond_id: number;
  temperature: number | null;
  ph: number | null;
  salinity: number | null;
  dissolved_oxygen: number | null;
};

export async function GET(req: NextRequest) {
  const pondParam = new URL(req.url).searchParams.get("pond");
  if (pondParam === null) {
    return NextResponse.json({ error: "missing_pond" }, { status: 400 });
  }
  const pondId = Number(pondParam);
  if (!Number.isFinite(pondId)) {
    return NextResponse.json({ error: "invalid_pond" }, { status: 400 });
  }

  const { rows: existing } = await pool.query<{ id: number }>(
    `SELECT id FROM ponds WHERE id = $1 LIMIT 1`,
    [pondId]
  );
  if (existing.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { rows } = await pool.query<LatestRow>(
    `SELECT time, pond_id,
            ROUND(temperature::numeric, 2)::float8       AS temperature,
            ROUND(ph::numeric, 2)::float8                AS ph,
            ROUND(salinity::numeric, 2)::float8          AS salinity,
            ROUND(dissolved_oxygen::numeric, 2)::float8  AS dissolved_oxygen
       FROM sensor_readings
      WHERE pond_id = $1
      ORDER BY time DESC
      LIMIT 1`,
    [pondId]
  );

  if (rows.length === 0) {
    return NextResponse.json({
      pondId: String(pondId),
      time: null,
      timestamp: null,
      temperature: null,
      ph: null,
      salinity: null,
      dissolved_oxygen: null,
    });
  }

  const r = rows[0];
  return NextResponse.json({
    pondId: String(r.pond_id),
    time: r.time.toISOString(),
    timestamp: r.time.getTime(),
    temperature: r.temperature,
    ph: r.ph,
    salinity: r.salinity,
    dissolved_oxygen: r.dissolved_oxygen,
  });
}
