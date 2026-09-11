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

type Range = "today" | "7d" | "14d" | "30d" | "1y";

const RANGE_BUCKETS: Record<Range, { bucket: string; interval: string; label: string }> = {
  today: { bucket: "15 minutes", interval: "1 day", label: "15 minutes" },
  "7d": { bucket: "1 hour", interval: "7 days", label: "1 hour" },
  "14d": { bucket: "3 hours", interval: "14 days", label: "3 hours" },
  "30d": { bucket: "6 hours", interval: "30 days", label: "6 hours" },
  "1y": { bucket: "1 day", interval: "365 days", label: "1 day" },
};

async function allPondIds(): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(`SELECT id FROM ponds ORDER BY id`);
  return rows.map((r) => r.id);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sensorParam = (url.searchParams.get("sensor") ?? "").toLowerCase();
  const rangeParam = (url.searchParams.get("range") ?? "7d").toLowerCase() as Range;
  const pondsParam = url.searchParams.get("ponds");

  const column = SENSOR_COLUMNS[sensorParam];
  if (!column) {
    return NextResponse.json({ error: "invalid_sensor" }, { status: 400 });
  }
  if (!RANGE_BUCKETS[rangeParam]) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  const known = new Set(await allPondIds());

  let pondIds: number[];
  if (!pondsParam || pondsParam === "all") {
    pondIds = Array.from(known);
  } else {
    pondIds = pondsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (pondIds.length === 0) {
      return NextResponse.json({ error: "invalid_ponds" }, { status: 400 });
    }
    const unknown = pondIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return NextResponse.json({ error: "not_found", ponds: unknown }, { status: 404 });
    }
  }

  if (pondIds.length === 0) {
    return NextResponse.json({ bucketSize: RANGE_BUCKETS[rangeParam].label, series: [] });
  }

  const cfg = RANGE_BUCKETS[rangeParam];

  try {
    const { rows: pondMeta } = await pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM ponds WHERE id = ANY($1::int[]) ORDER BY id`,
      [pondIds]
    );

    const useToday = rangeParam === "today";

    const sql = useToday
      ? `SELECT sr.pond_id AS pond_id,
                (time_bucket($1::interval, sr.time AT TIME ZONE $4) AT TIME ZONE $4) AS bucket,
                ROUND(AVG(sr.${column})::numeric, 2)::float8 AS avg,
                ROUND(MIN(sr.${column})::numeric, 2)::float8 AS min,
                ROUND(MAX(sr.${column})::numeric, 2)::float8 AS max
           FROM sensor_readings sr
          WHERE sr.pond_id = ANY($2::int[])
            AND sr.time >= date_trunc('day', NOW() AT TIME ZONE $4) AT TIME ZONE $4
          GROUP BY sr.pond_id, bucket
          ORDER BY sr.pond_id, bucket ASC`
      : `SELECT sr.pond_id AS pond_id,
                (time_bucket($1::interval, sr.time AT TIME ZONE $4) AT TIME ZONE $4) AS bucket,
                ROUND(AVG(sr.${column})::numeric, 2)::float8 AS avg,
                ROUND(MIN(sr.${column})::numeric, 2)::float8 AS min,
                ROUND(MAX(sr.${column})::numeric, 2)::float8 AS max,
                COUNT(*) FILTER (
                  WHERE sr.${column} < pst.optimal_min
                     OR sr.${column} > pst.optimal_max
                ) AS anomaly_count
           FROM sensor_readings sr
           LEFT JOIN pond_sensor_thresholds pst
             ON pst.pond_id = sr.pond_id AND pst.sensor = $5
          WHERE sr.pond_id = ANY($2::int[])
            AND sr.time >= NOW() - $3::interval
          GROUP BY sr.pond_id, bucket, pst.optimal_min, pst.optimal_max
          ORDER BY sr.pond_id, bucket ASC`;

    const params = useToday
      ? [cfg.bucket, pondIds, cfg.interval, TZ]
      : [cfg.bucket, pondIds, cfg.interval, TZ, column];

    const { rows } = await pool.query<{
      pond_id: number;
      bucket: Date;
      avg: number | null;
      min: number | null;
      max: number | null;
      anomaly_count?: string;
    }>(sql, params);

    const byPond = new Map<
      number,
      { time: number; avg: number; min: number; max: number; anomalyCount: number; health: "normal" }[]
    >();
    for (const id of pondIds) byPond.set(id, []);
    for (const r of rows) {
      if (r.avg === null) continue;
      byPond.get(r.pond_id)?.push({
        time: r.bucket.getTime(),
        avg: r.avg,
        min: r.min ?? r.avg,
        max: r.max ?? r.avg,
        anomalyCount: Number(r.anomaly_count ?? 0),
        health: "normal",
      });
    }

    const series = pondMeta.map((p) => ({
      pondId: p.id,
      pondName: p.name,
      data: byPond.get(p.id) ?? [],
    }));

    return NextResponse.json({ bucketSize: cfg.label, series });
  } catch (err) {
    console.error("readings_compare_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
