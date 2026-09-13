import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sync receiver — the MAIN SERVER side of cloud sync.
 *
 * Production runs a copy of this on seeme-db.com (its own repo). This file is
 * kept in the appliance repo so the worker in src/lib/sync.ts and its receiver
 * live side by side and cannot drift apart again: the contract below is the
 * one the production receiver implements.
 *
 * Ponds are identified by (owner_id, pond_code), NOT by the Pi's local integer
 * pond_id. Every appliance numbers its ponds 1..10 and codes them PND-001..010,
 * so the cloud — which is multi-tenant — needs the owner to disambiguate.
 * pond_code is unique per owner there, not globally.
 *
 * Authenticated with SYNC_TOKEN, deliberately separate from the ESP32
 * API_TOKEN so a compromised gateway cannot bulk-write history and a leaked
 * sync token cannot pose as a sensor.
 *
 * Idempotent: ON CONFLICT (pond_id, time) DO NOTHING makes a re-sent batch a
 * no-op, so the worker may safely re-send anything it failed to mark.
 */

const MAX_READINGS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IncomingReading = {
  time?: unknown;
  owner_id?: unknown;
  pond_code?: unknown;
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
    return NextResponse.json({ ok: true, inserted: 0, skipped: 0 });
  }
  if (body.readings.length > MAX_READINGS) {
    return NextResponse.json(
      { error: "too_many_readings", max: MAX_READINGS },
      { status: 400 }
    );
  }

  const times: string[] = [];
  const ownerIds: string[] = [];
  const pondCodes: string[] = [];
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
    const ownerId = String(raw?.owner_id ?? "");
    if (!UUID_RE.test(ownerId)) {
      return NextResponse.json({ error: "invalid_owner_id" }, { status: 400 });
    }
    const pondCode = String(raw?.pond_code ?? "").trim();
    if (!pondCode) {
      return NextResponse.json({ error: "invalid_pond_code" }, { status: 400 });
    }

    times.push(t);
    ownerIds.push(ownerId);
    pondCodes.push(pondCode);
    temperature.push(num(raw?.temperature));
    ph.push(num(raw?.ph));
    salinity.push(num(raw?.salinity));
    dox.push(num(raw?.dissolved_oxygen));
    source.push(
      typeof raw?.source === "string" && raw.source.trim() ? raw.source.trim() : "local-pi"
    );
  }

  try {
    // Resolve (owner_id, pond_code) -> ponds.id in SQL. Readings whose pond
    // does not exist for that owner are dropped by the JOIN rather than
    // aborting the batch, and counted so the appliance can see the mismatch.
    const { rows } = await pool.query<{ inserted: string; matched: string }>(
      `WITH incoming AS (
         SELECT b.time, b.owner_id, b.pond_code, b.temperature, b.ph,
                b.salinity, b.dissolved_oxygen, b.source
           FROM unnest(
                  $1::timestamptz[], $2::uuid[], $3::text[], $4::float8[],
                  $5::float8[], $6::float8[], $7::float8[], $8::text[]
                ) AS b(time, owner_id, pond_code, temperature, ph,
                       salinity, dissolved_oxygen, source)
       ),
       matched AS (
         SELECT i.time, p.id AS pond_id, i.temperature, i.ph, i.salinity,
                i.dissolved_oxygen, i.source
           FROM incoming i
           JOIN ponds p ON p.owner_id = i.owner_id AND p.pond_code = i.pond_code
       ),
       ins AS (
         INSERT INTO sensor_readings
           (time, pond_id, temperature, ph, salinity, dissolved_oxygen, source)
         SELECT time, pond_id, temperature, ph, salinity, dissolved_oxygen, source
           FROM matched
         ON CONFLICT (pond_id, time) DO NOTHING
         RETURNING 1
       )
       SELECT (SELECT COUNT(*) FROM ins)::text     AS inserted,
              (SELECT COUNT(*) FROM matched)::text AS matched`,
      [times, ownerIds, pondCodes, temperature, ph, salinity, dox, source]
    );

    const inserted = Number(rows[0]?.inserted ?? 0);
    const matched = Number(rows[0]?.matched ?? 0);
    // Two very different kinds of "skipped": a duplicate is already on the
    // server and safe for the appliance to mark; an unknown (owner, pond_code)
    // is NOT on the server and the appliance must keep it pending. Report both
    // so the worker can tell them apart. `skipped` stays as their sum for
    // receivers/clients that only know the older shape.
    const unknown = times.length - matched;
    const duplicate = matched - inserted;
    return NextResponse.json({
      ok: true,
      inserted,
      duplicate,
      unknown,
      skipped: unknown + duplicate,
      received: times.length,
    });
  } catch (err) {
    console.error("sync_insert_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
