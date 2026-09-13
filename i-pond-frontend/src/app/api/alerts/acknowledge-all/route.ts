import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOperatorId } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Acknowledge every open alert in one statement. Used by "Acknowledge all" in
 * the popup and on the notifications page. Only touches rows that are still
 * unacknowledged and unresolved, so it is safe to click twice.
 */
export async function POST() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE sensor_alerts
          SET acknowledged_at = NOW(),
              acknowledged_by = $1
        WHERE acknowledged_at IS NULL
          AND resolved_at IS NULL`,
      [await getOperatorId()]
    );
    return NextResponse.json({ ok: true, acknowledged: rowCount ?? 0 });
  } catch (err) {
    console.error("alerts_acknowledge_all_error", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
