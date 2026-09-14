'use client';

import { ErrorMessage, LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import RequestMaintenanceButton from '@/components/RequestMaintenanceButton';
import SensorChart, { type CompareSeries } from '@/components/charts/SensorChart';
import { useDashboardStats, usePondStatuses, type PondStatus } from '@/hooks/useDashboardStats';
import {
	useCompareReadings,
	useMultiPondReadings,
	usePonds,
	type PondWithOwner,
	type Range,
} from '@/hooks/useApi';
import { useThresholds } from '@/hooks/useThresholds';
import { STATUS_DOT_BG, STATUS_DOT_GLOW, STATUS_LABEL } from '@/lib/pondStatus';
import Link from 'next/link';
import { useMemo, useState } from 'react';

const POND_COLORS = [
	'#22d3ee',
	'#f97316',
	'#a855f7',
	'#10b981',
	'#f43f5e',
	'#eab308',
	'#3b82f6',
	'#ec4899',
	'#14b8a6',
	'#f59e0b',
];

type ViewMode = 'aggregated' | 'compare';

export default function DashboardPage() {
	const { ponds, isLoading, error } = usePonds();
	const { stats } = useDashboardStats();
	const { byId: statusByPondId } = usePondStatuses();
	const [range, setRange] = useState<Range>('today');
	const [viewMode, setViewMode] = useState<ViewMode>('aggregated');
	const [selectedOverride, setSelectedOverride] = useState<Set<string> | null>(null);
	const selectedPondIds = useMemo<Set<string> | null>(() => {
		if (selectedOverride !== null) return selectedOverride;
		if (ponds) return new Set(ponds.map((p) => p.id));
		return null;
	}, [ponds, selectedOverride]);

	const RANGE_OPTIONS: { value: Range; label: string }[] = [
		{ value: 'today', label: 'Today' },
		{ value: '7d', label: '7d' },
		{ value: '14d', label: '14d' },
		{ value: '30d', label: '30d' },
	];

	const allSelected =
		ponds != null &&
		selectedPondIds != null &&
		selectedPondIds.size === ponds.length;

	const pondsParam: string[] | 'all' = useMemo(() => {
		if (!ponds || !selectedPondIds) return 'all';
		if (allSelected) return 'all';
		return Array.from(selectedPondIds);
	}, [ponds, selectedPondIds, allSelected]);

	const singlePondId =
		selectedPondIds && selectedPondIds.size === 1
			? Array.from(selectedPondIds)[0]
			: null;
	const { lookup: lookupThreshold } = useThresholds(singlePondId);

	// Only the visible view mode polls. Hooks must be called unconditionally
	// (rules of hooks), so the inactive set is parked rather than skipped.
	const showCompare = viewMode === 'compare';
	const tempAgg = useMultiPondReadings('temperature', range, pondsParam, !showCompare);
	const phAgg = useMultiPondReadings('ph', range, pondsParam, !showCompare);
	const doxAgg = useMultiPondReadings('dox', range, pondsParam, !showCompare);
	const salinityAgg = useMultiPondReadings('salinity', range, pondsParam, !showCompare);

	const tempCmp = useCompareReadings('temperature', range, pondsParam, showCompare);
	const phCmp = useCompareReadings('ph', range, pondsParam, showCompare);
	const doxCmp = useCompareReadings('dox', range, pondsParam, showCompare);
	const salinityCmp = useCompareReadings('salinity', range, pondsParam, showCompare);

	const pondColorMap = useMemo(() => {
		const m = new Map<number, string>();
		(ponds ?? []).forEach((p, i) => {
			m.set(Number(p.id), POND_COLORS[i % POND_COLORS.length]);
		});
		return m;
	}, [ponds]);

	function compareFor(payload: { series: { pondId: number; pondName: string; data: CompareSeries['data'] }[] } | undefined): CompareSeries[] | undefined {
		if (!payload) return undefined;
		return payload.series.map((s) => ({
			pondId: s.pondId,
			pondName: s.pondName,
			color: pondColorMap.get(s.pondId) ?? '#22d3ee',
			data: s.data,
		}));
	}

	function togglePond(id: string) {
		if (!ponds || !selectedPondIds) return;
		const next = new Set(selectedPondIds);
		if (next.has(id)) {
			if (next.size <= 1) return;
			next.delete(id);
		} else {
			next.add(id);
		}
		setSelectedOverride(next);
	}

	function toggleAll() {
		if (!ponds) return;
		if (selectedPondIds && selectedPondIds.size === ponds.length) {
			setSelectedOverride(new Set([ponds[0].id]));
		} else {
			setSelectedOverride(new Set(ponds.map((p) => p.id)));
		}
	}

	const selectedCount = selectedPondIds?.size ?? 0;

	return (
		<MainLayout>
			<div className="space-y-8">
				<div className="flex items-end justify-between flex-wrap gap-4">
					<div>
						<div className="flex items-center gap-2 mb-2">
							<span className="live-dot" />
							<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-emerald-300">
								Live Telemetry
							</span>
						</div>
						<h1 className="text-4xl font-bold text-white tracking-tight">
							Control Center
						</h1>
						<p className="text-slate-400 mt-1.5 text-sm">
							Realtime monitoring across all ponds
						</p>
					</div>
					<div className="text-right">
						<p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
							Server Time
						</p>
						<p className="text-mono text-lg font-semibold text-cyan-300">
							{new Date().toLocaleTimeString()}
						</p>
					</div>
				</div>

				{error && <ErrorMessage message="Failed to load ponds" />}

				{isLoading ? (
					<LoadingSpinner />
				) : ponds && ponds.length > 0 ? (
					<>
						<div>
							<div className="flex items-center justify-between mb-4">
								<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
									System Overview
								</h2>
								<span className="text-[10px] text-slate-500 font-mono">
									{ponds.length} nodes
								</span>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
								<StatTile
									label="Total Ponds"
									value={String(stats?.totalPonds ?? ponds.length)}
									accent="cyan"
								/>
								<StatTile
									label="Active Sensors"
									value={
										stats
											? `${stats.activeSensors} / ${stats.totalSensors}`
											: `${ponds.length * 4}`
									}
									accent="emerald"
								/>
								<StatTile
									label="Last Update"
									value={
										stats?.lastReceivedAt
											? new Date(stats.lastReceivedAt).toLocaleTimeString()
											: '—'
									}
									accent="violet"
									mono
								/>
							</div>
						</div>

						<div>
							<div className="flex items-center justify-between mb-4">
								<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
									Pond Network
								</h2>
								<span className="text-[10px] text-slate-500 font-mono">
									tap to view
								</span>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
								{ponds.map((pond) => {
									const status = statusByPondId.get(pond.id);
									return (
										<div
											key={pond.id}
											className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-4 transition-all hover:-translate-y-0.5 hover:border-cyan-400/50 hover:shadow-[0_0_30px_-12px_rgba(34,211,238,0.5)]">
											<Link
												href={`/dashboard/${pond.id}`}
												aria-label={`View ${pond.name}`}
												className="absolute inset-0 z-10"
											/>
											<div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
											<div className="pointer-events-none">
												<div className="flex items-start justify-between mb-2">
													<div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center text-cyan-300">
														<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
															<path d="M2 17a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v0M12 17a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v0" />
															<path d="M2 12a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5M12 12a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5" />
														</svg>
													</div>
													<PondStatusDot status={status} />
												</div>
												<p className="font-semibold text-slate-100 text-sm truncate">
													{pond.name}
												</p>
												<p className="text-[11px] text-slate-400 mt-0.5 truncate">
													{pond.location}
												</p>
												{(pond as PondWithOwner).company_name && (
													<p className="text-[10px] text-violet-300 mt-2 font-medium uppercase tracking-wider truncate">
														{(pond as PondWithOwner).company_name}
													</p>
												)}
												<div className="mt-3 pointer-events-auto relative z-20">
													<RequestMaintenanceButton
														pondId={Number(pond.id)}
														pondName={pond.name}
													/>
												</div>
											</div>
										</div>
									);
								})}
							</div>
						</div>

						<div>
							<div className="flex items-center justify-between mb-4 flex-wrap gap-2">
								<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
									Sensor Trends
									<span className="text-slate-500 normal-case tracking-normal ml-2 font-normal">
										· {selectedCount} of {ponds.length} pond{ponds.length === 1 ? '' : 's'}
									</span>
								</h2>
								<div className="inline-flex items-center gap-1 p-1 rounded-lg border border-[var(--border)] bg-white/3">
									{RANGE_OPTIONS.map((opt) => (
										<button
											key={opt.value}
											onClick={() => setRange(opt.value)}
											className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
												range === opt.value
													? 'bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_-5px_rgba(34,211,238,0.6)]'
													: 'text-slate-400 hover:text-slate-200'
											}`}>
											{opt.label}
										</button>
									))}
								</div>
							</div>

							<div className="flex flex-wrap items-center gap-2 mb-3">
								<PondPill
									label="All Ponds"
									checked={allSelected}
									onClick={toggleAll}
									color="#22d3ee"
								/>
								{ponds.map((p) => {
									const checked = selectedPondIds?.has(p.id) ?? false;
									return (
										<PondPill
											key={p.id}
											label={p.name}
											checked={checked}
											onClick={() => togglePond(p.id)}
											color={pondColorMap.get(Number(p.id)) ?? '#22d3ee'}
											disabled={checked && selectedCount <= 1}
										/>
									);
								})}
							</div>

							<div className="flex items-center gap-4 mb-4 flex-wrap">
								<span className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-500">
									View
								</span>
								<label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
									<input
										type="radio"
										name="viewMode"
										checked={viewMode === 'aggregated'}
										onChange={() => setViewMode('aggregated')}
										className="accent-cyan-500"
									/>
									<span
										className={
											viewMode === 'aggregated'
												? 'text-cyan-300 font-semibold'
												: 'text-slate-400'
										}>
										Aggregated
									</span>
								</label>
								<label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
									<input
										type="radio"
										name="viewMode"
										checked={viewMode === 'compare'}
										onChange={() => setViewMode('compare')}
										className="accent-cyan-500"
									/>
									<span
										className={
											viewMode === 'compare'
												? 'text-cyan-300 font-semibold'
												: 'text-slate-400'
										}>
										Compare Ponds
									</span>
								</label>
							</div>

							<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
								<TrendChart
									sensor="temperature"
									unit="°C"
									label="Temperature"
									range={range}
									showCompare={showCompare}
									aggPayload={tempAgg.payload}
									cmpPayload={compareFor(tempCmp.payload)}
									cmpBucket={tempCmp.payload?.bucketSize}
									optimal={singlePondId ? lookupThreshold('temperature') : undefined}
								/>
								<TrendChart
									sensor="ph"
									unit="pH"
									label="pH Level"
									range={range}
									showCompare={showCompare}
									aggPayload={phAgg.payload}
									cmpPayload={compareFor(phCmp.payload)}
									cmpBucket={phCmp.payload?.bucketSize}
									optimal={singlePondId ? lookupThreshold('ph') : undefined}
								/>
								<TrendChart
									sensor="dissolved_oxygen"
									unit="mg/L"
									label="Dissolved Oxygen"
									range={range}
									showCompare={showCompare}
									aggPayload={doxAgg.payload}
									cmpPayload={compareFor(doxCmp.payload)}
									cmpBucket={doxCmp.payload?.bucketSize}
									optimal={singlePondId ? lookupThreshold('dox') : undefined}
								/>
								<TrendChart
									sensor="salinity"
									unit="ppt"
									label="Salinity"
									range={range}
									showCompare={showCompare}
									aggPayload={salinityAgg.payload}
									cmpPayload={compareFor(salinityCmp.payload)}
									cmpBucket={salinityCmp.payload?.bucketSize}
									optimal={singlePondId ? lookupThreshold('salinity') : undefined}
								/>
							</div>
						</div>
					</>
				) : (
					<ErrorMessage message="No ponds available" />
				)}
			</div>
		</MainLayout>
	);
}

function TrendChart({
	sensor,
	unit,
	label,
	range,
	showCompare,
	aggPayload,
	cmpPayload,
	cmpBucket,
	optimal,
}: {
	sensor: 'temperature' | 'ph' | 'salinity' | 'dissolved_oxygen';
	unit: string;
	label: string;
	range: Range;
	showCompare: boolean;
	aggPayload:
		| { mode: 'raw'; data: { time: number; value: number }[] }
		| { mode: 'aggregated'; bucketSize: string; data: import('@/hooks/useApi').AggregatedBucket[] }
		| undefined;
	cmpPayload: CompareSeries[] | undefined;
	cmpBucket: string | undefined;
	optimal?: { min: number; max: number; value: number | null };
}) {
	if (showCompare) {
		return (
			<SensorChart
				mode="compare"
				sensor={sensor}
				unit={unit}
				label={label}
				range={range}
				compareSeries={cmpPayload}
				bucketSize={cmpBucket}
			/>
		);
	}
	return (
		<SensorChart
			mode={aggPayload?.mode === 'aggregated' ? 'aggregated' : 'raw'}
			sensor={sensor}
			unit={unit}
			label={label}
			range={range}
			data={aggPayload?.mode === 'raw' ? aggPayload.data : undefined}
			aggregated={aggPayload?.mode === 'aggregated' ? aggPayload.data : undefined}
			bucketSize={aggPayload?.mode === 'aggregated' ? aggPayload.bucketSize : undefined}
			optimalMin={optimal?.min}
			optimalMax={optimal?.max}
			optimalValue={optimal?.value ?? null}
		/>
	);
}

function PondPill({
	label,
	checked,
	onClick,
	color,
	disabled,
}: {
	label: string;
	checked: boolean;
	onClick: () => void;
	color: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
				checked
					? 'bg-white/10 border-white/20 text-white'
					: 'bg-white/3 border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5'
			}`}>
			<span
				className="inline-block w-2.5 h-2.5 rounded-full"
				style={{
					backgroundColor: checked ? color : 'transparent',
					border: `1.5px solid ${color}`,
				}}
			/>
			{label}
		</button>
	);
}

function PondStatusDot({ status }: { status: PondStatus | undefined }) {
	const key = status?.status ?? 'offline';
	const minutes = status?.minutesSinceLastData;
	const mins = minutes == null ? null : Math.floor(minutes);
	const dataTip =
		minutes === null || minutes === undefined
			? 'No data received'
			: key === 'online'
				? `Last data ${mins} mins ago`
				: key === 'stale'
					? `No data for ${mins} mins — check ESP32`
					: key === 'offline'
						? `No data for ${mins} mins — OFFLINE — alarm triggered`
						: `Last data ${mins} mins ago`;

	const tooltip =
		key === 'maintenance' ? `Maintenance · ${dataTip}` : `${STATUS_LABEL[key]} · ${dataTip}`;
	const animate = key === 'online';

	return (
		<span
			title={tooltip}
			className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT_BG[key]} ${STATUS_DOT_GLOW[key]} ${animate ? 'animate-[pulse-dot_1.6s_ease-in-out_infinite]' : ''}`}
		/>
	);
}

function StatTile({
	label,
	value,
	accent,
	pulse,
	mono,
	sub,
}: {
	label: string;
	value: string;
	accent: 'cyan' | 'emerald' | 'violet' | 'rose';
	pulse?: boolean;
	mono?: boolean;
	sub?: string;
}) {
	const map = {
		cyan: { text: 'text-cyan-300', bar: '#22d3ee' },
		emerald: { text: 'text-emerald-300', bar: '#34d399' },
		violet: { text: 'text-violet-300', bar: '#a78bfa' },
		rose: { text: 'text-rose-300', bar: '#fb7185' },
	}[accent];
	return (
		<div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-5">
			<div
				className="absolute inset-x-0 top-0 h-px"
				style={{ background: `linear-gradient(90deg, transparent, ${map.bar}80, transparent)` }}
			/>
			<div className="flex items-center justify-between">
				<p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400">
					{label}
				</p>
				{pulse && <span className="live-dot" />}
			</div>
			<p
				className={`mt-2 font-bold ${map.text} ${mono ? 'text-mono text-base' : 'text-3xl'} truncate`}>
				{value}
			</p>
			{sub && (
				<p className="mt-1 text-[10px] text-slate-500 truncate">{sub}</p>
			)}
		</div>
	);
}
