/**
 * Runtime settings stored in `app_settings` (migration 019).
 *
 * Pool-agnostic like `@/lib/sync`: the sync worker runs under tsx with its own
 * pool, the app uses `@/lib/db`. One implementation, two callers.
 */
import type { Pool } from "pg";

export const SETTING_SYNC_OWNER_ID = "sync_owner_id";
export const SETTING_SYNC_OWNER_NAME = "sync_owner_name";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSetting(pool: Pool, key: string): Promise<string | null> {
	const { rows } = await pool.query<{ value: string }>(
		`SELECT value FROM app_settings WHERE key = $1`,
		[key]
	);
	return rows[0]?.value ?? null;
}

export async function setSetting(pool: Pool, key: string, value: string): Promise<void> {
	await pool.query(
		`INSERT INTO app_settings (key, value, updated_at)
		 VALUES ($1, $2, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[key, value]
	);
}

export type SyncOwner = {
	ownerId: string | null;
	/** Where the id came from: a UI change saved to the DB, or the .env seed. */
	source: "db" | "env" | "none";
	/** Last name the main server confirmed for this owner, if any. */
	name: string | null;
};

/**
 * The main-server owner this appliance's readings are attributed to.
 * DB wins over .env so a change made from the UI takes effect immediately for
 * the worker, the status endpoint and the page — no restart, no file writes.
 */
export async function getSyncOwner(pool: Pool): Promise<SyncOwner> {
	const [stored, name] = await Promise.all([
		getSetting(pool, SETTING_SYNC_OWNER_ID),
		getSetting(pool, SETTING_SYNC_OWNER_NAME),
	]);
	if (stored && UUID_RE.test(stored)) {
		return { ownerId: stored, source: "db", name };
	}
	const env = process.env.SYNC_OWNER_ID;
	if (env && UUID_RE.test(env)) {
		return { ownerId: env, source: "env", name };
	}
	return { ownerId: null, source: "none", name: null };
}
