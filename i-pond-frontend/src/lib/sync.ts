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
import { getSyncOwner } from "./settings";

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
	/** Rows the server would not take: no pond for (owner, pond_code) there. Left pending here. */
	skipped: number;
	/** Pond codes the main server does not have under this owner. Their readings stay pending. */
	unknownPonds: string[];
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

export type SyncConfig = {
	configured: boolean;
	missing: string | null;
	ownerId: string | null;
};

/**
 * Everything the worker needs to run, or the first thing that is missing.
 * The owner comes from app_settings first and SYNC_OWNER_ID second — see
 * getSyncOwner — so a change made on the appliance page applies at once.
 */
export async function syncConfig(pool: Pool): Promise<SyncConfig> {
	if (!process.env.SYNC_TOKEN) {
		return { configured: false, missing: "SYNC_TOKEN", ownerId: null };
	}
	const owner = await getSyncOwner(pool);
	if (!owner.ownerId) {
		return { configured: false, missing: "SYNC_OWNER_ID", ownerId: null };
	}
	return { configured: true, missing: null, ownerId: owner.ownerId };
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
export async function checkOnline(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<OnlineCheck> {
	const target = syncTarget();

	if (await probe(`${target}/api/health`, timeoutMs)) {
		return { online: true, serverReachable: true, detail: `${target} reachable` };
	}

	// Cloudflare's certificate covers the 1.1.1.1 literal, so this is a plain
	// HTTPS reachability check with no DNS dependency.
	if (await probe("https://1.1.1.1", timeoutMs)) {
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

/**
 * Only rows that CAN be sent: the pond must exist and carry a pond_code. A
 * single row without one would be rejected by the receiver as a 400 for the
 * whole batch, and because batches are taken in time order that same batch
 * would be retried every run — one bad row would wedge sync forever.
 */
async function fetchBatch(pool: Pool, excludeCodes: string[] = []): Promise<ReadingRow[]> {
	const { rows } = await pool.query<ReadingRow>(
		`SELECT to_char(sr.time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time_iso,
            sr.pond_id, p.pond_code, temperature, ph, salinity, dissolved_oxygen
       FROM sensor_readings sr
       JOIN ponds p ON p.id = sr.pond_id
      WHERE sr.synced_at IS NULL
        AND p.pond_code IS NOT NULL
        AND NOT (p.pond_code = ANY($1::text[]))
      ORDER BY sr.time ASC
      LIMIT ${BATCH_SIZE}`,
		[excludeCodes]
	);
	return rows;
}

type WireReading = {
	time: string;
	owner_id: string;
	pond_code: string | null;
	temperature: number | null;
	ph: number | null;
	salinity: number | null;
	dissolved_oxygen: number | null;
	source: "local-pi";
};

/**
 * What the receiver said about a batch.
 *
 * The production receiver (cloned main/…/src/app/api/sync/route.ts, mirrored
 * in src/app/api/sync/route.ts here) answers `{ ok, inserted, skipped }`:
 *   inserted — rows whose (owner_id, pond_code) resolved to a pond. Counted
 *              even when ON CONFLICT dropped them as duplicates, so this is
 *              "on the server now", which is exactly what synced_at means.
 *   skipped  — rows it could NOT place: no pond for that owner + code. NOT
 *              on the server. Marking them here would lose them for good.
 * An `unknown` field, if a receiver ever sends one, is preferred over skipped.
 */
type Ack = { inserted: number | null; notOnServer: number | null };

async function postBatch(target: string, token: string, readings: WireReading[]): Promise<
	{ ok: true; ack: Ack } | { ok: false; kind: "network" | "http"; detail: string; status?: number }
> {
	let res: Response;
	try {
		res = await fetchWithTimeout(
			`${target}/api/sync`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({ readings }),
			},
			POST_TIMEOUT_MS
		);
	} catch (err) {
		return { ok: false, kind: "network", detail: String(err) };
	}
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		return { ok: false, kind: "http", status: res.status, detail: body.slice(0, 200) };
	}
	const ack: Ack = { inserted: null, notOnServer: null };
	try {
		const j = (await res.json()) as { inserted?: unknown; skipped?: unknown; unknown?: unknown };
		if (typeof j.inserted === "number") ack.inserted = j.inserted;
		if (typeof j.unknown === "number") ack.notOnServer = j.unknown;
		else if (typeof j.skipped === "number") ack.notOnServer = j.skipped;
	} catch {
		// receiver without counts — fall through with nulls
	}
	return { ok: true, ack };
}

/** Pending rows that fetchBatch will never pick up. Surfaced, never silently dropped. */
export async function countUnsyncable(pool: Pool): Promise<number> {
	const { rows } = await pool.query<{ n: string }>(
		`SELECT COUNT(*)::text AS n
       FROM sensor_readings sr
       LEFT JOIN ponds p ON p.id = sr.pond_id
      WHERE sr.synced_at IS NULL
        AND (p.id IS NULL OR p.pond_code IS NULL)`
	);
	return Number(rows[0]?.n ?? 0);
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
		unknownPonds: [],
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
	let cfg: SyncConfig;
	try {
		cfg = await syncConfig(pool);
	} catch (err) {
		log(`local db error: ${String(err)}`);
		return result("db_error", "Could not read the local database");
	}
	if (!cfg.configured || !cfg.ownerId) {
		log(`${cfg.missing} is not set — nothing to do`);
		return result("not_configured", `${cfg.missing} is not set`);
	}
	const ownerId = cfg.ownerId;

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

	try {
		const unsyncable = await countUnsyncable(pool);
		if (unsyncable > 0) {
			log(
				`${unsyncable} pending reading(s) belong to a pond with no pond_code and will be left behind — ` +
					`fix the pond row (every pond needs a PND-### code) and they will ship on the next run`
			);
		}
	} catch {
		// diagnostic only
	}


	let synced = 0;
	let batches = 0;
	let skipped = 0;
	// Pond codes the server has already told us it does not have under this
	// owner. Their rows are left out of later batches this run so one pond
	// that is missing on the main server cannot wedge sync for all the others
	// — batches are time-ordered, so without this the same batch would come
	// back every run until someone created that pond on the server.
	const unknownPonds = new Set<string>();

	const toWire = (r: ReadingRow): WireReading => ({
		time: r.time_iso,
		owner_id: ownerId,
		pond_code: r.pond_code,
		temperature: r.temperature,
		ph: r.ph,
		salinity: r.salinity,
		dissolved_oxygen: r.dissolved_oxygen,
		source: "local-pi",
	});

	const partial = (): Partial<SyncResult> => ({
		synced,
		batches,
		skipped,
		unknownPonds: [...unknownPonds],
		pending: Math.max(pending - synced, 0),
	});

	while (batches < MAX_BATCHES) {
		let batch: ReadingRow[];
		try {
			batch = await fetchBatch(pool, [...unknownPonds]);
		} catch (err) {
			log(`local db error while reading batch: ${String(err)}`);
			return result("db_error", "Could not read the local database", partial());
		}

		if (batch.length === 0) break;
		batches += 1;

		const sent = await postBatch(target, token, batch.map(toWire));
		if (!sent.ok) {
			batches -= 1;
			if (sent.kind === "network") {
				log(`batch ${batches + 1} failed to send: ${sent.detail}`);
				return result("server_unreachable", "Lost connection mid-sync", partial());
			}
			log(`batch ${batches + 1} rejected: ${sent.status} ${sent.detail}`);
			return result("server_error", `Main server returned ${sent.status}`, partial());
		}

		let toMark = batch;
		if (sent.ack.notOnServer !== null && sent.ack.notOnServer > 0) {
			// The receiver does not say WHICH rows it could not place, so ask it
			// one pond at a time with a single reading each. Re-sending a row it
			// already has is a no-op (ON CONFLICT), so the probe is free.
			const codes = [...new Set(batch.map((r) => r.pond_code ?? ""))];
			for (const code of codes) {
				const sample = batch.find((r) => r.pond_code === code);
				if (!sample) continue;
				const probe = await postBatch(target, token, [toWire(sample)]);
				if (!probe.ok) {
					log(`probe for ${code} failed: ${probe.detail} — marking nothing from this batch`);
					return result(
						probe.kind === "network" ? "server_unreachable" : "server_error",
						"Lost connection mid-sync",
						partial()
					);
				}
				if (probe.ack.notOnServer !== null && probe.ack.notOnServer > 0) unknownPonds.add(code);
			}
			toMark = batch.filter((r) => !unknownPonds.has(r.pond_code ?? ""));
			skipped += batch.length - toMark.length;
			log(
				`batch ${batches}: server has no pond for ${[...unknownPonds].join(", ")} under owner ${ownerId} — ` +
					`${batch.length - toMark.length} reading(s) left pending. Create the pond(s) under that owner on the main server ` +
					`(and set ponds.owner_id there), or fix the owner on Settings > Appliance.`
			);
		}

		let marked = 0;
		if (toMark.length > 0) {
			try {
				marked = await markSynced(pool, toMark);
			} catch (err) {
				log(`batch ${batches} sent but could not be marked: ${String(err)}`);
				return result("db_error", "Sent, but could not update the local database", partial());
			}
		}

		synced += marked;
		log(
			`batch ${batches}: sent ${batch.length}, marked ${marked}` +
				(sent.ack.inserted !== null ? `, server accepted ${sent.ack.inserted}, could not place ${sent.ack.notOnServer ?? 0}` : "")
		);

		if (batch.length < BATCH_SIZE) break;
	}

	const remaining = Math.max(pending - synced, 0);
	if (batches >= MAX_BATCHES && remaining > 0) {
		log(`batch ceiling reached — ${remaining} still pending, will resume next run`);
	}

	const unknownList = [...unknownPonds];
	// Every pond we tried is missing on the server and nothing shipped: that
	// is almost always a wrong owner, not ten missing ponds. Say so.
	if (unknownList.length > 0 && synced === 0) {
		return result(
			"pond_mismatch",
			`Main server has no pond for ${unknownList.join(", ")} under this owner — check the owner on Settings > Appliance, or create the ponds there`,
			{ synced, batches, skipped, unknownPonds: unknownList, pending: remaining }
		);
	}

	const msg =
		`Synced ${synced} reading${synced === 1 ? "" : "s"}` +
		(unknownList.length > 0
			? `; ${skipped} waiting — ${unknownList.join(", ")} not found under this owner on the main server`
			: "");
	return result("ok", msg, { synced, batches, skipped, unknownPonds: unknownList, pending: remaining });
}
