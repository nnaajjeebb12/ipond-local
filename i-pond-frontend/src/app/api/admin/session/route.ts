import { NextRequest, NextResponse } from "next/server";
import { sessionRemainingMs } from "@/lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const remaining = sessionRemainingMs(req);
  return NextResponse.json({
    admin: remaining !== null,
    expiresAt: remaining !== null ? new Date(Date.now() + remaining).toISOString() : null,
  });
}
