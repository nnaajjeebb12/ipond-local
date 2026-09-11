import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { lastSyncAt, runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual "Sync to Cloud" from the dashboard. Runs the same runSync() the cron
 * worker uses, inline in the request.
 *
 * A module-level guard keeps two clicks (or a click landing on top of the cron
 * run within this process) from syncing concurrently. It does not coordinate
 * with the separate worker process — it does not need to, because rows are only
 * marked after the server confirms them and the receiver de-duplicates.
 */

let inFlight: Promise<unknown> | null = null;

export async function POST() {
  if (inFlight) {
    return NextResponse.json(
      { ok: false, reason: "already_running", message: "A sync is already running", synced: 0 },
      { status: 409 }
    );
  }

  const run = runSync(pool, (line) => console.log("[sync]", line));
  inFlight = run;

  try {
    const result = await run;
    const lastAt = await lastSyncAt(pool).catch(() => null);
    return NextResponse.json({ ...result, lastSyncAt: lastAt });
  } catch (err) {
    console.error("sync_trigger_error", err);
    return NextResponse.json(
      { ok: false, reason: "db_error", message: "Sync failed", synced: 0, pending: 0, batches: 0 },
      { status: 500 }
    );
  } finally {
    inFlight = null;
  }
}
