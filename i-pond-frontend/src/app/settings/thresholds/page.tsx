'use client';

import { ErrorMessage, LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import { usePonds } from '@/hooks/useApi';
import { useThresholds } from '@/hooks/useThresholds';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

const SENSORS = [
	{ key: 'temperature', label: 'Temperature', unit: '°C', icon: '🌡️' },
	{ key: 'ph', label: 'pH Level', unit: 'pH', icon: '⚗️' },
	{ key: 'salinity', label: 'Salinity', unit: 'ppt', icon: '🧂' },
	{ key: 'dissolved_oxygen', label: 'Dissolved Oxygen', unit: 'mg/L', icon: '💨' },
];

type AuditEntry = {
	id: string;
	old_min: number | null;
	old_max: number | null;
	new_min: number;
	new_max: number;
	old_value: number | null;
	new_value: number | null;
	changed_at: string;
	changed_by_name: string | null;
};

async function jsonFetcher<T>(url: string): Promise<T> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return (await res.json()) as T;
}

function HistoryPanel({ pondId, sensor }: { pondId: string; sensor: string }) {
	const url = `/api/thresholds/history?pond=${encodeURIComponent(pondId)}&sensor=${sensor}`;
	const { data, isLoading } = useSWR<AuditEntry[]>(url, jsonFetcher);

	if (isLoading) return <p className="text-xs text-slate-500">Loading history…</p>;
	if (!data || data.length === 0)
		return <p className="text-xs text-slate-500 italic">No changes recorded.</p>;

	return (
		<div className="space-y-2">
			{data.map((e) => (
				<div
					key={e.id}
					className="rounded-lg bg-white/3 border border-white/5 px-3 py-2 text-xs">
					<div className="flex items-center justify-between gap-2 mb-1">
						<span className="text-slate-400 font-mono">
							{new Date(e.changed_at).toLocaleString()}
						</span>
						<span className="text-violet-300 font-medium">
							{e.changed_by_name ?? 'unknown'}
						</span>
					</div>
					<div className="text-slate-300 font-mono">
						min: <span className="text-slate-500">{e.old_min ?? '—'}</span>{' '}
						<span className="text-cyan-400">→</span>{' '}
						<span className="text-cyan-300 font-bold">{e.new_min}</span>
						{'  '}·{'  '}
						max: <span className="text-slate-500">{e.old_max ?? '—'}</span>{' '}
						<span className="text-cyan-400">→</span>{' '}
						<span className="text-cyan-300 font-bold">{e.new_max}</span>
						{'  '}·{'  '}
						opt: <span className="text-slate-500">{e.old_value ?? '—'}</span>{' '}
						<span className="text-cyan-400">→</span>{' '}
						<span className="text-cyan-300 font-bold">{e.new_value ?? '—'}</span>
					</div>
				</div>
			))}
		</div>
	);
}

export default function ThresholdSettingsPage() {
	const { ponds, isLoading: pondsLoading } = usePonds();

	const [scopeMode, setScopeMode] = useState<'single' | 'multi' | 'all'>('single');
	const [singlePond, setSinglePond] = useState<string>('');
	const [multiPonds, setMultiPonds] = useState<Set<string>>(new Set());

	const editorPondId = useMemo(() => {
		if (scopeMode === 'single') return singlePond || null;
		const first = ponds?.[0]?.id ?? null;
		return first;
	}, [scopeMode, singlePond, ponds]);

	const { thresholds, lookup, mutate } = useThresholds(editorPondId);

	const [draft, setDraft] = useState<
		Record<string, { min: string; max: string; value: string }>
	>({});
	const [openHistory, setOpenHistory] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

	useEffect(() => {
		if (ponds && ponds.length > 0 && !singlePond) {
			setSinglePond(ponds[0].id);
		}
	}, [ponds, singlePond]);

	useEffect(() => {
		if (!thresholds) return;
		const next: Record<string, { min: string; max: string; value: string }> = {};
		for (const t of thresholds) {
			next[t.sensor] = {
				min: String(t.optimal_min),
				max: String(t.optimal_max),
				value: t.optimal_value == null ? '' : String(t.optimal_value),
			};
		}
		setDraft(next);
	}, [thresholds]);

	const targetPondIds: string[] =
		scopeMode === 'single'
			? singlePond
				? [singlePond]
				: []
			: scopeMode === 'multi'
				? Array.from(multiPonds)
				: (ponds?.map((p) => p.id) ?? []);

	async function save(sensor: string) {
		const d = draft[sensor];
		if (!d) return;
		const min = Number(d.min);
		const max = Number(d.max);
		if (!Number.isFinite(min) || !Number.isFinite(max)) {
			setToast({ text: 'Invalid number.', ok: false });
			return;
		}
		if (min >= max) {
			setToast({ text: 'min must be less than max.', ok: false });
			return;
		}

		let optimalValue: number | null = null;
		if (d.value.trim() !== '') {
			const v = Number(d.value);
			if (!Number.isFinite(v)) {
				setToast({ text: 'Optimal value must be numeric.', ok: false });
				return;
			}
			if (v < min || v > max) {
				setToast({ text: 'Optimal value must be between min and max.', ok: false });
				return;
			}
			optimalValue = v;
		}

		if (targetPondIds.length === 0) {
			setToast({ text: 'No pond selected.', ok: false });
			return;
		}

		setBusy(true);
		try {
			const res = await fetch('/api/thresholds', {
				method: 'PATCH',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ponds: targetPondIds.map((p) => Number(p)),
					sensor,
					optimal_min: min,
					optimal_max: max,
					optimal_value: optimalValue,
				}),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				setToast({
					text: `Save failed: ${body?.error ?? res.status}`,
					ok: false,
				});
				return;
			}
			setToast({ text: `Updated ${targetPondIds.length} pond(s).`, ok: true });
			mutate();
		} catch (err) {
			setToast({
				text: err instanceof Error ? err.message : 'Save failed.',
				ok: false,
			});
		} finally {
			setBusy(false);
			setTimeout(() => setToast(null), 4000);
		}
	}

	const inputCls =
		'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 text-slate-100 font-mono transition-colors';

	const SCOPE_LABELS: Record<'single' | 'multi' | 'all', string> = {
		single: 'Single Pond',
		multi: 'Select Multiple',
		all: 'All Ponds',
	};

	return (
		<MainLayout>
			<div className="space-y-8 max-w-4xl">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" className="w-4 h-4">
							<line x1="4" y1="6" x2="14" y2="6" />
							<circle cx="17" cy="6" r="2.5" />
							<line x1="4" y1="12" x2="8" y2="12" />
							<circle cx="11" cy="12" r="2.5" />
							<line x1="14" y1="12" x2="20" y2="12" />
						</svg>
						<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-cyan-300">
							Configuration
						</span>
					</div>
					<h1 className="text-4xl font-bold text-white tracking-tight">
						Optimal Range Settings
					</h1>
					<p className="text-slate-400 mt-1.5 text-sm">
						Configure per-pond, per-sensor thresholds. All changes are audited.
					</p>
				</div>

				{toast && (
					<div
						className={`p-4 rounded-xl border backdrop-blur-sm ${
							toast.ok
								? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
								: 'bg-rose-500/10 border-rose-400/30 text-rose-300'
						}`}>
						{toast.text}
					</div>
				)}

				<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-6 space-y-4">
					<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
						Apply To
					</h2>

					<div className="inline-flex p-1 rounded-lg border border-white/10 bg-white/3">
						{(['single', 'multi', 'all'] as const).map((m) => (
							<button
								key={m}
								onClick={() => setScopeMode(m)}
								className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
									scopeMode === m
										? 'bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_-5px_rgba(34,211,238,0.6)]'
										: 'text-slate-400 hover:text-slate-200'
								}`}>
								{SCOPE_LABELS[m]}
							</button>
						))}
					</div>

					{pondsLoading ? (
						<LoadingSpinner />
					) : !ponds || ponds.length === 0 ? (
						<ErrorMessage message="No ponds available." />
					) : scopeMode === 'single' ? (
						<select
							value={singlePond}
							onChange={(e) => setSinglePond(e.target.value)}
							className={`md:w-1/2 ${inputCls}`}>
							{ponds.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name} — {p.location}
								</option>
							))}
						</select>
					) : scopeMode === 'multi' ? (
						<div className="grid grid-cols-2 md:grid-cols-3 gap-1 max-h-60 overflow-y-auto rounded-lg bg-white/3 border border-white/10 p-3">
							{ponds.map((p) => {
								const checked = multiPonds.has(p.id);
								return (
									<label
										key={p.id}
										className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer">
										<input
											type="checkbox"
											checked={checked}
											onChange={() => {
												const next = new Set(multiPonds);
												if (checked) next.delete(p.id);
												else next.add(p.id);
												setMultiPonds(next);
											}}
											className="w-4 h-4 accent-cyan-500"
										/>
										<span className="text-slate-200 text-sm">{p.name}</span>
									</label>
								);
							})}
						</div>
					) : (
						<p className="text-sm text-slate-400">
							Will apply to{' '}
							<span className="text-cyan-300 font-bold font-mono">
								{ponds.length}
							</span>{' '}
							pond(s).
						</p>
					)}
				</div>

				<div className="space-y-3">
					{SENSORS.map((s) => {
						const current = lookup(s.key);
						const d = draft[s.key] ?? { min: '', max: '', value: '' };
						const isOpen = openHistory === s.key;
						return (
							<div
								key={s.key}
								className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-6 space-y-4">
								<div className="flex justify-between items-center flex-wrap gap-3">
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center text-xl">
											{s.icon}
										</div>
										<div>
											<h3 className="text-base font-semibold text-white">
												{s.label}
											</h3>
											<p className="text-[11px] text-slate-500 font-mono uppercase tracking-wider">
												unit · {s.unit}
											</p>
										</div>
									</div>
									{current && (
										<div className="text-right">
											<p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
												Current
											</p>
											<p className="text-mono text-sm text-cyan-300 font-bold">
												{current.min} – {current.max}
												{current.value != null && (
													<span className="text-slate-400 font-normal">
														{' '}· opt {current.value}
													</span>
												)}
											</p>
										</div>
									)}
								</div>

								<div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
									<div>
										<label className="block text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-1.5">
											Optimal Min
										</label>
										<input
											type="number"
											step="0.01"
											value={d.min}
											onChange={(e) =>
												setDraft({
													...draft,
													[s.key]: { ...d, min: e.target.value },
												})
											}
											className={inputCls}
										/>
									</div>
									<div>
										<label className="block text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-1.5">
											Optimal Value
											<span className="ml-1 normal-case tracking-normal text-slate-500 font-normal">
												(optional)
											</span>
										</label>
										<input
											type="number"
											step="0.01"
											value={d.value}
											placeholder="—"
											onChange={(e) =>
												setDraft({
													...draft,
													[s.key]: { ...d, value: e.target.value },
												})
											}
											className={inputCls}
										/>
									</div>
									<div>
										<label className="block text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-1.5">
											Optimal Max
										</label>
										<input
											type="number"
											step="0.01"
											value={d.max}
											onChange={(e) =>
												setDraft({
													...draft,
													[s.key]: { ...d, max: e.target.value },
												})
											}
											className={inputCls}
										/>
									</div>
									<button
										onClick={() => save(s.key)}
										disabled={busy || targetPondIds.length === 0}
										className="px-4 py-2 bg-linear-to-r from-cyan-500 to-emerald-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-slate-950 font-semibold rounded-lg hover:shadow-[0_0_25px_-5px_rgba(34,211,238,0.5)] disabled:shadow-none transition-all">
										Save
										{targetPondIds.length > 1 ? ` × ${targetPondIds.length}` : ''}
									</button>
								</div>

								<button
									onClick={() => setOpenHistory(isOpen ? null : s.key)}
									className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
									<svg
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
										<polyline points="9 18 15 12 9 6" />
									</svg>
									{isOpen ? 'Hide history' : 'Show history'}
								</button>

								{isOpen && editorPondId && (
									<div className="border-t border-white/5 pt-4">
										<HistoryPanel pondId={editorPondId} sensor={s.key} />
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</MainLayout>
	);
}
