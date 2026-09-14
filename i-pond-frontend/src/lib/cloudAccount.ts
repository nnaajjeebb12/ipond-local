/**
 * Sign in to the MAIN SERVER as one of its registered accounts, using only
 * the routes it already has (NextAuth credentials flow + /api/ponds).
 *
 * This is how the appliance learns "who is the cloud owner" without anyone
 * remembering a UUID: the operator types the seeme-db.com email and password,
 * the main server answers with the account's id and name, and those become
 * SYNC_OWNER_ID / the display name. The same session lists the account's
 * ponds so they can be imported here.
 *
 * Nothing is stored: the password is used for one round trip and the session
 * cookie is discarded. Nothing on the main server changes — this is the same
 * exchange its own login page performs.
 *
 * Auth.js v5 credentials flow, done by hand:
 *   1. GET  /api/auth/csrf                 -> { csrfToken } + csrf cookie
 *   2. POST /api/auth/callback/credentials -> 302 + session cookie (or 302 to
 *                                             /login?error=… on failure)
 *   3. GET  /api/auth/session              -> { user: { id, name, email, role } }
 *   4. GET  /api/ponds                     -> the account's ponds
 */
import { syncTarget } from "./sync";

const TIMEOUT_MS = 15_000;

export type CloudUser = {
	id: string;
	name: string;
	email: string;
	role: "admin" | "owner" | "viewer" | string;
};

export type CloudPond = {
	id: string;
	pond_code: string | null;
	name: string;
	location: string;
	capacity: number;
	area: number;
	company_name: string | null;
};

export type CloudSignIn =
	| { ok: true; user: CloudUser; cookie: string }
	| { ok: false; reason: "invalid_credentials" | "subscription_expired" | "unreachable" | "unexpected"; detail: string };

/** Cookie jar: name -> value, updated from every Set-Cookie we see. */
class Jar {
	private map = new Map<string, string>();
	absorb(res: Response) {
		const list =
			typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
				? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
				: [res.headers.get("set-cookie") ?? ""].filter(Boolean);
		for (const raw of list) {
			const pair = raw.split(";")[0];
			const eq = pair.indexOf("=");
			if (eq <= 0) continue;
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			// Max-Age=0 / empty value = deletion
			if (/max-age=0/i.test(raw) || value === "") this.map.delete(name);
			else this.map.set(name, value);
		}
	}
	header(): string {
		return [...this.map].map(([k, v]) => `${k}=${v}`).join("; ");
	}
}

async function timed(url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
	} finally {
		clearTimeout(timer);
	}
}

export async function cloudSignIn(email: string, password: string): Promise<CloudSignIn> {
	const target = syncTarget();
	const jar = new Jar();

	let csrfToken: string;
	try {
		const res = await timed(`${target}/api/auth/csrf`, { method: "GET" });
		jar.absorb(res);
		const body = (await res.json()) as { csrfToken?: unknown };
		if (typeof body.csrfToken !== "string") {
			return { ok: false, reason: "unexpected", detail: "no csrf token from main server" };
		}
		csrfToken = body.csrfToken;
	} catch (err) {
		return { ok: false, reason: "unreachable", detail: String(err) };
	}

	let location = "";
	try {
		const form = new URLSearchParams({
			csrfToken,
			email,
			password,
			rememberMe: "false",
			callbackUrl: `${target}/dashboard`,
		});
		const res = await timed(`${target}/api/auth/callback/credentials`, {
			method: "POST",
			redirect: "manual",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Cookie: jar.header(),
			},
			body: form.toString(),
		});
		jar.absorb(res);
		location = res.headers.get("location") ?? "";
		if (res.status >= 500) {
			return { ok: false, reason: "unexpected", detail: `main server returned ${res.status} on login` };
		}
	} catch (err) {
		return { ok: false, reason: "unreachable", detail: String(err) };
	}

	// Success is "the session route now knows a user", not the redirect
	// target — that is the one signal that does not depend on Auth.js
	// version details.
	try {
		const res = await timed(`${target}/api/auth/session`, {
			method: "GET",
			headers: { Cookie: jar.header() },
		});
		jar.absorb(res);
		const body = (await res.json().catch(() => null)) as { user?: Partial<CloudUser> } | null;
		const u = body?.user;
		if (u && typeof u.id === "string" && u.id) {
			return {
				ok: true,
				user: {
					id: u.id.toLowerCase(),
					name: typeof u.name === "string" && u.name ? u.name : (u.email ?? u.id),
					email: typeof u.email === "string" ? u.email : email,
					role: typeof u.role === "string" ? u.role : "owner",
				},
				cookie: jar.header(),
			};
		}
	} catch (err) {
		return { ok: false, reason: "unreachable", detail: String(err) };
	}

	if (/SUBSCRIPTION_EXPIRED/i.test(location)) {
		return { ok: false, reason: "subscription_expired", detail: "the account's subscription has expired" };
	}
	return { ok: false, reason: "invalid_credentials", detail: "main server did not accept the email/password" };
}

/** The signed-in account's ponds, exactly as the main server lists them for that account. */
export async function cloudPonds(cookie: string): Promise<CloudPond[]> {
	const res = await timed(`${syncTarget()}/api/ponds`, {
		method: "GET",
		headers: { Cookie: cookie, Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`main server /api/ponds -> ${res.status}`);
	const body = (await res.json()) as unknown;
	if (!Array.isArray(body)) throw new Error("main server /api/ponds returned a non-list");
	return body as CloudPond[];
}
