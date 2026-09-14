import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner lookup — MAIN SERVER side. Reference copy, like ../route.ts.
 *
 * A self-contained, additive file: drop it into the main server as
 * src/app/api/sync/owner/route.ts and nothing else there changes. Until it is
 * deployed the appliance gets a bare 404, reads that as "not supported", and
 * shows the owner id without a name.
 *
 * Authenticated with SYNC_TOKEN (the same one the sync receiver uses). Returns
 * only what the appliance needs to display and to validate a change of owner.
 *
 *   GET /api/sync/owner?id=<uuid>
 *   200 { id, name, email }
 *   404 { error: "owner_not_found" }   <- the body is how the appliance tells
 *                                         "no such owner" from "no such route"
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const expected = process.env.SYNC_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "sync_not_configured" }, { status: 500 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_owner_id" }, { status: 400 });
  }

  try {
    const { rows } = await pool.query<{ id: string; name: string; email: string | null }>(
      `SELECT id, name, email FROM owners WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
    }
    return NextResponse.json({ id: rows[0].id, name: rows[0].name, email: rows[0].email });
  } catch (err) {
    console.error("sync_owner_lookup_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
