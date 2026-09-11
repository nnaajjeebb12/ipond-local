'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

type Sensor = 'temperature' | 'ph' | 'salinity' | 'dissolved_oxygen';
type Health = 'normal' | 'warning' | 'critical';
type RangeKey = 'today' | '7d' | '14d' | '30d';

type RawPoint = { time: number; value: number };

type AggregatedBucket = {
	time: number;
	avg: number;
	min: number;
	max: number;
	anomalyCount: number;
	health: Health;
};

export type CompareSeries = {
	pondId: number;
	pondName: string;
	color: string;
	data: AggregatedBucket[];
};

interface Props {
	mode: 'raw' | 'aggregated' | 'compare';
	sensor: Sensor;
	unit: string;
	label: string;
	data?: RawPoint[];
	aggregated?: AggregatedBucket[];
	compareSeries?: CompareSeries[];
	optimalMin?: number;
	optimalMax?: number;
	optimalValue?: number | null;
	range?: RangeKey;
	bucketSize?: string;
	isLoading?: boolean;
}

const SENSOR_COLOR: Record<Sensor, string> = {
	temperature: '#f97316',
	ph: '#3b82f6',
	salinity: '#8b5cf6',
	dissolved_oxygen: '#10b981',
};

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || 'UTC';

const fmtHM = new Intl.DateTimeFormat('en-PH', {
	hour: '2-digit',
	minute: '2-digit',
	hour12: false,
	timeZone: TZ,
});
const fmtHMS = new Intl.DateTimeFormat('en-PH', {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false,
	timeZone: TZ,
});
const fmtMD = new Intl.DateTimeFormat('en-PH', {
	month: 'short',
	day: '2-digit',
	timeZone: TZ,
});
const fmtMDHM = new Intl.DateTimeFormat('en-PH', {
	month: 'short',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false,
	timeZone: TZ,
});

function formatTick(ts: number, range: RangeKey) {
	const d = new Date(ts);
	if (range === 'today') return fmtHM.format(d);
	if (range === '14d' || range === '30d') return fmtMD.format(d);
	return fmtMDHM.format(d).replace(',', '');
}

function xAxisIncrs(range: RangeKey): uPlot.Axis.Incrs {
	if (range === 'today') return [1800, 3600, 7200, 10800, 21600];
	if (range === '7d') return [21600, 43200, 86400];
	if (range === '14d') return [86400, 172800, 259200];
	return [86400, 259200, 604800];
}

function xAxisSpace(range: RangeKey): number {
	if (range === 'today') return 70;
	if (range === '7d') return 90;
	return 80;
}

function formatTooltipTime(ts: number, mode: 'raw' | 'aggregated' | 'compare') {
	const d = new Date(ts);
	if (mode === 'raw') return `${fmtHMS.format(d)} (PHT)`;
	return `${fmtMDHM.format(d).replace(',', '')} (PHT)`;
}

const HEALTH_CONFIG: Record<
	Health,
	{ icon: string; label: string; className: string }
> = {
	normal: {
		icon: '✓',
		label: 'Normal',
		className: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300',
	},
	warning: {
		icon: '⚠',
		label: 'Warning',
		className: 'bg-amber-500/10 border-amber-400/30 text-amber-300',
	},
	critical: {
		icon: '✕',
		label: 'Critical',
		className: 'bg-rose-500/10 border-rose-400/30 text-rose-300',
	},
};

function HealthBadge({ health }: { health: Health }) {
	const config = HEALTH_CONFIG[health];
	return (
		<span
			className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap ${config.className}`}>
			<span aria-hidden>{config.icon}</span>
			<span>{config.label}</span>
		</span>
	);
}

function bucketsHealth(buckets: AggregatedBucket[]): Health {
	if (buckets.length === 0) return 'normal';
	return buckets[buckets.length - 1].health;
}

function isDarkTheme(): boolean {
	if (typeof document === 'undefined') return true;
	const theme = document.documentElement.getAttribute('data-theme');
	return theme !== 'light';
}

function optimalBandPlugin(getMin: () => number | undefined, getMax: () => number | undefined, dashed: boolean) {
	return {
		hooks: {
			drawClear: (u: uPlot) => {
				const min = getMin();
				const max = getMax();
				if (min == null || max == null || !isFinite(min) || !isFinite(max)) return;
				const ctx = u.ctx;
				const yMin = u.valToPos(min, 'y', true);
				const yMax = u.valToPos(max, 'y', true);
				const top = Math.min(yMin, yMax);
				const height = Math.abs(yMin - yMax);
				const left = u.bbox.left;
				const width = u.bbox.width;
				ctx.save();
				ctx.fillStyle = 'rgba(34,197,94,0.10)';
				ctx.fillRect(left, top, width, height);
				if (dashed) {
					ctx.strokeStyle = 'rgba(34,197,94,0.7)';
					ctx.setLineDash([5, 4]);
					ctx.lineWidth = 1;
					ctx.strokeRect(left, top, width, height);
				}
				ctx.restore();
			},
		},
	};
}

function optimalValueLinePlugin(getValue: () => number | null | undefined, unit: string) {
	return {
		hooks: {
			draw: (u: uPlot) => {
				const v = getValue();
				if (v == null || !isFinite(v)) return;
				const ctx = u.ctx;
				const y = u.valToPos(v, 'y', true);
				const left = u.bbox.left;
				const right = u.bbox.left + u.bbox.width;
				const dark = isDarkTheme();
				const lineColor = dark ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.5)';
				const labelBg = dark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.9)';
				const labelText = dark ? '#f1f5f9' : '#0f172a';
				const labelBorder = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
				ctx.save();
				ctx.strokeStyle = lineColor;
				ctx.setLineDash([4, 4]);
				ctx.lineWidth = 1.2;
				ctx.beginPath();
				ctx.moveTo(left, y);
				ctx.lineTo(right, y);
				ctx.stroke();
				ctx.setLineDash([]);
				const label = `Optimal: ${v.toFixed(2)} ${unit}`;
				ctx.font = '11px ui-sans-serif, system-ui';
				const w = ctx.measureText(label).width + 8;
				ctx.fillStyle = labelBg;
				ctx.fillRect(right - w - 4, y - 16, w, 14);
				ctx.strokeStyle = labelBorder;
				ctx.lineWidth = 1;
				ctx.strokeRect(right - w - 4, y - 16, w, 14);
				ctx.fillStyle = labelText;
				ctx.fillText(label, right - w, y - 5);
				ctx.restore();
			},
		},
	};
}

function minMaxBandPlugin(color: string) {
	return {
		hooks: {
			draw: (u: uPlot) => {
				const xs = u.data[0] as number[];
				const mins = u.data[2] as (number | null)[] | undefined;
				const maxs = u.data[3] as (number | null)[] | undefined;
				if (!mins || !maxs || xs.length === 0) return;
				const ctx = u.ctx;
				ctx.save();
				ctx.beginPath();
				let started = false;
				for (let i = 0; i < xs.length; i++) {
					const mx = maxs[i];
					if (mx == null) continue;
					const x = u.valToPos(xs[i], 'x', true);
					const y = u.valToPos(mx, 'y', true);
					if (!started) {
						ctx.moveTo(x, y);
						started = true;
					} else {
						ctx.lineTo(x, y);
					}
				}
				for (let i = xs.length - 1; i >= 0; i--) {
					const mn = mins[i];
					if (mn == null) continue;
					const x = u.valToPos(xs[i], 'x', true);
					const y = u.valToPos(mn, 'y', true);
					ctx.lineTo(x, y);
				}
				ctx.closePath();
				ctx.fillStyle = color + '33';
				ctx.fill();
				ctx.restore();
			},
		},
	};
}

function lastPointPlugin(color: string) {
	return {
		hooks: {
			draw: (u: uPlot) => {
				const xs = u.data[0] as number[];
				const ys = u.data[1] as (number | null)[];
				if (!xs.length) return;
				let i = xs.length - 1;
				while (i >= 0 && (ys[i] == null || !isFinite(ys[i] as number))) i--;
				if (i < 0) return;
				const x = u.valToPos(xs[i], 'x', true);
				const y = u.valToPos(ys[i] as number, 'y', true);
				const ctx = u.ctx;
				ctx.save();
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.arc(x, y, 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = '#fff';
				ctx.lineWidth = 2;
				ctx.stroke();
				ctx.restore();
			},
		},
	};
}

function anomalyMarkerPlugin(getCounts: () => number[] | undefined) {
	return {
		hooks: {
			draw: (u: uPlot) => {
				const counts = getCounts();
				if (!counts) return;
				const xs = u.data[0] as number[];
				const ctx = u.ctx;
				const yPos = u.bbox.top + u.bbox.height - 4;
				ctx.save();
				ctx.fillStyle = '#ef4444';
				for (let i = 0; i < xs.length; i++) {
					if (counts[i] > 0) {
						const x = u.valToPos(xs[i], 'x', true);
						ctx.beginPath();
						ctx.arc(x, yPos, 3, 0, Math.PI * 2);
						ctx.fill();
					}
				}
				ctx.restore();
			},
		},
	};
}

function cursorPlugin(onCursor: (idx: number | null, left: number, top: number) => void) {
	return {
		hooks: {
			setCursor: (u: uPlot) => {
				const idx = u.cursor.idx;
				const left = u.cursor.left ?? -1;
				const top = u.cursor.top ?? -1;
				onCursor(idx == null || left < 0 ? null : idx, left, top);
			},
		},
	};
}

function statusOf(v: number, mn?: number, mx?: number) {
	if (mn == null || mx == null) return null;
	if (v < mn || v > mx) return { color: '#ef4444', text: 'Alert' };
	return { color: '#22c55e', text: 'Optimal' };
}

export default function SensorChart(props: Props) {
	const {
		mode,
		sensor,
		unit,
		label,
		data,
		aggregated,
		compareSeries,
		optimalMin,
		optimalMax,
		optimalValue,
		range = '7d',
		bucketSize,
		isLoading,
	} = props;

	const wrapRef = useRef<HTMLDivElement | null>(null);
	const plotRef = useRef<uPlot | null>(null);
	const [cursor, setCursor] = useState<{ idx: number | null; x: number; y: number }>({
		idx: null,
		x: 0,
		y: 0,
	});
	const [chartWidth, setChartWidth] = useState(600);
	const color = SENSOR_COLOR[sensor];

	const aligned = useMemo(() => {
		if (mode === 'compare') {
			const series = compareSeries ?? [];
			const xsSet = new Set<number>();
			for (const s of series) {
				for (const b of s.data) xsSet.add(Math.floor(b.time / 1000));
			}
			const xs = Array.from(xsSet).sort((a, b) => a - b);
			const xIndex = new Map<number, number>();
			xs.forEach((x, i) => xIndex.set(x, i));
			const pondYs: (number | null)[][] = series.map(() =>
				new Array(xs.length).fill(null),
			);
			series.forEach((s, si) => {
				for (const b of s.data) {
					const i = xIndex.get(Math.floor(b.time / 1000));
					if (i != null) pondYs[si][i] = b.avg;
				}
			});
			return { xs, series: pondYs, counts: undefined as number[] | undefined };
		}
		if (mode === 'raw') {
			const pts = data ?? [];
			const xs: number[] = new Array(pts.length);
			const ys: (number | null)[] = new Array(pts.length);
			for (let i = 0; i < pts.length; i++) {
				xs[i] = Math.floor(pts[i].time / 1000);
				ys[i] = pts[i].value;
			}
			return { xs, series: [ys] as (number | null)[][], counts: undefined as number[] | undefined };
		}
		const buckets = aggregated ?? [];
		const xs: number[] = new Array(buckets.length);
		const avg: (number | null)[] = new Array(buckets.length);
		const min: (number | null)[] = new Array(buckets.length);
		const max: (number | null)[] = new Array(buckets.length);
		const counts: number[] = new Array(buckets.length);
		for (let i = 0; i < buckets.length; i++) {
			xs[i] = Math.floor(buckets[i].time / 1000);
			avg[i] = buckets[i].avg;
			min[i] = buckets[i].min;
			max[i] = buckets[i].max;
			counts[i] = buckets[i].anomalyCount;
		}
		return { xs, series: [avg, min, max], counts };
	}, [mode, data, aggregated, compareSeries]);

	const stats = useMemo(() => {
		if (mode === 'compare') return null;
		if (mode === 'raw') {
			const pts = data ?? [];
			if (pts.length === 0) return null;
			let mn = Infinity;
			let mx = -Infinity;
			let sum = 0;
			for (const p of pts) {
				if (p.value < mn) mn = p.value;
				if (p.value > mx) mx = p.value;
				sum += p.value;
			}
			return {
				now: pts[pts.length - 1].value,
				avg: sum / pts.length,
				min: mn,
				max: mx,
				count: pts.length,
			};
		}
		const buckets = aggregated ?? [];
		if (buckets.length === 0) return null;
		let mn = Infinity;
		let mx = -Infinity;
		let sum = 0;
		let anom = 0;
		for (const b of buckets) {
			if (b.min < mn) mn = b.min;
			if (b.max > mx) mx = b.max;
			sum += b.avg;
			anom += b.anomalyCount;
		}
		return {
			now: buckets[buckets.length - 1].avg,
			avg: sum / buckets.length,
			min: mn,
			max: mx,
			count: buckets.length,
			anomalyCount: anom,
		};
	}, [mode, data, aggregated]);

	useEffect(() => {
		if (!wrapRef.current) return;
		const el = wrapRef.current;

		const plugins: uPlot.Plugin[] = [
			optimalBandPlugin(() => optimalMin, () => optimalMax, mode === 'aggregated'),
		];
		if (mode === 'aggregated') {
			plugins.unshift(minMaxBandPlugin(color));
			plugins.push(anomalyMarkerPlugin(() => aligned.counts));
		}
		if (mode !== 'compare') {
			plugins.push(lastPointPlugin(color));
		}
		plugins.push(optimalValueLinePlugin(() => optimalValue ?? null, unit));
		plugins.push(
			cursorPlugin((idx, x, y) => setCursor({ idx, x, y })),
		);

		const showDots = mode === 'raw' && range === 'today';

		let series: uPlot.Series[];
		if (mode === 'compare') {
			const compare = compareSeries ?? [];
			series = [
				{},
				...compare.map((s) => ({
					label: s.pondName,
					stroke: s.color,
					width: 2,
					points: { show: false },
				})),
			];
		} else if (mode === 'raw') {
			series = [
				{},
				{
					label,
					stroke: color,
					width: 2,
					points: showDots
						? { show: true, size: 6, fill: color, stroke: '#fff' }
						: { show: false },
				},
			];
		} else {
			series = [
				{},
				{ label: 'avg', stroke: color, width: 2, points: { show: false } },
				{ label: 'min', stroke: 'transparent', points: { show: false } },
				{ label: 'max', stroke: 'transparent', points: { show: false } },
			];
		}

		const opts: uPlot.Options = {
			width: el.clientWidth || 600,
			height: 280,
			scales: { x: { time: true } },
			legend: { show: false },
			cursor: {
				drag: { x: true, y: false },
				focus: { prox: 30 },
				points: { show: true, size: 8, fill: color, stroke: '#fff' },
			},
			axes: [
				{
					values: (_u, ticks) => ticks.map((t) => formatTick(t * 1000, range)),
					stroke: '#94a3b8',
					grid: { stroke: 'rgba(148,163,184,0.08)' },
					ticks: { stroke: 'rgba(148,163,184,0.2)' },
					space: xAxisSpace(range),
					incrs: xAxisIncrs(range),
					size: range === 'today' ? 40 : 55,
					rotate: range === 'today' ? 0 : -30,
					gap: 8,
				},
				{
					stroke: '#94a3b8',
					grid: { stroke: 'rgba(148,163,184,0.08)' },
					ticks: { stroke: 'rgba(148,163,184,0.2)' },
				},
			],
			series,
			plugins,
		};

		const u = new uPlot(opts, [aligned.xs, ...aligned.series] as uPlot.AlignedData, el);
		plotRef.current = u;

		const ro = new ResizeObserver(() => {
			if (!plotRef.current || !wrapRef.current) return;
			const w = wrapRef.current.clientWidth;
			plotRef.current.setSize({ width: w, height: 280 });
			setChartWidth(w);
		});
		ro.observe(el);

		const themeObs = new MutationObserver(() => plotRef.current?.redraw());
		themeObs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});

		return () => {
			ro.disconnect();
			themeObs.disconnect();
			u.destroy();
			plotRef.current = null;
		};
	}, [mode, sensor, label, color, range, optimalMin, optimalMax, optimalValue, unit, aligned, compareSeries]);

	const headerHealth: Health | null =
		mode === 'aggregated' ? bucketsHealth(aggregated ?? []) : null;
	const nowStatus = stats ? statusOf(stats.now, optimalMin, optimalMax) : null;

	const hover = (() => {
		const idx = cursor.idx;
		if (idx == null) return null;
		if (mode === 'compare') {
			const ts = aligned.xs[idx];
			if (ts == null) return null;
			const compare = compareSeries ?? [];
			const lines = compare
				.map((s, si) => {
					const v = aligned.series[si]?.[idx];
					return v == null
						? null
						: { k: s.pondName, v: v as number, color: s.color };
				})
				.filter((x): x is { k: string; v: number; color: string } => x !== null);
			if (lines.length === 0) return null;
			return { time: ts * 1000, value: lines[0].v, lines };
		}
		if (mode === 'raw') {
			const p = (data ?? [])[idx];
			if (!p) return null;
			return {
				time: p.time,
				value: p.value,
				lines: [{ k: 'value', v: p.value, color }],
			};
		}
		const b = (aggregated ?? [])[idx];
		if (!b) return null;
		return {
			time: b.time,
			value: b.avg,
			lines: [
				{ k: 'avg', v: b.avg, color },
				{ k: 'min', v: b.min, color: '#9ca3af' },
				{ k: 'max', v: b.max, color: '#9ca3af' },
			],
			anomalyCount: b.anomalyCount,
			health: b.health,
		};
	})();

	if (isLoading) {
		return (
			<div className="rounded-xl border border-[var(--border)] bg-[rgba(15,23,42,0.7)] backdrop-blur-sm p-6">
				<h3 className="text-base font-semibold text-slate-100 mb-4">{label}</h3>
				<div className="h-70 bg-white/5 rounded animate-pulse" />
			</div>
		);
	}

	const empty =
		(mode === 'raw' && (!data || data.length === 0)) ||
		(mode === 'aggregated' && (!aggregated || aggregated.length === 0)) ||
		(mode === 'compare' && (!compareSeries || compareSeries.every((s) => s.data.length === 0)));

	const waitingForData =
		mode === 'raw' && range === 'today' && (data?.length ?? 0) === 0;

	const tooltipWidth = mode === 'compare' ? 220 : 170;

	return (
		<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-5 shadow-[0_4px_30px_-12px_rgba(0,0,0,0.5)]">
			<div className="flex items-start justify-between mb-3 gap-2">
				<div>
					<h3 className="text-base font-semibold text-slate-100">{label}</h3>
					<p className="text-[11px] text-slate-500 mt-0.5 font-mono uppercase tracking-wider">
						{mode === 'compare'
							? `compare · ${compareSeries?.length ?? 0} ponds${bucketSize ? ` · bucket ${bucketSize}` : ''}`
							: mode === 'aggregated' && bucketSize
								? `aggregated · bucket ${bucketSize}`
								: `raw · ${stats?.count ?? 0} pts`}
					</p>
				</div>
				{headerHealth && <HealthBadge health={headerHealth} />}
			</div>

			{stats && mode !== 'compare' && (
				<div className="grid grid-cols-4 gap-2 mb-3">
					<StatCell
						label="now"
						value={stats.now}
						unit={unit}
						color={nowStatus?.color ?? color}
						sub={nowStatus?.text}
					/>
					<StatCell label="avg" value={stats.avg} unit={unit} color="#374151" />
					<StatCell label="min" value={stats.min} unit={unit} color="#0ea5e9" />
					<StatCell label="max" value={stats.max} unit={unit} color="#ef4444" />
				</div>
			)}

			<div className="relative">
				<div ref={wrapRef} className="w-full" style={{ minHeight: 280 }} />
				{empty && !waitingForData && (
					<div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)] text-sm">
						no data
					</div>
				)}
				{waitingForData && (
					<div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)] text-sm pointer-events-none bg-[var(--bg-card-2)]">
						<p>Waiting for data — readings arrive every 15 minutes</p>
					</div>
				)}
				{hover && !empty && (
					<div
						className="absolute rounded-lg shadow-2xl px-3 py-2 text-xs pointer-events-none z-10 backdrop-blur-md"
						style={{
							background: 'rgba(10, 15, 31, 0.92)',
							border: `1px solid ${color}66`,
							boxShadow: `0 8px 30px -8px ${color}40, 0 0 0 1px ${color}30`,
							left: Math.min(
								Math.max(cursor.x + 12, 8),
								Math.max(chartWidth - tooltipWidth - 8, 8),
							),
							top: Math.max(cursor.y - 60, 4),
							minWidth: tooltipWidth - 20,
						}}>
						<div className="font-semibold text-slate-200 mb-1.5 text-[11px]">
							Time: {formatTooltipTime(hover.time, mode)}
						</div>
						{hover.lines.map((l) => (
							<div
								key={l.k}
								className="flex items-center justify-between gap-3"
								style={{ color: l.color }}>
								<span className="font-medium uppercase tracking-wider text-[10px]">{l.k}</span>
								<span className="font-mono">
									{l.v.toFixed(2)} {unit}
								</span>
							</div>
						))}
						{'anomalyCount' in hover && hover.anomalyCount! > 0 && (
							<div className="text-rose-400 mt-1.5 font-medium border-t border-white/10 pt-1">
								anomalies: {hover.anomalyCount}
							</div>
						)}
						{'health' in hover && hover.health && (
							<div className="mt-1 flex items-center gap-1.5">
								<span className="text-slate-400 uppercase tracking-wider text-[10px]">
									status
								</span>
								<HealthBadge health={hover.health} />
							</div>
						)}
					</div>
				)}
			</div>

			<div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5 text-xs flex-wrap gap-2">
				<div className="flex items-center gap-3 flex-wrap">
					{mode === 'compare' ? (
						(compareSeries ?? []).map((s) => (
							<LegendDot key={s.pondId} color={s.color} label={s.pondName} />
						))
					) : (
						<>
							<LegendDot color={color} label={mode === 'aggregated' ? 'avg' : label} />
							{mode === 'aggregated' && (
								<LegendDot color={color} label="min–max range" band />
							)}
							{optimalMin != null && optimalMax != null && (
								<LegendDot
									color="#22c55e"
									label={`optimal ${optimalMin}–${optimalMax} ${unit}`}
									dashed={mode === 'aggregated'}
									band={mode === 'raw'}
								/>
							)}
							{optimalValue != null && (
								<LegendDot
									color="#ffffff"
									label={`optimal ${optimalValue} ${unit}`}
									dashed
								/>
							)}
							{mode === 'aggregated' &&
								stats &&
								'anomalyCount' in stats &&
								(stats.anomalyCount ?? 0) > 0 && (
									<LegendDot color="#ef4444" label={`${stats.anomalyCount} anomalies`} />
								)}
						</>
					)}
				</div>
				<span className="text-slate-500">hover chart for details</span>
			</div>
		</div>
	);
}

function StatCell({
	label,
	value,
	unit,
	color,
	sub,
}: {
	label: string;
	value: number;
	unit: string;
	color: string;
	sub?: string;
}) {
	return (
		<div className="bg-white/3 border border-white/5 rounded-md px-3 py-2">
			<div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
				{label}
			</div>
			<div className="font-bold text-base font-mono" style={{ color }}>
				{value.toFixed(2)}
				<span className="text-xs font-normal text-slate-500 ml-1">{unit}</span>
			</div>
			{sub && (
				<div className="text-[10px] font-semibold mt-0.5" style={{ color }}>
					{sub}
				</div>
			)}
		</div>
	);
}

function LegendDot({
	color,
	label,
	dashed,
	band,
}: {
	color: string;
	label: string;
	dashed?: boolean;
	band?: boolean;
}) {
	let marker;
	if (band) {
		marker = (
			<span
				className="inline-block w-4 h-3 rounded-sm"
				style={{ backgroundColor: color + '33', border: dashed ? `1px dashed ${color}` : 'none' }}
			/>
		);
	} else if (dashed) {
		marker = (
			<span
				className="inline-block w-4 h-0 align-middle"
				style={{ borderTop: `2px dashed ${color}` }}
			/>
		);
	} else {
		marker = (
			<span
				className="inline-block w-3 h-3 rounded-full"
				style={{ backgroundColor: color }}
			/>
		);
	}
	return (
		<span className="inline-flex items-center gap-1.5 text-slate-400">
			{marker}
			<span>{label}</span>
		</span>
	);
}
