import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sync receiver — runs on the MAIN server (seeme-db.com), not the appliance.
 *
 * Local Pis POST batches of readings here. Authenticated with SYNC_TOKEN, which
 * is deliberately separate from the ESP32 API_TOKEN so a compromised gateway
 * cannot bulk-write history and a leaked sync token cannot pose as a sensor.
 *
 * Idempotent: ON CONFLICT (pond_id, time) DO NOTHING means a re-sent batch is a
 * no-op, so the worker can safely re-send anything it failed to mark locally.
 */

const MAX_READINGS = 5000;

type IncomingReading = {
  time?: unknown;
  pond_id?: unknown;
  temperature?: unknown;
  ph?: unknown;
  salinity?: unknown;
  dissolved_oxygen?: unknown;
  source?: unknown;
};

type Body = { readings?: unknown };

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  const expected = process.env.SYNC_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "sync_not_configured" }, { status: 500 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.readings)) {
    return NextResponse.json({ error: "readings_required" }, { status: 400 });
  }
  if (body.readings.length === 0) {
    return NextResponse.json({ synced: 0 });
  }
  if (body.readings.length > MAX_READINGS) {
    return NextResponse.json(
      { error: "too_many_readings", max: MAX_READINGS },
      { status: 400 }
    );
  }

  const times: string[] = [];
  const pondIds: number[] = [];
  const temperature: (number | null)[] = [];
  const ph: (number | null)[] = [];
  const salinity: (number | null)[] = [];
  const dox: (number | null)[] = [];
  const source: string[] = [];

  for (const raw of body.readings as IncomingReading[]) {
    // Validate with Date.parse, but keep the ORIGINAL string: Postgres stores
    // microseconds and a JS Date would round them off, which would break both
    // the unique index and every future re-send.
    const t = String(raw?.time ?? "");
    if (!Number.isFinite(Date.parse(t))) {
      return NextResponse.json({ error: "invalid_time" }, { status: 400 });
    }
    const pondId = num(raw?.pond_id);
    if (pondId === null || !Number.isInteger(pondId) || pondId < 1) {
      return NextResponse.json({ error: "invalid_pond_id" }, { status: 400 });
    }

    times.push(t);
    pondIds.push(pondId);
    temperature.push(num(raw?.temperature));
    ph.push(num(raw?.ph));
    salinity.push(num(raw?.salinity));
    dox.push(num(raw?.dissolved_oxygen));
    source.push(
      typeof raw?.source === "string" && raw.source.trim() ? raw.source.trim() : "local-pi"
    );
  }

  try {
    // Unknown pond_ids would violate the ponds FK and abort the whole batch, so
    // they are filtered out here: one misconfigured pond must not block a sync.
    const { rowCount } = await pool.query(
      `INSERT INTO sensor_readings
         (time, pond_id, temperature, ph, salinity, dissolved_oxygen, source)
       SELECT b.time, b.pond_id, b.temperature, b.ph, b.salinity, b.dissolved_oxygen, b.source
         FROM unnest(
                $1::timestamptz[], $2::int[], $3::float8[],
                $4::float8[], $5::float8[], $6::float8[], $7::text[]
              ) AS b(time, pond_id, temperature, ph, salinity, dissolved_oxygen, source)
        WHERE EXISTS (SELECT 1 FROM ponds p WHERE p.id = b.pond_id)
       ON CONFLICT (pond_id, time) DO NOTHING`,
      [times, pondIds, temperature, ph, salinity, dox, source]
    );

    return NextResponse.json({ synced: rowCount ?? 0, received: times.length });
  } catch (err) {
    console.error("sync_insert_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
