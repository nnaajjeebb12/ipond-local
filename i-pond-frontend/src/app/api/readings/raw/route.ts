import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = process.env.APP_TIMEZONE || "UTC";

const SENSOR_COLUMNS: Record<string, string> = {
  temperature: "temperature",
  ph: "ph",
  salinity: "salinity",
  dissolved_oxygen: "dissolved_oxygen",
  dox: "dissolved_oxygen",
};

const SENSOR_UNITS: Record<string, string> = {
  temperature: "°C",
  ph: "pH",
  salinity: "ppt",
  dissolved_oxygen: "mg/L",
  dox: "mg/L",
};

type Preset = "today" | "7d" | "14d" | "30d";

const PRESET_INTERVAL: Record<Preset, string> = {
  today: "1 day",
  "7d": "7 days",
  "14d": "14 days",
  "30d": "30 days",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 90;

async function pondExists(pondId: number): Promise<boolean> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM ponds WHERE id = $1 LIMIT 1`,
    [pondId]
  );
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sensorParam = (url.searchParams.get("sensor") ?? "").toLowerCase();
  const pondParam = url.searchParams.get("pond");
  const rangeParam = url.searchParams.get("range");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const column = SENSOR_COLUMNS[sensorParam];
  if (!column) {
    return NextResponse.json({ error: "invalid_sensor" }, { status: 400 });
  }

  if (!pondParam) {
    return NextResponse.json({ error: "pond_required" }, { status: 400 });
  }
  const pondId = Number(pondParam);
  if (!Number.isFinite(pondId)) {
    return NextResponse.json({ error: "invalid_pond" }, { status: 400 });
  }

  if (!(await pondExists(pondId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const useCustom = !!(fromParam || toParam);
  const usePreset = !!rangeParam;

  if (useCustom && usePreset) {
    return NextResponse.json({ error: "conflicting_params" }, { status: 400 });
  }

  try {
    let rows: { time: Date; value: number | null }[];

    if (useCustom) {
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
        return NextResponse.json({ error: "range_too_large", maxDays: MAX_RANGE_DAYS }, { status: 400 });
      }

      const sql = `
        SELECT time, ROUND(${column}::numeric, 2)::float8 AS value
          FROM sensor_readings
         WHERE pond_id = $1
           AND time >= ($2::date::timestamp AT TIME ZONE $4)
           AND time <  (($3::date::timestamp AT TIME ZONE $4) + INTERVAL '1 day')
         ORDER BY time ASC
         LIMIT 50000
      `;
      console.log("readings/raw custom:", { pondId, fromParam, toParam, TZ });
      const result = await pool.query<{ time: Date; value: number | null }>(sql, [
        pondId,
        fromParam,
        toParam,
        TZ,
      ]);
      rows = result.rows;
    } else {
      const preset = (rangeParam ?? "7d") as Preset;
      if (!(preset in PRESET_INTERVAL)) {
        return NextResponse.json({ error: "invalid_range" }, { status: 400 });
      }

      let sql: string;
      let params: unknown[];
      if (preset === "today") {
        sql = `
          SELECT time, ROUND(${column}::numeric, 2)::float8 AS value
            FROM sensor_readings
           WHERE pond_id = $1
             AND time >= date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2
           ORDER BY time ASC
           LIMIT 50000
        `;
        params = [pondId, TZ];
      } else {
        sql = `
          SELECT time, ROUND(${column}::numeric, 2)::float8 AS value
            FROM sensor_readings
           WHERE pond_id = $1
             AND time >= NOW() - $2::interval
           ORDER BY time ASC
           LIMIT 50000
        `;
        params = [pondId, PRESET_INTERVAL[preset]];
      }

      console.log("readings/raw preset:", { pondId, preset, TZ });
      const result = await pool.query<{ time: Date; value: number | null }>(sql, params);
      rows = result.rows;
    }

    const unit = SENSOR_UNITS[sensorParam] ?? "";
    const data = rows
      .filter((r) => r.value !== null)
      .map((r) => ({
        timestamp: r.time.getTime(),
        value: r.value as number,
        unit,
        pondId: String(pondId),
      }));

    console.log("readings/raw row count:", data.length);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("readings_raw_query_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
