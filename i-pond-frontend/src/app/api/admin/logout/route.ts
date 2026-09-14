import { NextResponse } from "next/server";
import { ADMIN_COOKIE, cookieOptions } from "@/lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", cookieOptions(new Date(0)));
  return res;
}
