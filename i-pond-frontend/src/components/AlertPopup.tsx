'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
	useActiveAlerts,
	acknowledgeAlert,
	acknowledgeAllAlerts,
	refreshAlertViews,
	loadIgnoredAlertIds,
	saveIgnoredAlertIds,
	type ActiveAlert,
} from '@/hooks/useAlerts';
import { fmt } from '@/lib/pondStatus';

const SENSOR_LABELS: Record<string, { name: string; unit: string }> = {
	temperature: { name: 'Temperature', unit: '°C' },
	ph: { name: 'pH', unit: 'pH' },
	salinity: { name: 'Salinity', unit: 'ppt' },
	dissolved_oxygen: { name: 'Dissolved Oxygen', unit: 'mg/L' },
	connectivity: { name: 'Connectivity', unit: '' },
};

/**
 * Two ways out of the popup, and they mean different things:
 *
 *   Acknowledge — server-side. The alert is marked handled, leaves the badge
 *                 count, and appears as "acknowledged" in /notifications.
 *   Ignore      — this browser only. The alert stays OPEN on the server, still
 *                 counts in the bell badge, still shows as active in
 *                 /notifications where it can be acknowledged later. It just
 *                 stops popping up here. A new alert still pops.
 */
export default function AlertPopup() {
	const { alerts } = useActiveAlerts();
	const [mounted, setMounted] = useState(false);
	const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
	const [bulkBusy, setBulkBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setIgnoredIds(loadIgnoredAlertIds());
		setMounted(true);
	}, []);

	// Prune ignored ids that are no longer open, so the stored set never grows
	// unbounded and a re-triggered alert (new id) is not accidentally hidden.
	useEffect(() => {
		if (!alerts) return;
		const live = new Set(alerts.map((a) => a.id));
		setIgnoredIds((prev) => {
			const next = new Set([...prev].filter((id) => live.has(id)));
			if (next.size !== prev.size) saveIgnoredAlertIds(next);
			return next;
		});
	}, [alerts]);

	if (!mounted) return null;

	const visible: ActiveAlert[] = alerts?.filter((a) => !ignoredIds.has(a.id)) ?? [];
	if (visible.length === 0) return null;

	function ignore(ids: string[]) {
		setIgnoredIds((prev) => {
			const next = new Set(prev);
			for (const id of ids) next.add(id);
			saveIgnoredAlertIds(next);
			return next;
		});
	}

	async function onAck(id: string) {
		setBusyIds((s) => new Set(s).add(id));
		setError(null);
		try {
			await acknowledgeAlert(id);
			await refreshAlertViews();
		} catch (err) {
			console.error('ack_failed', err);
			setError('Could not acknowledge — the server rejected it. Try again, or check the server log.');
		} finally {
			setBusyIds((s) => {
				const n = new Set(s);
				n.delete(id);
				return n;
			});
		}
	}

	async function onAckAll() {
		setBulkBusy(true);
		setError(null);
		try {
			await acknowledgeAllAlerts();
			await refreshAlertViews();
		} catch (err) {
			console.error('ack_all_failed', err);
			setError('Could not acknowledge — the server rejected it. Try again, or check the server log.');
		} finally {
			setBulkBusy(false);
		}
	}

	function onIgnoreAll() {
		ignore(visible.map((a) => a.id));
	}

	return createPortal(
		<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
			<div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-rose-500/40 bg-[rgba(15,23,42,0.96)] shadow-[0_0_40px_-10px_rgba(244,63,94,0.5)]">
				<div className="px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[rgba(15,23,42,0.96)] backdrop-blur">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2 min-w-0">
							<span className="text-xl">⚠️</span>
							<h2 className="font-bold text-rose-200 tracking-tight truncate">
								Sensor Alert{visible.length > 1 ? 's' : ''}
							</h2>
							<span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold shrink-0">
								{visible.length}
							</span>
						</div>
						<div className="flex items-center gap-2 shrink-0">
							<button
								type="button"
								onClick={onIgnoreAll}
								disabled={bulkBusy}
								title="Hide these on this device. They stay open in Notifications."
								className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-300 bg-white/5 hover:bg-white/10 border border-[var(--border)] transition-colors disabled:opacity-50">
								Ignore all
							</button>
							<button
								type="button"
								onClick={onAckAll}
								disabled={bulkBusy}
								title="Mark every alert as handled."
								className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 transition-colors disabled:opacity-50">
								{bulkBusy ? 'Acknowledging…' : 'Acknowledge all'}
							</button>
						</div>
					</div>
					<p className="mt-2 text-[10px] text-slate-500 leading-snug">
						<span className="text-slate-400">Ignore</span> hides an alert on this device only — it stays
						active in Notifications. <span className="text-slate-400">Acknowledge</span> marks it handled.
					</p>
					{error && (
						<p className="mt-2 text-[11px] text-rose-300 leading-snug" role="alert">
							{error}
						</p>
					)}
				</div>
				<div className="p-4 space-y-3">
					{visible.map((a) => {
						const meta = SENSOR_LABELS[a.sensor] ?? {
							name: a.sensor,
							unit: '',
						};
						const isConnectivity = a.sensor === 'connectivity';
						const busy = busyIds.has(a.id) || bulkBusy;
						return (
							<div
								key={a.id}
								className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
								<p className="font-semibold text-white">
									⚠️ {a.pondName} — {isConnectivity ? 'No Data Received' : `${meta.name} Alert`}
								</p>
								{isConnectivity ? (
									<p className="text-sm text-slate-300 mt-1">
										No data received for{' '}
										{a.lastValue < 0
											? 'an unknown duration'
											: a.lastValue < 60
												? `${Math.round(a.lastValue)} minutes`
												: a.lastValue < 1440
													? `${(a.lastValue / 60).toFixed(1)} hours`
													: `${(a.lastValue / 1440).toFixed(1)} days`}
										. Check the gateway.
									</p>
								) : (
									<>
										<p className="text-sm text-slate-300 mt-1">
											{a.consecutiveCount} consecutive readings out of range (~1h 45m of abnormal data)
										</p>
										<p className="text-sm text-slate-400 mt-1 text-mono">
											Current: {fmt(a.lastValue)}
											{meta.unit} | Optimal: {fmt(a.optimalMin)}–{fmt(a.optimalMax)}
											{meta.unit}
										</p>
									</>
								)}
								<p className="text-[10px] text-slate-500 mt-1">
									Triggered {new Date(a.triggeredAt).toLocaleString()}
								</p>
								<div className="mt-3 flex gap-2">
									<button
										type="button"
										onClick={() => ignore([a.id])}
										disabled={busy}
										className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--border)] text-slate-300 text-sm font-semibold transition-colors disabled:opacity-50">
										Ignore
									</button>
									<button
										type="button"
										onClick={() => onAck(a.id)}
										disabled={busy}
										className="flex-[2] px-4 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 text-sm font-semibold transition-colors disabled:opacity-50">
										{busyIds.has(a.id) ? 'Acknowledging…' : 'Acknowledge'}
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>,
		document.body,
	);
}
