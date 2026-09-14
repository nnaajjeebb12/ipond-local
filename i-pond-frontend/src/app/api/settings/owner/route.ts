import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { syncTarget } from "@/lib/sync";
import {
  getSyncOwner,
  setSetting,
  SETTING_SYNC_OWNER_ID,
  SETTING_SYNC_OWNER_NAME,
  UUID_RE,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which main-server owner this appliance's readings are attributed to.
 *
 * Entirely local. The main server exposes no owner lookup and, by decision,
 * is not to be changed — so the name shown here is whatever the admin typed,
 * and a change of id is saved without remote verification. A wrong id is not
 * data loss: the next sync stops with `pond_mismatch`, marks nothing, and the
 * sidebar says so. Fix it here and sync resumes.
 *
 * GET — anyone.  PUT — local admin session only (@/lib/adminSession).
 */

type OwnerStatus = {
  ownerId: string | null;
  source: "db" | "env" | "none";
  name: string | null;
  target: string;
  admin: boolean;
};

async function status(req: NextRequest): Promise<OwnerStatus> {
  const owner = await getSyncOwner(pool);
  return {
    ownerId: owner.ownerId,
    source: owner.source,
    name: owner.name,
    target: syncTarget(),
    admin: isAdmin(req),
  };
}

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await status(req));
  } catch (err) {
    console.error("owner_status_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "admin_required" }, { status: 401 });
  }

  let body: { ownerId?: unknown; name?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim().toLowerCase() : "";
  if (!UUID_RE.test(ownerId)) {
    return NextResponse.json({ error: "invalid_owner_id" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  try {
    const before = await getSyncOwner(pool);
    await setSetting(pool, SETTING_SYNC_OWNER_ID, ownerId);
    await setSetting(pool, SETTING_SYNC_OWNER_NAME, name);
    console.log("sync_owner_changed", { from: before.ownerId, to: ownerId, name });
    return NextResponse.json(await status(req));
  } catch (err) {
    console.error("owner_update_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
