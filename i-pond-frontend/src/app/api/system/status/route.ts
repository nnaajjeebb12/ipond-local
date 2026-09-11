import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "online", label: "Server Online" });
  } catch {
    return NextResponse.json(
      { status: "offline", label: "Server Offline" },
      { status: 503 }
    );
  }
}
