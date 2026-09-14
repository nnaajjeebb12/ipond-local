import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, ADMIN_COOKIE, cookieOptions, issueSession } from "@/lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local appliance admin login — see @/lib/adminSession. Not main-server auth. */
export async function POST(req: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!checkCredentials(username, password)) {
    console.warn("admin_login_failed", { username });
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const session = issueSession();
  const res = NextResponse.json({ ok: true, expiresAt: session.expires.toISOString() });
  res.cookies.set(ADMIN_COOKIE, session.value, cookieOptions(session.expires));
  console.log("admin_login_ok");
  return res;
}
