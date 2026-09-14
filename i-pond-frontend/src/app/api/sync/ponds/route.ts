import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pond registration — MAIN SERVER side. Reference copy, like ../route.ts.
 *
 * A self-contained, additive file: drop it into the main server as
 * src/app/api/sync/ponds/route.ts and nothing else there changes. The
 * appliance's sync worker calls it before every batch so that a pond added
 * on the Pi exists under the owner on the server before its readings arrive,
 * instead of those readings coming back `unknown` and staying pending.
 *
 * Idempotent: a pond that already exists for (owner_id, pond_code) is left
 * untouched and reported in `existing`. Missing ones are created with the
 * name and location the appliance uses. Written as NOT EXISTS rather than
 * ON CONFLICT so it works whether the server's uniqueness index is per owner
 * (idx_ponds_owner_pond_code) or global.
 *
 *   POST /api/sync/ponds  { owner_id, ponds: [{ pond_code, name, location? }] }
 *   200 { ok, created: [codes], existing: [codes] }
 */

const MAX_PONDS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

type Body = { owner_id?: unknown; ponds?: unknown };
type IncomingPond = { pond_code?: unknown; name?: unknown; location?: unknown };

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

  const ownerId = String(body.owner_id ?? "");
  if (!UUID_RE.test(ownerId)) {
    return NextResponse.json({ error: "invalid_owner_id" }, { status: 400 });
  }
  if (!Array.isArray(body.ponds)) {
    return NextResponse.json({ error: "ponds_required" }, { status: 400 });
  }
  if (body.ponds.length > MAX_PONDS) {
    return NextResponse.json({ error: "too_many_ponds", max: MAX_PONDS }, { status: 400 });
  }

  const codes: string[] = [];
  const names: string[] = [];
  const locations: (string | null)[] = [];
  for (const raw of body.ponds as IncomingPond[]) {
    const code = String(raw?.pond_code ?? "").trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: "invalid_pond_code", pond_code: code }, { status: 400 });
    }
    const name = String(raw?.name ?? "").trim() || code;
    const location = typeof raw?.location === "string" && raw.location.trim() ? raw.location.trim() : null;
    if (codes.includes(code)) continue;
    codes.push(code);
    names.push(name);
    locations.push(location);
  }
  if (codes.length === 0) {
    return NextResponse.json({ ok: true, created: [], existing: [] });
  }

  try {
    const { rows: owner } = await pool.query(`SELECT 1 FROM owners WHERE id = $1`, [ownerId]);
    if (owner.length === 0) {
      return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
    }

    const { rows } = await pool.query<{ pond_code: string }>(
      `INSERT INTO ponds (owner_id, name, pond_code, location)
       SELECT $1::uuid, i.name, i.pond_code, i.location
         FROM unnest($2::text[], $3::text[], $4::text[]) AS i(pond_code, name, location)
        WHERE NOT EXISTS (
          SELECT 1 FROM ponds p
           WHERE p.owner_id = $1::uuid AND p.pond_code = i.pond_code
        )
       RETURNING pond_code`,
      [ownerId, codes, names, locations]
    );

    const created = rows.map((r) => r.pond_code);
    const existing = codes.filter((c) => !created.includes(c));
    if (created.length > 0) {
      console.log("sync_ponds_created", { ownerId, created });
    }
    return NextResponse.json({ ok: true, created, existing });
  } catch (err) {
    console.error("sync_ponds_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
