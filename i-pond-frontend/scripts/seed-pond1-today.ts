// scripts/seed-pond1-today.ts
// Bulk insert 5000 sensor readings for PND-001 spread across today (app timezone).
// Run: npm run seed:pond1

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

function loadEnv(): Record<string, string> {
	const out: Record<string, string> = {};
	try {
		const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
		for (const line of raw.split(/\r?\n/)) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
			if (!m) continue;
			let v = m[2];
			if (
				(v.startsWith('"') && v.endsWith('"')) ||
				(v.startsWith("'") && v.endsWith("'"))
			) {
				v = v.slice(1, -1);
			}
			out[m[1]] = v;
		}
	} catch {
		/* optional */
	}
	return out;
}

const fileEnv = loadEnv();
const DATABASE_URL = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
const TZ =
	process.env.APP_TIMEZONE ??
	process.env.NEXT_PUBLIC_APP_TIMEZONE ??
	fileEnv.APP_TIMEZONE ??
	fileEnv.NEXT_PUBLIC_APP_TIMEZONE ??
	'Asia/Manila';

if (!DATABASE_URL) {
	console.error('DATABASE_URL missing.');
	process.exit(1);
}

const POND_CODE = 'PND-001';
const POND_NUM = 1;
const COUNT = 5000;

const BASELINE = { rtd: 24.0, ph: 7.0, sal: 18.0, dox: 6.5 };
const RANGES = {
	rtd: { min: 18, max: 32, optMin: 22, optMax: 27 },
	ph: { min: 5.5, max: 8.5, optMin: 6.5, optMax: 7.5 },
	sal: { min: 5, max: 40, optMin: 15, optMax: 30 },
	dox: { min: 3, max: 11, optMin: 5, optMax: 8 },
} as const;
const PERIODS_MS = {
	rtd: 6 * 60 * 60 * 1000,
	ph: 4 * 60 * 60 * 1000,
	sal: 8 * 60 * 60 * 1000,
	dox: 3 * 60 * 60 * 1000,
};
const ANOMALY_CHANCE = 0.15;

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v));
}
function noise(s: number) {
	return (Math.random() * 2 - 1) * s;
}
function drift(base: number, amp: number, periodMs: number, ts: number) {
	const phase = (POND_NUM / 10) * Math.PI * 2;
	const t = ts / periodMs;
	return base + Math.sin(t * Math.PI * 2 + phase) * amp;
}
function maybeAnomaly(
	v: number,
	r: { min: number; max: number; optMin: number; optMax: number },
) {
	if (Math.random() >= ANOMALY_CHANCE) return v;
	return Math.random() < 0.5
		? r.optMax + Math.random() * (r.max - r.optMax)
		: r.min + Math.random() * (r.optMin - r.min);
}
const round2 = (v: number) => Math.round(v * 100) / 100;

function startOfTodayInTZ(tz: string): Date {
	const now = new Date();
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});
	const parts = fmt.formatToParts(now);
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
	const y = get('year');
	const m = get('month');
	const d = get('day');
	const h = get('hour');
	const mi = get('minute');
	const s = get('second');
	const offsetMs =
		Date.UTC(y, m - 1, d, h, mi, s) - Math.floor(now.getTime() / 1000) * 1000;
	return new Date(Date.UTC(y, m - 1, d) - offsetMs);
}

async function main() {
	const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

	const pondRes = await pool.query<{ id: number }>(
		`SELECT id FROM ponds WHERE pond_code = $1`,
		[POND_CODE],
	);
	if (pondRes.rows.length === 0) {
		console.error(`Pond ${POND_CODE} not found.`);
		await pool.end();
		process.exit(1);
	}
	const pondId = pondRes.rows[0].id;

	const start = startOfTodayInTZ(TZ).getTime();
	const end = Date.now();
	const span = end - start;
	if (span <= 0) {
		console.error('Span is zero — clock issue.');
		await pool.end();
		process.exit(1);
	}
	const step = span / COUNT;

	console.log(
		`Seeding ${COUNT} rows into pond ${pondId} (${POND_CODE}) from ${new Date(start).toISOString()} → ${new Date(end).toISOString()} (TZ=${TZ}, step≈${(step / 1000).toFixed(2)}s)`,
	);

	const CHUNK = 500;
	let inserted = 0;
	for (let i = 0; i < COUNT; i += CHUNK) {
		const rows: unknown[] = [];
		const valuesSql: string[] = [];
		for (let j = 0; j < CHUNK && i + j < COUNT; j++) {
			const ts = new Date(start + (i + j) * step);
			const elapsed = ts.getTime() - start;
			let rtd = drift(BASELINE.rtd, 1.5, PERIODS_MS.rtd, elapsed) + noise(0.3);
			let ph = drift(BASELINE.ph, 0.3, PERIODS_MS.ph, elapsed) + noise(0.05);
			let sal = drift(BASELINE.sal, 2.5, PERIODS_MS.sal, elapsed) + noise(0.4);
			let dox = drift(BASELINE.dox, 0.8, PERIODS_MS.dox, elapsed) + noise(0.15);
			rtd = maybeAnomaly(rtd, RANGES.rtd);
			ph = maybeAnomaly(ph, RANGES.ph);
			sal = maybeAnomaly(sal, RANGES.sal);
			dox = maybeAnomaly(dox, RANGES.dox);
			const t = round2(clamp(rtd, RANGES.rtd.min, RANGES.rtd.max));
			const p = round2(clamp(ph, RANGES.ph.min, RANGES.ph.max));
			const s = round2(clamp(sal, RANGES.sal.min, RANGES.sal.max));
			const o = round2(clamp(dox, RANGES.dox.min, RANGES.dox.max));
			const base = rows.length;
			valuesSql.push(
				`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
			);
			rows.push(ts.toISOString(), pondId, t, p, s, o);
		}
		await pool.query(
			`INSERT INTO sensor_readings (time, pond_id, temperature, ph, salinity, dissolved_oxygen)
			 VALUES ${valuesSql.join(', ')}`,
			rows,
		);
		inserted += valuesSql.length;
		process.stdout.write(`  inserted ${inserted}/${COUNT}\r`);
	}

	console.log(`\nDONE. Inserted ${inserted} rows for ${POND_CODE}.`);
	await pool.end();
}

main().catch(async (err) => {
	console.error(err);
	process.exit(1);
});
