import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { checkOnline, lookupOwner, syncTarget } from "@/lib/sync";
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
 * GET  — anyone. Shows the id, where it came from, the last name the main
 *        server confirmed, and — when the server is reachable — a live check.
 * PUT  — local admin session only (@/lib/adminSession), and only when the
 *        main server is reachable and confirms the new owner exists. The
 *        value is saved to app_settings and takes effect for the next sync.
 */

const PROBE_TIMEOUT_MS = 3000;
const LOOKUP_TIMEOUT_MS = 6000;
const ONLINE_CACHE_MS = 30_000;

let onlineCache: { at: number; value: Awaited<ReturnType<typeof checkOnline>> } | null = null;

async function onlineCached() {
  if (onlineCache && Date.now() - onlineCache.at < ONLINE_CACHE_MS) return onlineCache.value;
  const value = await checkOnline(PROBE_TIMEOUT_MS);
  onlineCache = { at: Date.now(), value };
  return value;
}

type OwnerStatus = {
  ownerId: string | null;
  source: "db" | "env" | "none";
  /** Last name the main server confirmed (cached locally). */
  name: string | null;
  target: string;
  online: boolean;
  serverReachable: boolean;
  /** Result of a live lookup this request, when the server was reachable. */
  live: null | { supported: false; detail: string } | { supported: true; found: boolean };
  admin: boolean;
};

async function status(req: NextRequest, doLive: boolean): Promise<OwnerStatus> {
  const owner = await getSyncOwner(pool);
  const net = await onlineCached();
  let live: OwnerStatus["live"] = null;
  let name = owner.name;

  if (doLive && net.serverReachable && owner.ownerId) {
    const res = await lookupOwner(owner.ownerId, LOOKUP_TIMEOUT_MS);
    if (!res.supported) {
      live = { supported: false, detail: res.detail };
    } else if (res.found) {
      live = { supported: true, found: true };
      if (res.name !== name) {
        name = res.name;
        await setSetting(pool, SETTING_SYNC_OWNER_NAME, res.name).catch(() => {});
      }
    } else {
      live = { supported: true, found: false };
    }
  }

  return {
    ownerId: owner.ownerId,
    source: owner.source,
    name,
    target: syncTarget(),
    online: net.online,
    serverReachable: net.serverReachable,
    live,
    admin: isAdmin(req),
  };
}

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await status(req, true));
  } catch (err) {
    console.error("owner_status_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "admin_required" }, { status: 401 });
  }

  let body: { ownerId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim().toLowerCase() : "";
  if (!UUID_RE.test(ownerId)) {
    return NextResponse.json({ error: "invalid_owner_id" }, { status: 400 });
  }

  // Must be validated with the main server — a wrong owner would make every
  // future batch come back `unknown`, and there is no way to check it offline.
  const net = await checkOnline(PROBE_TIMEOUT_MS);
  onlineCache = { at: Date.now(), value: net };
  if (!net.serverReachable) {
    return NextResponse.json(
      {
        error: net.online ? "server_unreachable" : "offline",
        message: net.online
          ? "Main server unreachable — cannot verify the owner right now."
          : "Requires internet connection to verify with main server.",
      },
      { status: 503 }
    );
  }

  const lookup = await lookupOwner(ownerId, LOOKUP_TIMEOUT_MS);
  if (!lookup.supported) {
    return NextResponse.json(
      {
        error: "lookup_unsupported",
        message: `Cannot verify owners: ${lookup.detail}. Deploy /api/sync/owner on the main server first.`,
      },
      { status: 409 }
    );
  }
  if (!lookup.found) {
    return NextResponse.json(
      { error: "owner_not_found", message: "No owner with that ID exists on the main server." },
      { status: 404 }
    );
  }

  try {
    const before = await getSyncOwner(pool);
    await setSetting(pool, SETTING_SYNC_OWNER_ID, ownerId);
    await setSetting(pool, SETTING_SYNC_OWNER_NAME, lookup.name);
    console.log("sync_owner_changed", { from: before.ownerId, to: ownerId, name: lookup.name });
    return NextResponse.json(await status(req, false));
  } catch (err) {
    console.error("owner_update_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
