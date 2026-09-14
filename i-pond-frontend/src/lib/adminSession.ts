/**
 * Local appliance admin gate.
 *
 * This is NOT user auth and has nothing to do with the main server's accounts.
 * It protects exactly one thing: changing which cloud owner this Pi's data is
 * attributed to. One fixed credential, an HMAC-signed expiry cookie, no
 * session table.
 *
 * The secret is derived from API_TOKEN so sessions survive a restart without
 * another env var; set ADMIN_SESSION_SECRET to override.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "ipond_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// Fixed local credential, as specified for this single-admin appliance.
const ADMIN_USERNAME = "soletronix";
const ADMIN_PASSWORD = "Soletronix@pi2026";

function secret(): string {
	return process.env.ADMIN_SESSION_SECRET || `${process.env.API_TOKEN ?? ""}:ipond-admin-session`;
}

function sign(exp: number): string {
	return createHmac("sha256", secret()).update(String(exp)).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

export function checkCredentials(username: string, password: string): boolean {
	// Both compared every time so a wrong username costs the same as a wrong password.
	const u = safeEqual(username, ADMIN_USERNAME);
	const p = safeEqual(password, ADMIN_PASSWORD);
	return u && p;
}

/** Cookie value for a fresh session, and when it expires. */
export function issueSession(): { value: string; expires: Date } {
	const exp = Date.now() + SESSION_TTL_MS;
	return { value: `${exp}.${sign(exp)}`, expires: new Date(exp) };
}

/** Milliseconds until this session expires, or null if absent/invalid/expired. */
export function sessionRemainingMs(req: NextRequest): number | null {
	const raw = req.cookies.get(ADMIN_COOKIE)?.value;
	if (!raw) return null;
	const dot = raw.indexOf(".");
	if (dot <= 0) return null;
	const exp = Number(raw.slice(0, dot));
	const sig = raw.slice(dot + 1);
	if (!Number.isFinite(exp) || !sig) return null;
	if (!safeEqual(sig, sign(exp))) return null;
	const remaining = exp - Date.now();
	return remaining > 0 ? remaining : null;
}

export function isAdmin(req: NextRequest): boolean {
	return sessionRemainingMs(req) !== null;
}

/** Cookie attributes. No Secure flag: the appliance serves plain HTTP on the LAN. */
export function cookieOptions(expires: Date) {
	return {
		httpOnly: true,
		sameSite: "lax" as const,
		path: "/",
		expires,
	};
}
