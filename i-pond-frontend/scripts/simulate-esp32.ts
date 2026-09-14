// scripts/simulate-esp32.ts
// 10 independent fake ESP32 devices. Each pond runs its own loop.
// Run: npm run simulate   (tsx; works on the Pi's Node 20)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- env ----------

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
		// .env optional
	}
	return out;
}

const fileEnv = loadEnv();
const API_TOKEN = process.env.API_TOKEN ?? fileEnv.API_TOKEN;
const BASE_URL =
	process.env.BASE_URL ?? fileEnv.BASE_URL ?? 'http://localhost:3000';

if (!API_TOKEN) {
	console.error('API_TOKEN missing. Set it in .env');
	process.exit(1);
}

const ENDPOINT = `${BASE_URL.replace(/\/$/, '')}/api/send-sensor-data`;
const POND_COUNT = 10;
const SIM_PONDS = (process.env.SIM_PONDS ?? fileEnv.SIM_PONDS ?? '')
	.split(',')
	.map((x) => Number(x.trim()))
	.filter((n) => Number.isInteger(n) && n >= 1);
const ANOMALY_CHANCE = 0.15;

// ---------- per-pond baselines ----------

type Baseline = { rtd: number; ph: number; sal: number; dox: number };

const BASELINES: Record<number, Baseline> = {
	1: { rtd: 24.0, ph: 7.0, sal: 18.0, dox: 6.5 },
	2: { rtd: 25.5, ph: 7.2, sal: 20.0, dox: 6.0 },
	3: { rtd: 23.0, ph: 6.8, sal: 22.0, dox: 7.0 },
	4: { rtd: 26.0, ph: 7.3, sal: 25.0, dox: 5.8 },
	5: { rtd: 24.5, ph: 7.1, sal: 17.0, dox: 6.8 },
	6: { rtd: 27.0, ph: 6.9, sal: 28.0, dox: 5.5 },
	7: { rtd: 23.5, ph: 7.4, sal: 19.0, dox: 7.2 },
	8: { rtd: 25.0, ph: 7.0, sal: 21.0, dox: 6.3 },
	9: { rtd: 24.0, ph: 6.7, sal: 24.0, dox: 6.9 },
	10: { rtd: 26.5, ph: 7.2, sal: 26.0, dox: 5.9 },
};

// ---------- ranges ----------

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

// ---------- helpers ----------

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v));
}

function noise(scale: number) {
	return (Math.random() * 2 - 1) * scale;
}

function drift(
	baseline: number,
	amplitude: number,
	periodMs: number,
	pondId: number,
	startedAt: number,
) {
	const phase = (pondId / POND_COUNT) * Math.PI * 2;
	const t = (Date.now() - startedAt) / periodMs;
	return baseline + Math.sin(t * Math.PI * 2 + phase) * amplitude;
}

function maybeAnomaly(
	v: number,
	range: { min: number; max: number; optMin: number; optMax: number },
) {
	if (Math.random() >= ANOMALY_CHANCE) return v;
	const high = Math.random() < 0.5;
	return high
		? range.optMax + Math.random() * (range.max - range.optMax)
		: range.min + Math.random() * (range.optMin - range.min);
}

function round2(v: number) {
	return Math.round(v * 100) / 100;
}

function readingFor(pondId: number, startedAt: number) {
	const b = BASELINES[pondId];

	let rtd = drift(b.rtd, 1.5, PERIODS_MS.rtd, pondId, startedAt) + noise(0.3);
	let ph = drift(b.ph, 0.3, PERIODS_MS.ph, pondId, startedAt) + noise(0.05);
	let sal = drift(b.sal, 2.5, PERIODS_MS.sal, pondId, startedAt) + noise(0.4);
	let dox = drift(b.dox, 0.8, PERIODS_MS.dox, pondId, startedAt) + noise(0.15);

	rtd = maybeAnomaly(rtd, RANGES.rtd);
	ph = maybeAnomaly(ph, RANGES.ph);
	sal = maybeAnomaly(sal, RANGES.sal);
	dox = maybeAnomaly(dox, RANGES.dox);

	return {
		pnd: pondId,
		rtd: round2(clamp(rtd, RANGES.rtd.min, RANGES.rtd.max)),
		ph: round2(clamp(ph, RANGES.ph.min, RANGES.ph.max)),
		sal: round2(clamp(sal, RANGES.sal.min, RANGES.sal.max)),
		dox: round2(clamp(dox, RANGES.dox.min, RANGES.dox.max)),
	};
}

function timeStamp() {
	const d = new Date();
	return d.toTimeString().slice(0, 8);
}

function sleep(ms: number) {
	return new Promise<void>((res) => setTimeout(res, ms));
}

// ---------- per-pond loop ----------

let stopping = false;

async function sendOnce(pondId: number, startedAt: number) {
	const data = readingFor(pondId, startedAt);
	const tag = `pond-${pondId}`;

	try {
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${API_TOKEN}`,
			},
			body: JSON.stringify({ data }),
		});

		const ok = res.status === 200 || res.status === 201 || res.status === 202;
		console.log(
			`[${timeStamp()}] ${tag} | rtd=${data.rtd} ph=${data.ph} sal=${data.sal} dox=${data.dox} -> ${ok ? '' : 'ERR '}${res.status}  (next in ${SEND_INTERVAL_MS / 1000}s)`,
		);
		if (!ok) {
			const body = await res.text().catch(() => '');
			if (body) console.log(`           ${tag} body: ${body.slice(0, 200)}`);
		}
	} catch (err) {
		console.log(
			`[${timeStamp()}] ${tag} | NET FAIL -> ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

// One reading per pond per SEND_INTERVAL_MS. The real gateway posts every few
// seconds; 5 s is a realistic default. SIM_INTERVAL_MS overrides, SIM_PONDS
// limits which ponds send (e.g. SIM_PONDS=1,2 for a two-gateway site).
const SEND_INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? fileEnv.SIM_INTERVAL_MS ?? 5000);

async function pondLoop(pondId: number) {
	const bootDelayMs = Math.floor(Math.random() * 2000);
	const startedAt = Date.now();

	console.log(
		`[pond-${pondId}] BOOTED. Interval: ${SEND_INTERVAL_MS / 1000}s. First send in ${(bootDelayMs / 1000).toFixed(1)}s.`,
	);

	await sleep(bootDelayMs);
	if (stopping) return;

	while (!stopping) {
		await sendOnce(pondId, startedAt);
		if (stopping) break;
		await sleep(SEND_INTERVAL_MS);
	}
}

// ---------- main ----------

console.log(`Simulator -> ${ENDPOINT}`);
const PONDS = SIM_PONDS.length > 0 ? SIM_PONDS : Array.from({ length: POND_COUNT }, (_, i) => i + 1);
console.log(`Ponds ${PONDS.join(', ')} every ${SEND_INTERVAL_MS} ms. Ctrl+C to stop.
`);

function shutdown() {
	if (stopping) return;
	stopping = true;
	console.log('\nstopping all ponds...');
	setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
	const loops: Promise<void>[] = [];
	for (const i of PONDS) {
		loops.push(pondLoop(i));
	}
	await Promise.all(loops);
})();
