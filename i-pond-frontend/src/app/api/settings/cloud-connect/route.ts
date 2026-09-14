import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { cloudPonds, cloudSignIn, type CloudPond } from "@/lib/cloudAccount";
import { checkOnline } from "@/lib/sync";
import { setSetting, SETTING_SYNC_OWNER_ID, SETTING_SYNC_OWNER_NAME } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Connect this appliance to a seeme-db.com account."
 *
 * The operator signs in with the account's email + password. The main server
 * answers with the account (id, name) — that becomes the cloud owner, no UUID
 * to remember — and with the account's ponds, which are reconciled with the
 * ponds here by pond_code:
 *
 *   on both        -> the MAIN SERVER's record wins (name, location, capacity,
 *                     area, company); the local row is updated and reported
 *   main only      -> created here
 *   here only      -> left alone and reported: those ponds must be created on
 *                     the main server (under this account) before their
 *                     readings can sync
 *
 * Needs the main server reachable — there is nothing to do offline. The
 * password is used for one round trip and never stored or logged. The cloud
 * credentials ARE the authorisation for this change: whoever holds the
 * account's password owns its data.
 */

const PROBE_TIMEOUT_MS = 5000;

type PondRow = { id: number; pond_code: string | null; name: string };

type Summary = {
  owner: { id: string; name: string; email: string; role: string };
  ponds: {
    cloudCount: number;
    updated: { pond_code: string; name: string }[];
    created: { pond_code: string; name: string }[];
    localOnly: { pond_code: string; name: string }[];
    /** Cloud ponds with no code — cannot be matched or synced; listed for information. */
    uncoded: { name: string }[];
  };
  note: string | null;
};

async function reconcile(client: PoolClient, cloud: CloudPond[]): Promise<Summary["ponds"]> {
  const { rows: local } = await client.query<PondRow>(`SELECT id, pond_code, name FROM ponds`);
  const localByCode = new Map(local.filter((p) => p.pond_code).map((p) => [p.pond_code as string, p]));

  const updated: Summary["ponds"]["updated"] = [];
  const created: Summary["ponds"]["created"] = [];
  const uncoded: Summary["ponds"]["uncoded"] = [];
  const cloudCodes = new Set<string>();

  for (const c of cloud) {
    const code = (c.pond_code ?? "").trim().toUpperCase();
    if (!code) {
      uncoded.push({ name: c.name });
      continue;
    }
    cloudCodes.add(code);
    const name = (c.name ?? "").trim() || code;
    const location = typeof c.location === "string" && c.location.trim() ? c.location.trim() : null;
    const capacity = Number.isFinite(Number(c.capacity)) && Number(c.capacity) > 0 ? Number(c.capacity) : null;
    const area = Number.isFinite(Number(c.area)) && Number(c.area) > 0 ? Number(c.area) : null;
    const company = typeof c.company_name === "string" && c.company_name.trim() ? c.company_name.trim() : null;

    const existing = localByCode.get(code);
    if (existing) {
      await client.query(
        `UPDATE ponds
            SET name = $2, location = $3, capacity = $4, area = $5, company_name = $6
          WHERE id = $1`,
        [existing.id, name, location, capacity, area, company]
      );
      updated.push({ pond_code: code, name });
    } else {
      await client.query(
        `INSERT INTO ponds (owner_id, name, pond_code, location, capacity, area, company_name)
         VALUES (NULL, $1, $2, $3, $4, $5, $6)`,
        [name, code, location, capacity, area, company]
      );
      created.push({ pond_code: code, name });
    }
  }

  const localOnly = local
    .filter((p) => p.pond_code && !cloudCodes.has(p.pond_code.toUpperCase()))
    .map((p) => ({ pond_code: p.pond_code as string, name: p.name }))
    .sort((a, b) => a.pond_code.localeCompare(b.pond_code));

  return { cloudCount: cloud.length, updated, created, localOnly, uncoded };
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "credentials_required" }, { status: 400 });
  }

  const net = await checkOnline(PROBE_TIMEOUT_MS);
  if (!net.serverReachable) {
    return NextResponse.json(
      {
        error: net.online ? "server_unreachable" : "offline",
        message: net.online
          ? "Main server unreachable — try again later."
          : "Requires internet connection to sign in to the main server.",
      },
      { status: 503 }
    );
  }

  const signIn = await cloudSignIn(email, password);
  if (!signIn.ok) {
    const status = signIn.reason === "invalid_credentials" ? 401 : signIn.reason === "subscription_expired" ? 403 : 502;
    const message =
      signIn.reason === "invalid_credentials"
        ? "The main server did not accept that email and password."
        : signIn.reason === "subscription_expired"
          ? "That account's subscription has expired on the main server."
          : `Could not sign in: ${signIn.detail}`;
    console.warn("cloud_connect_failed", { email, reason: signIn.reason });
    return NextResponse.json({ error: signIn.reason, message }, { status });
  }

  const { user, cookie } = signIn;

  // A viewer cannot own ponds on the main server, so readings attributed to
  // it would never match anything. Refuse rather than set up a broken sync.
  if (user.role === "viewer") {
    return NextResponse.json(
      {
        error: "viewer_account",
        message: `${user.name} is a viewer on the main server and cannot own ponds. Sign in with the site's owner account.`,
      },
      { status: 403 }
    );
  }

  let cloud: CloudPond[] = [];
  let note: string | null = null;
  if (user.role === "admin") {
    // /api/ponds lists EVERY pond in the system for an admin — importing that
    // here would be wrong. Take the account as owner but skip the pond import.
    note = `${user.name} is an admin account; the main server lists every site's ponds for admins, so no ponds were imported. Sign in with the site's owner account to import its ponds.`;
  } else {
    try {
      cloud = await cloudPonds(cookie);
    } catch (err) {
      console.error("cloud_connect_ponds_error", err);
      return NextResponse.json(
        { error: "ponds_failed", message: `Signed in, but could not list ponds: ${String(err)}` },
        { status: 502 }
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [SETTING_SYNC_OWNER_ID]);
    await setSetting(client, SETTING_SYNC_OWNER_ID, user.id);
    await setSetting(client, SETTING_SYNC_OWNER_NAME, user.name);
    const ponds = user.role === "admin"
      ? { cloudCount: 0, updated: [], created: [], localOnly: [], uncoded: [] }
      : await reconcile(client, cloud);
    await client.query("COMMIT");
    console.log("cloud_connected", {
      from: before.rows[0]?.value ?? null,
      to: user.id,
      name: user.name,
      role: user.role,
      updated: ponds.updated.length,
      created: ponds.created.length,
      localOnly: ponds.localOnly.length,
    });
    const summary: Summary = { owner: { id: user.id, name: user.name, email: user.email, role: user.role }, ponds, note };
    return NextResponse.json(summary);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("cloud_connect_db_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  } finally {
    client.release();
  }
}
