/**
 * Cloud sync core — ships local readings to the main server.
 *
 * Deliberately free of Next.js and `@/lib/db` imports: `scripts/sync-worker.ts`
 * runs this under tsx with its own pool, and `POST /api/sync/trigger` runs the
 * same code inline with the app pool. One implementation, two callers.
 *
 * `sensor_readings` has no surrogate key, so a row is identified by
 * (pond_id, time) locally — see db/migrations/016_sync.sql. On the wire a pond
 * is identified by (owner_id, pond_code) instead: every appliance numbers its
 * ponds 1..10, so the multi-tenant cloud needs the owner to tell them apart.
 * SYNC_OWNER_ID is that owner's UUID on the main server.
 *
 * Timestamps are carried as full-precision ISO strings and never pass through a
 * JS Date: Postgres stores microseconds, Date only holds milliseconds, and
 * round-tripping silently truncates so that no row ever matches again.
 */
import type { Pool } from "pg";

export const DEFAULT_TARGET = "https://seeme-db.com";
export const BATCH_SIZE = 500;

/** Ceiling per run, so a large backlog cannot overrun the 5-minute cron slot. */
export const MAX_BATCHES = 20;

const PROBE_TIMEOUT_MS = 8000;
const POST_TIMEOUT_MS = 30_000;

export type SyncReason =
	| "ok"
	| "nothing_to_sync"
	| "offline"
	| "server_unreachable"
	| "pond_mismatch"
	| "not_configured"
	| "server_error"
	| "db_error";

export type SyncResult = {
	ok: boolean;
	reason: SyncReason;
	synced: number;
	pending: number;
	batches: number;
	/** Rows the server accepted but did not insert: duplicates, or unknown (owner, pond_code). */
	skipped: number;
	message: string;
};

export type OnlineCheck = {
	/** The internet is reachable. */
	online: boolean;
	/** The main server answered its health check. */
	serverReachable: boolean;
	detail: string;
};

type ReadingRow = {
	/** ISO-8601 UTC with 6 fractional digits, straight from Postgres. */
	time_iso: string;
	pond_id: number;
	pond_code: string | null;
	temperature: number | null;
	ph: number | null;
	salinity: number | null;
	dissolved_oxygen: number | null;
};

export function syncTarget(): string {
	return (process.env.MAIN_SERVER_URL || DEFAULT_TARGET).replace(/\/+$/, "");
}

/**
 * fetch with a timeout that is actually cancelled on completion.
 *
 * Deliberately not AbortSignal.timeout(): that timer cannot be cleared, so a
 * request failing in milliseconds still leaves a multi-second handle armed.
 * The worker then trips a libuv assertion on process.exit() and dies with a
 * non-zero code even though the sync itself succeeded.
 */
async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function probe(url: string, timeoutMs: number): Promise<boolean> {
	try {
		const res = await fetchWithTimeout(
			url,
			{ method: "GET", cache: "no-store" },
			timeoutMs
		);
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Distinguishes "no internet" from "internet up, main server down" — the two
 * cases need different action from whoever reads the dashboard.
 */
export async function checkOnline(): Promise<OnlineCheck> {
	const target = syncTarget();

	if (await probe(`${target}/api/health`, PROBE_TIMEOUT_MS)) {
		return { online: true, serverReachable: true, detail: `${target} reachable` };
	}

	// Cloudflare's certificate covers the 1.1.1.1 literal, so this is a plain
	// HTTPS reachability check with no DNS dependency.
	if (await probe("https://1.1.1.1", PROBE_TIMEOUT_MS)) {
		return {
			online: true,
			serverReachable: false,
			detail: "internet up, main server unreachable",
		};
	}

	return { online: false, serverReachable: false, detail: "no internet connection" };
}

export async function countPending(pool: Pool): Promise<number> {
	const { rows } = await pool.query<{ n: string }>(
		`SELECT COUNT(*)::text AS n FROM sensor_readings WHERE synced_at IS NULL`
	);
	return Number(rows[0]?.n ?? 0);
}

export async function lastSyncAt(pool: Pool): Promise<string | null> {
	const { rows } = await pool.query<{ t: Date | null }>(
		`SELECT MAX(synced_at) AS t FROM sensor_readings`
	);
	const t = rows[0]?.t ?? null;
	return t ? new Date(t).toISOString() : null;
}

async function fetchBatch(pool: Pool): Promise<ReadingRow[]> {
	const { rows } = await pool.query<ReadingRow>(
		`SELECT to_char(sr.time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time_iso,
            sr.pond_id, p.pond_code, temperature, ph, salinity, dissolved_oxygen
       FROM sensor_readings sr
       LEFT JOIN ponds p ON p.id = sr.pond_id
      WHERE synced_at IS NULL
      ORDER BY sr.time ASC
      LIMIT ${BATCH_SIZE}`
	);
	return rows;
}

async function markSynced(pool: Pool, batch: ReadingRow[]): Promise<number> {
	const pondIds = batch.map((r) => r.pond_id);
	const times = batch.map((r) => r.time_iso);
	const { rowCount } = await pool.query(
		`UPDATE sensor_readings sr
        SET synced_at = NOW()
       FROM unnest($1::int[], $2::timestamptz[]) AS b(pond_id, time)
      WHERE sr.pond_id = b.pond_id
        AND sr.time = b.time`,
		[pondIds, times]
	);
	return rowCount ?? 0;
}

function result(
	reason: SyncReason,
	message: string,
	extra: Partial<SyncResult> = {}
): SyncResult {
	return {
		ok: reason === "ok" || reason === "nothing_to_sync",
		reason,
		synced: 0,
		pending: 0,
		batches: 0,
		skipped: 0,
		message,
		...extra,
	};
}

/**
 * Ships pending readings in batches until the backlog is clear, a batch fails,
 * or MAX_BATCHES is hit. Rows are marked only after the server confirms them,
 * so a crash mid-run re-sends rather than silently dropping data — the unique
 * index on the receiving side makes the re-send a no-op.
 */
export async function runSync(
	pool: Pool,
	log: (line: string) => void = () => {}
): Promise<SyncResult> {
	const token = process.env.SYNC_TOKEN;
	if (!token) {
		log("SYNC_TOKEN is not set — nothing to do");
		return result("not_configured", "SYNC_TOKEN is not set");
	}

	// Without the owner the cloud cannot resolve a single pond. It would still
	// answer 200 with everything skipped, and we would then mark every row as
	// synced — silent data loss. Refuse to run instead.
	const ownerId = process.env.SYNC_OWNER_ID;
	if (!ownerId || !/^[0-9a-f-]{36}$/i.test(ownerId)) {
		log("SYNC_OWNER_ID is not set or not a UUID — nothing to do");
		return result("not_configured", "SYNC_OWNER_ID is not set");
	}

	const target = syncTarget();

	let pending: number;
	try {
		pending = await countPending(pool);
	} catch (err) {
		log(`local db error: ${String(err)}`);
		return result("db_error", "Could not read the local database");
	}

	if (pending === 0) {
		log("nothing pending");
		return result("nothing_to_sync", "Everything is already synced");
	}

	const net = await checkOnline();
	if (!net.online) {
		log(`offline — ${pending} readings pending`);
		return result("offline", "No internet connection", { pending });
	}
	if (!net.serverReachable) {
		log(`main server unreachable — ${pending} readings pending`);
		return result("server_unreachable", "Main server unreachable", { pending });
	}

	log(`online — ${pending} readings pending, target ${target}`);

	let synced = 0;
	let batches = 0;
	let skipped = 0;

	while (batches < MAX_BATCHES) {
		let batch: ReadingRow[];
		try {
			batch = await fetchBatch(pool);
		} catch (err) {
			log(`local db error while reading batch: ${String(err)}`);
			return result("db_error", "Could not read the local database", {
				synced,
				batches,
				pending: pending - synced,
			});
		}

		if (batch.length === 0) break;
		batches += 1;

		const readings = batch.map((r) => ({
			time: r.time_iso,
			owner_id: ownerId,
			pond_code: r.pond_code,
			temperature: r.temperature,
			ph: r.ph,
			salinity: r.salinity,
			dissolved_oxygen: r.dissolved_oxygen,
			source: "local-pi" as const,
		}));

		let res: Response;
		try {
			res = await fetchWithTimeout(
				`${target}/api/sync`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ readings }),
				},
				POST_TIMEOUT_MS
			);
		} catch (err) {
			log(`batch ${batches} failed to send: ${String(err)}`);
			return result("server_unreachable", "Lost connection mid-sync", {
				synced,
				batches: batches - 1,
				pending: pending - synced,
			});
		}

		if (!res.ok) {
			const body = await res.text().catch(() => "");
			log(`batch ${batches} rejected: ${res.status} ${body.slice(0, 200)}`);
			return result("server_error", `Main server returned ${res.status}`, {
				synced,
				batches: batches - 1,
				pending: pending - synced,
			});
		}

		// The server reports how many it actually inserted. A skip is either a
		// duplicate (harmless) or an unknown (owner, pond_code) pair — the server
		// does not say which per row, so surface the count loudly in the log.
		let serverInserted: number | null = null;
		let serverSkipped: number | null = null;
		let serverUnknown: number | null = null;
		try {
			const ack = (await res.json()) as { inserted?: unknown; skipped?: unknown; unknown?: unknown };
			if (typeof ack.inserted === "number") serverInserted = ack.inserted;
			if (typeof ack.skipped === "number") serverSkipped = ack.skipped;
			if (typeof ack.unknown === "number") serverUnknown = ack.unknown;
		} catch {
			// older receiver without counts — fall through
		}
		if (serverSkipped !== null) skipped += serverSkipped;

		// The server could not resolve (owner_id, pond_code) for some rows. They
		// are NOT on the far side, so marking them synced here would lose them
		// for good. Stop, mark nothing from this batch, and say why. Almost
		// always a wrong SYNC_OWNER_ID or ponds not yet created on the server.
		if (serverUnknown !== null && serverUnknown > 0) {
			log(
				`batch ${batches}: server did not recognise ${serverUnknown}/${batch.length} rows — ` +
					`check SYNC_OWNER_ID and that ponds PND-001.. exist under that owner on the main server. Nothing marked.`
			);
			return result("pond_mismatch", `Main server rejected ${serverUnknown} readings: unknown pond for this owner`, {
				synced,
				batches: batches - 1,
				skipped,
				pending: pending - synced,
			});
		}
		// Older receiver that cannot distinguish: warn, but proceed as before.
		if (serverUnknown === null && serverSkipped !== null && serverInserted === 0 && serverSkipped === batch.length) {
			log(
				`batch ${batches}: server skipped ALL ${batch.length} rows and does not report why — ` +
					`if this is not a re-send, check SYNC_OWNER_ID`
			);
		}

		// Accepted. Mark locally even when the server skipped duplicates — the
		// rows are on the far side either way, which is what synced_at means.
		let marked: number;
		try {
			marked = await markSynced(pool, batch);
		} catch (err) {
			log(`batch ${batches} sent but could not be marked: ${String(err)}`);
			return result("db_error", "Sent, but could not update the local database", {
				synced,
				batches: batches - 1,
				pending: pending - synced,
			});
		}

		synced += marked;
		log(
			`batch ${batches}: sent ${batch.length}, marked ${marked}` +
				(serverInserted !== null ? `, server inserted ${serverInserted}, skipped ${serverSkipped}` : "")
		);

		if (batch.length < BATCH_SIZE) break;
	}

	const remaining = Math.max(pending - synced, 0);
	if (batches >= MAX_BATCHES && remaining > 0) {
		log(`batch ceiling reached — ${remaining} still pending, will resume next run`);
	}

	const msg =
		`Synced ${synced} reading${synced === 1 ? "" : "s"}` +
		(skipped > 0 ? ` (${skipped} skipped by server)` : "");
	return result("ok", msg, { synced, batches, skipped, pending: remaining });
}
