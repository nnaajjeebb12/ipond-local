import { pool } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(
      "SELECT NOW() as time, COUNT(*) as total_readings FROM sensor_readings"
    );
    return NextResponse.json({
      status: "ok",
      db: "connected",
      serverTime: result.rows[0].time,
      totalReadings: result.rows[0].total_readings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        status: "error",
        db: "disconnected",
        error: message,
      },
      { status: 503 }
    );
  }
}
