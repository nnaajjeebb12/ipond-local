import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { ROLLUP_VIEW, rollupAnomalyCount, rollupAvg, rollupMax, rollupMin } from "@/lib/rollup";

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
type Health = "normal" | "warning" | "critical";

const RANGE_BUCKETS: Record<Exclude<Range, "today">, { bucket: string; interval: string; label: string }> = {
  "7d": { bucket: "1 hour", interval: "7 days", label: "1 hour" },
  "14d": { bucket: "3 hours", interval: "14 days", label: "3 hours" },
  "30d": { bucket: "6 hours", interval: "30 days", label: "6 hours" },
  "1y": { bucket: "1 day", interval: "365 days", label: "1 day" },
};

function deriveHealth(
  avg: number | null,
  mn: number | null,
  mx: number | null
): Health {
  if (avg === null || mn === null || mx === null) return "normal";
  const lowCrit = mn * 0.9;
  const highCrit = mx * 1.1;
  if (avg < lowCrit || avg > highCrit) return "critical";
  if (avg < mn || avg > mx) return "warning";
  return "normal";
}

async function pondExists(pondId: number): Promise<boolean> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM ponds WHERE id = $1 LIMIT 1`,
    [pondId]
  );
  return rows.length > 0;
}

async function allPondIds(): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(`SELECT id FROM ponds ORDER BY id`);
  return rows.map((r) => r.id);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sensorParam = (url.searchParams.get("sensor") ?? "").toLowerCase();
  const rangeParam = (url.searchParams.get("range") ?? "7d").toLowerCase() as Range;
  const pondParam = url.searchParams.get("pond");
  const pondsParam = url.searchParams.get("ponds");
  const sinceParam = url.searchParams.get("since");

  const column = SENSOR_COLUMNS[sensorParam];
  if (!column) {
    return NextResponse.json({ error: "invalid_sensor" }, { status: 400 });
  }
  if (!["today", "7d", "14d", "30d", "1y"].includes(rangeParam)) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  let sinceMs: number | null = null;
  if (sinceParam !== null) {
    const n = Number(sinceParam);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "invalid_since" }, { status: 400 });
    }
    sinceMs = n;
  }

  let pondId: number | null = null;
  let pondIds: number[] | null = null;

  if (pondParam !== null) {
    pondId = Number(pondParam);
    if (!Number.isFinite(pondId)) {
      return NextResponse.json({ error: "invalid_pond" }, { status: 400 });
    }
    if (!(await pondExists(pondId))) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  } else if (pondsParam !== null && pondsParam !== "all") {
    const ids = pondsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) {
      return NextResponse.json({ error: "invalid_ponds" }, { status: 400 });
    }
    const known = new Set(await allPondIds());
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return NextResponse.json({ error: "not_found", ponds: unknown }, { status: 404 });
    }
    pondIds = ids;
    if (ids.length === 1) {
      pondId = ids[0];
      pondIds = null;
    }
  }

  try {
    // ---------- TODAY ----------
    if (rangeParam === "today") {
      if (pondId !== null) {
        // Single pond: 1-minute averages straight from raw rows (<= 1440
        // points). The gateway sends a reading every few seconds, so a true
        // raw day is tens of thousands of points — too many for the browser
        // and, with LIMIT 5000, the old raw query stopped at ~01:20.
        //
        // Incremental polls pass `since` = the last bucket the client has.
        // That bucket is re-sent (it may still be filling) and the client
        // replaces it — see useReadings.
        const useSince = sinceMs !== null;
        const sql = useSince
          ? `SELECT time_bucket('1 minute', time) AS bucket,
                    ROUND(AVG(${column})::numeric, 2)::float8 AS value
               FROM sensor_readings
              WHERE pond_id = $1
                AND time >= time_bucket('1 minute', to_timestamp($2 / 1000.0))
              GROUP BY bucket
              ORDER BY bucket ASC
              LIMIT 5000`
          : `SELECT time_bucket('1 minute', time) AS bucket,
                    ROUND(AVG(${column})::numeric, 2)::float8 AS value
               FROM sensor_readings
              WHERE pond_id = $1
                AND time >= date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2
              GROUP BY bucket
              ORDER BY bucket ASC
              LIMIT 5000`;
        const params = useSince ? [pondId, sinceMs] : [pondId, TZ];
        const { rows } = await pool.query<{ bucket: Date; value: number | null }>(sql, params);
        return NextResponse.json({
          mode: "raw",
          data: rows
            .filter((r) => r.value !== null)
            .map((r) => ({ time: r.bucket.getTime(), value: r.value as number })),
        });
      }

      // Several ponds: 15-minute average across them, from the rollup.
      const idsFilter = pondIds ?? null;
      const sql = `SELECT (time_bucket('15 minutes', a.bucket AT TIME ZONE $1) AT TIME ZONE $1) AS bucket,
                          ${rollupAvg("a", column)} AS value
                     FROM ${ROLLUP_VIEW} a
                    WHERE a.bucket >= date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1
                          ${idsFilter ? "AND a.pond_id = ANY($2::int[])" : ""}
                    GROUP BY 1
                    ORDER BY 1 ASC
                    LIMIT 5000`;
      const params = idsFilter ? [TZ, idsFilter] : [TZ];
      const { rows } = await pool.query<{ bucket: Date; value: number | null }>(sql, params);
      return NextResponse.json({
        mode: "raw",
        data: rows
          .filter((r) => r.value !== null)
          .map((r) => ({ time: r.bucket.getTime(), value: r.value as number })),
      });
    }

    // ---------- 7d / 14d / 30d / 1y (aggregated, from the rollup) ----------
    const cfg = RANGE_BUCKETS[rangeParam];

    // Same statement for one pond, a list, or all: only the pond predicate
    // changes. Parameters are always referenced so Postgres can type them.
    //
    // GROUP BY is positional on purpose: the rollup has its own column named
    // `bucket`, and Postgres resolves an ambiguous GROUP BY name to the INPUT
    // column — which would silently group at 15 minutes for every range.
    const pondPredicate =
      pondId !== null
        ? "AND a.pond_id = $5"
        : pondIds
          ? "AND a.pond_id = ANY($5::int[])"
          : "";
    const sql = `SELECT (time_bucket($1::interval, a.bucket AT TIME ZONE $4) AT TIME ZONE $4) AS bucket,
                        ${rollupAvg("a", column)} AS avg,
                        ${rollupMin("a", column)} AS min,
                        ${rollupMax("a", column)} AS max,
                        ${rollupAnomalyCount("a", column)} AS anomaly_count,
                        AVG(pst.optimal_min)::float8 AS optimal_min,
                        AVG(pst.optimal_max)::float8 AS optimal_max
                   FROM ${ROLLUP_VIEW} a
                   LEFT JOIN pond_sensor_thresholds pst
                     ON pst.pond_id = a.pond_id
                    AND pst.sensor  = $2
                  WHERE a.bucket >= NOW() - $3::interval
                        ${pondPredicate}
                  GROUP BY 1
                  ORDER BY 1 ASC
                  LIMIT 2000`;
    const params: unknown[] = [cfg.bucket, column, cfg.interval, TZ];
    if (pondId !== null) params.push(pondId);
    else if (pondIds) params.push(pondIds);

    const { rows } = await pool.query<{
      bucket: Date;
      avg: number | null;
      min: number | null;
      max: number | null;
      anomaly_count: string;
      optimal_min: number | null;
      optimal_max: number | null;
    }>(sql, params);

    return NextResponse.json({
      mode: "aggregated",
      bucketSize: cfg.label,
      data: rows
        .filter((r) => r.avg !== null)
        .map((r) => ({
          time: r.bucket.getTime(),
          avg: r.avg as number,
          min: r.min as number,
          max: r.max as number,
          anomalyCount: Number(r.anomaly_count),
          health: deriveHealth(r.avg, r.optimal_min, r.optimal_max),
        })),
    });
  } catch (err) {
    console.error("readings_query_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
