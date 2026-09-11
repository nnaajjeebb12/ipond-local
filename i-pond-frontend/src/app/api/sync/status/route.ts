import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { checkOnline, countPending, lastSyncAt } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sync status for the dashboard indicator.
 *
 * The connectivity probe is cached briefly: this endpoint is polled by every
 * open tab, and each miss costs a real network round trip with an 8s timeout.
 */

const ONLINE_CACHE_MS = 30_000;

let cachedOnline: { at: number; online: boolean; serverReachable: boolean } | null = null;

async function onlineCached() {
  const now = Date.now();
  if (cachedOnline && now - cachedOnline.at < ONLINE_CACHE_MS) return cachedOnline;
  const net = await checkOnline();
  cachedOnline = { at: now, online: net.online, serverReachable: net.serverReachable };
  return cachedOnline;
}

export async function GET() {
  try {
    const [lastAt, pending, net] = await Promise.all([
      lastSyncAt(pool),
      countPending(pool),
      onlineCached(),
    ]);

    return NextResponse.json({
      lastSyncAt: lastAt,
      pendingCount: pending,
      online: net.online,
      serverReachable: net.serverReachable,
      configured: !!process.env.SYNC_TOKEN,
    });
  } catch (err) {
    console.error("sync_status_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
