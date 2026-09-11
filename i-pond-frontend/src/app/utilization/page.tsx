'use client';

import { ErrorMessage, LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import { usePonds } from '@/hooks/useApi';
import { useMemo, useState } from 'react';

const MS_PER_DAY = 24 * 3600 * 1000;
const MAX_RANGE_DAYS = 90;

type Status = 'online' | 'stale' | 'offline' | 'maintenance';
type BreakdownEntry = { minutes: number; percent: number };
type UtilRow = {
	pondId: number;
	pondName: string;
	totalMinutes: number;
	breakdown: Record<Status, BreakdownEntry>;
};

type ScopeMode = 'all' | 'select';
type RangeMode = 'preset' | 'custom';
type Preset = 'today' | '7d' | '14d' | '30d';

const PRESETS: { value: Preset; label: string }[] = [
	{ value: 'today', label: 'Today' },
	{ value: '7d', label: 'Last 7 Days' },
	{ value: '14d', label: 'Last 14 Days' },
	{ value: '30d', label: 'Last 30 Days' },
];

const STATUS_BAR_BG: Record<Status, string> = {
	online: 'bg-emerald-400',
	stale: 'bg-amber-400',
	offline: 'bg-rose-500',
	maintenance: 'bg-blue-400',
};

const STATUS_TEXT: Record<Status, string> = {
	online: 'text-emerald-300',
	stale: 'text-amber-300',
	offline: 'text-rose-300',
	maintenance: 'text-blue-300',
};

const STATUS_LABEL: Record<Status, string> = {
	online: 'Online',
	stale: 'Stale',
	offline: 'Offline',
	maintenance: 'Maintenance',
};

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}
function isoDaysAgo(days: number): string {
	return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function validateCustom(from: string, to: string): string | null {
	if (!from || !to) return 'Pick both dates';
	const f = Date.parse(`${from}T00:00:00Z`);
	const t = Date.parse(`${to}T00:00:00Z`);
	if (!Number.isFinite(f) || !Number.isFinite(t)) return 'Invalid date';
	if (t < f) return 'To date before From';
	const span = Math.round((t - f) / MS_PER_DAY);
	if (span > MAX_RANGE_DAYS) return `Max range is ${MAX_RANGE_DAYS} days`;
	return null;
}

function resolveDates(
	rangeMode: RangeMode,
	preset: Preset,
	customFrom: string,
	customTo: string,
): { from: string; to: string } | null {
	if (rangeMode === 'custom') {
		if (validateCustom(customFrom, customTo)) return null;
		return { from: customFrom, to: customTo };
	}
	if (preset === 'today') {
		const t = todayIso();
		return { from: t, to: t };
	}
	const days = preset === '7d' ? 7 : preset === '14d' ? 14 : 30;
	return { from: isoDaysAgo(days - 1), to: todayIso() };
}

export default function UtilizationPage() {
	const { ponds, isLoading: isPondsLoading } = usePonds();

	const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
	const [selectedPondIds, setSelectedPondIds] = useState<string[]>([]);
	const [rangeMode, setRangeMode] = useState<RangeMode>('preset');
	const [preset, setPreset] = useState<Preset>('7d');
	const [customFrom, setCustomFrom] = useState<string>(isoDaysAgo(7));
	const [customTo, setCustomTo] = useState<string>(todayIso());

	const [rows, setRows] = useState<UtilRow[] | null>(null);
	const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const customError = useMemo(() => {
		if (rangeMode !== 'custom') return null;
		return validateCustom(customFrom, customTo);
	}, [rangeMode, customFrom, customTo]);

	const summary = useMemo(() => {
		if (!rows || rows.length === 0) return null;
		const avgOnline =
			rows.reduce((s, r) => s + r.breakdown.online.percent, 0) / rows.length;
		const totalOffline = rows.reduce(
			(s, r) => s + r.breakdown.offline.minutes,
			0,
		);
		const mostOffline = rows.slice().sort(
			(a, b) => b.breakdown.offline.minutes - a.breakdown.offline.minutes,
		)[0];
		const mostMaint = rows.slice().sort(
			(a, b) => b.breakdown.maintenance.minutes - a.breakdown.maintenance.minutes,
		)[0];
		return {
			avgOnline: Math.round(avgOnline * 10) / 10,
			totalOffline: Math.round(totalOffline * 10) / 10,
			mostOffline,
			mostMaint,
		};
	}, [rows]);

	const togglePond = (id: string) => {
		setSelectedPondIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	};

	async function apply() {
		setErrorMsg(null);
		setEmptyMessage(null);
		const dates = resolveDates(rangeMode, preset, customFrom, customTo);
		if (!dates) {
			setErrorMsg(customError ?? 'Pick a valid date range');
			return;
		}
		const qs = new URLSearchParams({ from: dates.from, to: dates.to });
		if (scopeMode === 'all') qs.set('ponds', 'all');
		else {
			if (selectedPondIds.length === 0) {
				setErrorMsg('Select at least one pond');
				return;
			}
			qs.set('ponds', selectedPondIds.join(','));
		}
		setLoading(true);
		try {
			const res = await fetch(`/api/utilization?${qs.toString()}`, {
				credentials: 'include',
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				setErrorMsg(`Failed: ${res.status} ${body.slice(0, 120)}`);
				setRows(null);
				return;
			}
			const json = (await res.json()) as {
				data: UtilRow[];
				message?: string;
			};
			setRows(json.data);
			const allZero =
				json.data.length === 0 ||
				json.data.every((r) => r.totalMinutes === 0);
			setEmptyMessage(json.message && allZero ? json.message : null);
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : 'Failed to load');
			setRows(null);
		} finally {
			setLoading(false);
		}
	}

	function downloadCsv() {
		if (!rows) return;
		const header = [
			'Pond',
			'Total Minutes',
			'Online %',
			'Stale %',
			'Offline %',
			'Maintenance %',
			'Online Min',
			'Stale Min',
			'Offline Min',
			'Maintenance Min',
		];
		const body = rows.map((r) => [
			r.pondName,
			String(r.totalMinutes),
			String(r.breakdown.online.percent),
			String(r.breakdown.stale.percent),
			String(r.breakdown.offline.percent),
			String(r.breakdown.maintenance.percent),
			String(r.breakdown.online.minutes),
			String(r.breakdown.stale.minutes),
			String(r.breakdown.offline.minutes),
			String(r.breakdown.maintenance.minutes),
		]);
		const csv = [header, ...body]
			.map((row) => row.map((c) => `"${c}"`).join(','))
			.join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `utilization_${todayIso()}.csv`;
		a.click();
		window.URL.revokeObjectURL(url);
	}

	const inputCls =
		'w-full px-4 py-2.5 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 text-[var(--text-primary)] transition-colors';
	const labelCls =
		'block text-[11px] uppercase tracking-[0.16em] font-semibold text-[var(--text-secondary)] mb-1.5';
	const pillBase =
		'px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors';
	const pillIdle =
		'bg-[var(--input-bg)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-white/10';
	const pillActive = 'bg-cyan-400/15 border-cyan-400/40 text-cyan-200';

	return (
		<MainLayout>
			<div className="space-y-8">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="#22d3ee"
							strokeWidth="1.8"
							className="w-4 h-4">
							<rect x="3" y="10" width="4" height="11" rx="1" />
							<rect x="10" y="6" width="4" height="15" rx="1" />
							<rect x="17" y="13" width="4" height="8" rx="1" />
						</svg>
						<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-cyan-300">
							Operations
						</span>
					</div>
					<h1 className="text-4xl font-bold text-[var(--text-primary)] tracking-tight">
						Utilization Rate
					</h1>
					<p className="text-[var(--text-secondary)] mt-1.5 text-sm">
						Time-in-status per pond over the selected range
					</p>
				</div>

				<div className="card-surface rounded-xl p-6 space-y-5">
					<div>
						<label className={labelCls}>Ponds</label>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => setScopeMode('all')}
								className={`${pillBase} ${scopeMode === 'all' ? pillActive : pillIdle}`}>
								All Ponds
							</button>
							<button
								type="button"
								onClick={() => setScopeMode('select')}
								className={`${pillBase} ${scopeMode === 'select' ? pillActive : pillIdle}`}>
								Select Specific
							</button>
						</div>
					</div>

					{scopeMode === 'select' && (
						<div className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-4">
							<p className={labelCls}>Pick ponds</p>
							{isPondsLoading ? (
								<LoadingSpinner />
							) : !ponds || ponds.length === 0 ? (
								<p className="text-xs text-[var(--text-muted)]">
									No ponds available.
								</p>
							) : (
								<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
									{ponds.map((p) => (
										<label
											key={p.id}
											className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
											<input
												type="checkbox"
												checked={selectedPondIds.includes(p.id)}
												onChange={() => togglePond(p.id)}
												className="accent-cyan-400"
											/>
											<span className="truncate">
												{p.name}{' '}
												<span className="text-[var(--text-muted)]">
													— {p.location}
												</span>
											</span>
										</label>
									))}
								</div>
							)}
						</div>
					)}

					<div>
						<label className={labelCls}>Date Range</label>
						<div className="flex flex-wrap gap-2">
							{PRESETS.map((p) => {
								const isActive = rangeMode === 'preset' && preset === p.value;
								return (
									<button
										key={p.value}
										type="button"
										onClick={() => {
											setRangeMode('preset');
											setPreset(p.value);
										}}
										className={`${pillBase} ${isActive ? pillActive : pillIdle}`}>
										{p.label}
									</button>
								);
							})}
							<button
								type="button"
								onClick={() => setRangeMode('custom')}
								className={`${pillBase} ${rangeMode === 'custom' ? pillActive : pillIdle}`}>
								Custom
							</button>
						</div>
					</div>

					{rangeMode === 'custom' && (
						<div className="space-y-2">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<label className={labelCls}>From</label>
									<input
										type="date"
										value={customFrom}
										onChange={(e) => setCustomFrom(e.target.value)}
										max={customTo || todayIso()}
										className={inputCls}
									/>
								</div>
								<div>
									<label className={labelCls}>To</label>
									<input
										type="date"
										value={customTo}
										onChange={(e) => setCustomTo(e.target.value)}
										min={customFrom || undefined}
										max={todayIso()}
										className={inputCls}
									/>
								</div>
							</div>
							<p className="text-[11px] text-[var(--text-muted)]">
								Max range: {MAX_RANGE_DAYS} days
							</p>
							{customError && (
								<p className="text-xs text-rose-400 font-semibold">
									{customError}
								</p>
							)}
						</div>
					)}

					{errorMsg && (
						<p className="text-xs text-rose-400 font-semibold">{errorMsg}</p>
					)}

					<div className="flex gap-3 flex-wrap pt-1">
						<button
							onClick={apply}
							disabled={loading || (rangeMode === 'custom' && !!customError)}
							className="px-5 py-2.5 bg-linear-to-r from-cyan-500 to-emerald-500 text-slate-950 font-semibold rounded-lg hover:shadow-[0_0_30px_-5px_rgba(34,211,238,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
							{loading ? 'Loading…' : 'Apply →'}
						</button>
						{rows && rows.length > 0 && (
							<button
								onClick={downloadCsv}
								className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-400/30 hover:bg-emerald-500/20 text-emerald-300 font-semibold rounded-lg transition-colors">
								Download CSV
							</button>
						)}
					</div>
				</div>

				{loading && <LoadingSpinner />}

				{rows && rows.length === 0 && !loading && (
					<ErrorMessage message="No status data in selected range" />
				)}

				{!loading && emptyMessage && (
					<div className="card-surface rounded-xl p-8 text-center">
						<div className="text-3xl mb-3">📊</div>
						<p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
							No utilization data yet.
						</p>
						<p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
							{emptyMessage}
						</p>
						<p className="text-[11px] text-[var(--text-muted)] mt-2">
							Status history is recorded every 30 seconds while the
							dashboard is open. Check back after monitoring for a while.
						</p>
					</div>
				)}

				{rows && rows.length > 0 && !emptyMessage && summary && (
					<>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
							<StatTile
								label="Avg Online %"
								value={`${summary.avgOnline}%`}
								accent="emerald"
							/>
							<StatTile
								label="Total Offline (min)"
								value={String(summary.totalOffline)}
								accent="rose"
							/>
							<StatTile
								label="Most Offline"
								value={summary.mostOffline.pondName}
								sub={`${summary.mostOffline.breakdown.offline.minutes} min`}
								accent="amber"
							/>
							<StatTile
								label="Most Maintenance"
								value={summary.mostMaint.pondName}
								sub={`${summary.mostMaint.breakdown.maintenance.minutes} min`}
								accent="cyan"
							/>
						</div>

						<div className="card-surface rounded-xl p-6">
							<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-[var(--text-secondary)] mb-4">
								Per Pond Breakdown
							</h2>
							<div className="space-y-4">
								{rows.map((r) => (
									<UtilizationBar key={r.pondId} row={r} />
								))}
							</div>
							<Legend />
						</div>

						<div className="card-surface rounded-xl overflow-hidden">
							<div className="px-6 py-4 border-b border-[var(--border)]">
								<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-[var(--text-secondary)]">
									Table
								</h2>
							</div>
							<div className="overflow-x-auto">
								<table className="w-full">
									<thead className="bg-[var(--input-bg)]">
										<tr>
											<Th>Pond</Th>
											<Th>Online %</Th>
											<Th>Stale %</Th>
											<Th>Offline %</Th>
											<Th>Maint %</Th>
											<Th>Tracked (min)</Th>
										</tr>
									</thead>
									<tbody className="divide-y divide-[var(--border)]">
										{rows.map((r) => (
											<tr key={r.pondId} className="hover:bg-[var(--row-hover)]">
												<td className="px-6 py-3 text-sm text-[var(--text-primary)] font-semibold">
													{r.pondName}
												</td>
												<td className="px-6 py-3 text-sm font-mono text-emerald-300">
													{r.breakdown.online.percent}%
												</td>
												<td className="px-6 py-3 text-sm font-mono text-amber-300">
													{r.breakdown.stale.percent}%
												</td>
												<td className="px-6 py-3 text-sm font-mono text-rose-300">
													{r.breakdown.offline.percent}%
												</td>
												<td className="px-6 py-3 text-sm font-mono text-blue-300">
													{r.breakdown.maintenance.percent}%
												</td>
												<td className="px-6 py-3 text-sm font-mono text-[var(--text-secondary)]">
													{r.totalMinutes}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					</>
				)}
			</div>
		</MainLayout>
	);
}

function UtilizationBar({ row }: { row: UtilRow }) {
	const order: Status[] = ['online', 'stale', 'offline', 'maintenance'];
	return (
		<div>
			<div className="flex items-center justify-between mb-1.5">
				<p className="text-sm font-semibold text-[var(--text-primary)]">
					{row.pondName}
				</p>
				<p className={`text-xs font-mono ${STATUS_TEXT.online}`}>
					{row.breakdown.online.percent}% online
				</p>
			</div>
			<div className="flex w-full h-4 rounded-full overflow-hidden bg-[var(--input-bg)] border border-[var(--border)]">
				{order.map((s) => {
					const pct = row.breakdown[s].percent;
					if (pct <= 0) return null;
					return (
						<div
							key={s}
							className={`${STATUS_BAR_BG[s]} h-full`}
							style={{ width: `${pct}%` }}
							title={`${STATUS_LABEL[s]} ${pct}% · ${row.breakdown[s].minutes} min`}
						/>
					);
				})}
			</div>
		</div>
	);
}

function Legend() {
	const items: Status[] = ['online', 'stale', 'offline', 'maintenance'];
	return (
		<div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-[var(--border)]">
			{items.map((s) => (
				<div key={s} className="flex items-center gap-2">
					<span className={`inline-block w-3 h-3 rounded ${STATUS_BAR_BG[s]}`} />
					<span className="text-xs text-[var(--text-secondary)] font-semibold">
						{STATUS_LABEL[s]}
					</span>
				</div>
			))}
		</div>
	);
}

function StatTile({
	label,
	value,
	sub,
	accent,
}: {
	label: string;
	value: string;
	sub?: string;
	accent: 'cyan' | 'emerald' | 'rose' | 'amber';
}) {
	const text = {
		cyan: 'text-cyan-300',
		emerald: 'text-emerald-300',
		rose: 'text-rose-300',
		amber: 'text-amber-300',
	}[accent];
	return (
		<div className="card-surface rounded-xl p-5">
			<p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-[var(--text-secondary)]">
				{label}
			</p>
			<p className={`mt-2 text-2xl font-bold truncate ${text}`}>{value}</p>
			{sub && (
				<p className="mt-1 text-[10px] text-[var(--text-muted)] truncate">
					{sub}
				</p>
			)}
		</div>
	);
}

function Th({ children }: { children: React.ReactNode }) {
	return (
		<th className="px-6 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-semibold text-[var(--text-secondary)]">
			{children}
		</th>
	);
}
