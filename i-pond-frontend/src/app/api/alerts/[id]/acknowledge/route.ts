import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOperatorId } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  await pool.query(
    `UPDATE sensor_alerts
        SET acknowledged_at = NOW(),
            acknowledged_by = $2
      WHERE id = $1 AND acknowledged_at IS NULL`,
    [id, await getOperatorId()]
  );

  return NextResponse.json({ ok: true });
}
