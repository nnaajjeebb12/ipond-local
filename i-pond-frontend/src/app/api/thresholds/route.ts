import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOperatorId } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SENSORS = new Set([
  "temperature",
  "ph",
  "salinity",
  "dissolved_oxygen",
]);

type ThresholdRow = {
  id: string;
  pond_id: number;
  sensor: string;
  optimal_min: number;
  optimal_max: number;
  optimal_value: number | null;
  updated_at: Date;
  updated_by: string | null;
};

// ---------- GET /api/thresholds?pond=1 ----------

export async function GET(req: NextRequest) {
  const pondParam = new URL(req.url).searchParams.get("pond");
  if (pondParam === null) {
    return NextResponse.json({ error: "missing_pond" }, { status: 400 });
  }
  const pondId = Number(pondParam);
  if (!Number.isFinite(pondId)) {
    return NextResponse.json({ error: "invalid_pond" }, { status: 400 });
  }

  const { rows } = await pool.query<ThresholdRow>(
    `SELECT id, pond_id, sensor, optimal_min, optimal_max, optimal_value, updated_at, updated_by
       FROM pond_sensor_thresholds
      WHERE pond_id = $1
      ORDER BY sensor`,
    [pondId]
  );

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      pondId: r.pond_id,
      sensor: r.sensor,
      optimal_min: r.optimal_min,
      optimal_max: r.optimal_max,
      optimal_value: r.optimal_value,
      updated_at: r.updated_at.toISOString(),
      updated_by: r.updated_by,
    }))
  );
}

// ---------- PATCH /api/thresholds ----------

type PatchBody = {
  ponds?: unknown;
  sensor?: unknown;
  optimal_min?: unknown;
  optimal_max?: unknown;
  optimal_value?: unknown;
};

export async function PATCH(req: NextRequest) {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sensor = String(body.sensor ?? "");
  const optMin = Number(body.optimal_min);
  const optMax = Number(body.optimal_max);
  const pondsRaw = body.ponds;

  let optValue: number | null = null;
  if (body.optimal_value !== undefined && body.optimal_value !== null && body.optimal_value !== "") {
    const v = Number(body.optimal_value);
    if (!Number.isFinite(v)) {
      return NextResponse.json({ error: "invalid_optimal_value" }, { status: 400 });
    }
    optValue = v;
  }

  if (!VALID_SENSORS.has(sensor)) {
    return NextResponse.json({ error: "invalid_sensor" }, { status: 400 });
  }
  if (!Number.isFinite(optMin) || !Number.isFinite(optMax)) {
    return NextResponse.json({ error: "invalid_bounds" }, { status: 400 });
  }
  if (optMin >= optMax) {
    return NextResponse.json({ error: "min_must_be_less_than_max" }, { status: 400 });
  }
  if (optValue !== null && (optValue < optMin || optValue > optMax)) {
    return NextResponse.json({ error: "optimal_value_out_of_range" }, { status: 400 });
  }
  if (!Array.isArray(pondsRaw) || pondsRaw.length === 0) {
    return NextResponse.json({ error: "ponds_required" }, { status: 400 });
  }

  const pondIds: number[] = [];
  for (const p of pondsRaw) {
    const n = Number(p);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "invalid_pond_id" }, { status: 400 });
    }
    pondIds.push(Math.trunc(n));
  }

  const operatorId = await getOperatorId();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updated: ThresholdRow[] = [];
    for (const pondId of pondIds) {
      const { rows: cur } = await client.query<{
        optimal_min: number | null;
        optimal_max: number | null;
        optimal_value: number | null;
      }>(
        `SELECT optimal_min, optimal_max, optimal_value
           FROM pond_sensor_thresholds
          WHERE pond_id = $1 AND sensor = $2`,
        [pondId, sensor]
      );
      const oldMin = cur[0]?.optimal_min ?? null;
      const oldMax = cur[0]?.optimal_max ?? null;
      const oldValue = cur[0]?.optimal_value ?? null;

      await client.query(
        `INSERT INTO pond_sensor_thresholds_audit
            (pond_id, sensor, old_min, old_max, new_min, new_max, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [pondId, sensor, oldMin, oldMax, optMin, optMax, oldValue, optValue, operatorId]
      );

      const { rows: upserted } = await client.query<ThresholdRow>(
        `INSERT INTO pond_sensor_thresholds
            (pond_id, sensor, optimal_min, optimal_max, optimal_value, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6)
         ON CONFLICT (pond_id, sensor) DO UPDATE SET
            optimal_min   = EXCLUDED.optimal_min,
            optimal_max   = EXCLUDED.optimal_max,
            optimal_value = EXCLUDED.optimal_value,
            updated_at    = EXCLUDED.updated_at,
            updated_by    = EXCLUDED.updated_by
         RETURNING id, pond_id, sensor, optimal_min, optimal_max, optimal_value, updated_at, updated_by`,
        [pondId, sensor, optMin, optMax, optValue, operatorId]
      );
      updated.push(upserted[0]);
    }

    await client.query("COMMIT");

    return NextResponse.json({
      updated: updated.map((r) => ({
        id: r.id,
        pondId: r.pond_id,
        sensor: r.sensor,
        optimal_min: r.optimal_min,
        optimal_max: r.optimal_max,
        optimal_value: r.optimal_value,
        updated_at: r.updated_at.toISOString(),
        updated_by: r.updated_by,
      })),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("thresholds_patch_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  } finally {
    client.release();
  }
}
