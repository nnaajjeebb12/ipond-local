import { NextResponse } from "next/server";
import { getLicenseInfo } from "@/lib/license";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const info = getLicenseInfo();
  return NextResponse.json({
    valid: info.valid,
    client: info.client,
    expiresAt: info.expiresAt,
    daysLeft: info.daysLeft,
    reason: info.reason,
  });
}
