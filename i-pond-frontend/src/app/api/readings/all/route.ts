import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = process.env.APP_TIMEZONE || "UTC";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 90;
const ROW_LIMIT = 100000;

type AllRow = {
  time: Date;
  pond_name: string;
  pond_id: number;
  temperature: number | null;
  ph: number | null;
  salinity: number | null;
  dissolved_oxygen: number | null;
};

async function allPondIds(): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(`SELECT id FROM ponds`);
  return rows.map((r) => r.id);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const pondsParam = (url.searchParams.get("ponds") ?? "").trim();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (!pondsParam) {
    return NextResponse.json({ error: "ponds_required" }, { status: 400 });
  }
  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "from_and_to_required" }, { status: 400 });
  }
  if (!ISO_DATE.test(fromParam) || !ISO_DATE.test(toParam)) {
    return NextResponse.json({ error: "invalid_date_format" }, { status: 400 });
  }

  const fromMs = Date.parse(`${fromParam}T00:00:00Z`);
  const toMs = Date.parse(`${toParam}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  if (toMs < fromMs) {
    return NextResponse.json({ error: "to_before_from" }, { status: 400 });
  }
  const spanDays = Math.round((toMs - fromMs) / (24 * 3600 * 1000));
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: "range_too_large", maxDays: MAX_RANGE_DAYS },
      { status: 400 }
    );
  }

  let pondIds: number[];
  try {
    if (pondsParam === "all") {
      pondIds = await allPondIds();
    } else {
      const requested = pondsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (requested.length === 0) {
        return NextResponse.json({ error: "invalid_pond_ids" }, { status: 400 });
      }
      pondIds = requested;
    }
  } catch (err) {
    console.error("readings_all_pond_lookup_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  if (pondIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  try {
    const sql = `
      SELECT
        sr.time,
        sr.pond_id,
        p.name AS pond_name,
        ROUND(sr.temperature::numeric, 2)::float8       AS temperature,
        ROUND(sr.ph::numeric, 2)::float8                AS ph,
        ROUND(sr.salinity::numeric, 2)::float8          AS salinity,
        ROUND(sr.dissolved_oxygen::numeric, 2)::float8  AS dissolved_oxygen
      FROM sensor_readings sr
      JOIN ponds p ON p.id = sr.pond_id
      WHERE sr.pond_id = ANY($1::int[])
        AND sr.time >= ($2::date::timestamp AT TIME ZONE $4)
        AND sr.time <  (($3::date::timestamp AT TIME ZONE $4) + INTERVAL '1 day')
      ORDER BY sr.time ASC, p.name ASC
      LIMIT ${ROW_LIMIT}
    `;
    console.log("readings/all:", { pondIds, fromParam, toParam, TZ });
    const { rows } = await pool.query<AllRow>(sql, [pondIds, fromParam, toParam, TZ]);
    console.log("readings/all row count:", rows.length);

    const data = rows.map((r) => ({
      time: r.time.getTime(),
      pondId: r.pond_id,
      pondName: r.pond_name,
      temperature: r.temperature,
      ph: r.ph,
      salinity: r.salinity,
      dissolved_oxygen: r.dissolved_oxygen,
    }));

    return NextResponse.json({ data, truncated: rows.length >= ROW_LIMIT });
  } catch (err) {
    console.error("readings_all_query_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
