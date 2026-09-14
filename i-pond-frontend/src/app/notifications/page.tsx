'use client';

import { ErrorMessage, LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import { acknowledgeAlert, acknowledgeAllAlerts, refreshAlertViews } from '@/hooks/useAlerts';
import { useState } from 'react';
import useSWR from 'swr';

type AlertRow = {
	id: string;
	pondId: number;
	pondName: string;
	sensor: string;
	triggeredAt: string;
	consecutiveCount: number;
	lastValue: number;
	optimalMin: number;
	optimalMax: number;
	acknowledgedAt: string | null;
	acknowledgedByName: string | null;
	resolvedAt: string | null;
};

async function fetcher<T>(url: string): Promise<T> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return (await res.json()) as T;
}

const SENSOR_LABEL: Record<string, string> = {
	temperature: 'Temperature',
	ph: 'pH',
	salinity: 'Salinity',
	dissolved_oxygen: 'Dissolved Oxygen',
	connectivity: 'Connectivity',
};

function formatDuration(mins: number): string {
	if (mins < 0) return 'Never received';
	if (mins < 60) return `${Math.round(mins)}m ago`;
	if (mins < 1440) return `${(mins / 60).toFixed(1)}h ago`;
	return `${(mins / 1440).toFixed(1)}d ago`;
}

export default function NotificationsPage() {
	const [statusFilter, setStatusFilter] = useState<string>('all');
	const [pondFilter, setPondFilter] = useState<string>('all');

	const { data: alerts, error: aErr, isLoading: aLoading, mutate: aMutate } = useSWR<AlertRow[]>(
		'/api/alerts',
		fetcher,
		{ refreshInterval: 30_000 },
	);

	const ponds = Array.from(
		new Set(
			(alerts ?? []).map((a) => `${a.pondId}|${a.pondName}`).sort(),
		),
	).map((s) => {
		const [id, name] = s.split('|');
		return { id, name };
	});

	const [ackBusy, setAckBusy] = useState<Set<string>>(new Set());
	const [ackAllBusy, setAckAllBusy] = useState(false);
	const [ackError, setAckError] = useState<string | null>(null);
	const openAlertCount = (alerts ?? []).filter((a) => !a.acknowledgedAt && !a.resolvedAt).length;

	async function ackOne(id: string) {
		setAckBusy((s) => new Set(s).add(id));
		setAckError(null);
		try {
			await acknowledgeAlert(id);
			await Promise.all([aMutate(), refreshAlertViews()]);
		} catch (err) {
			console.error('ack_failed', err);
			setAckError('Could not acknowledge — the server rejected it.');
		} finally {
			setAckBusy((s) => {
				const n = new Set(s);
				n.delete(id);
				return n;
			});
		}
	}

	async function ackAll() {
		if (!window.confirm(`Acknowledge all ${openAlertCount} open alert${openAlertCount === 1 ? '' : 's'}?`)) return;
		setAckAllBusy(true);
		setAckError(null);
		try {
			await acknowledgeAllAlerts();
			await Promise.all([aMutate(), refreshAlertViews()]);
		} catch (err) {
			console.error('ack_all_failed', err);
			setAckError('Could not acknowledge — the server rejected it.');
		} finally {
			setAckAllBusy(false);
		}
	}

	const filteredAlerts = (alerts ?? []).filter((a) => {
		if (pondFilter !== 'all' && String(a.pondId) !== pondFilter) return false;
		if (statusFilter === 'active')
			return !a.acknowledgedAt && !a.resolvedAt;
		if (statusFilter === 'acknowledged')
			return !!a.acknowledgedAt && !a.resolvedAt;
		if (statusFilter === 'resolved') return !!a.resolvedAt;
		return true;
	});

	return (
		<MainLayout>
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold text-white tracking-tight">
						Notifications
					</h1>
					<p className="text-slate-400 mt-1 text-sm">
						Sensor alerts across all ponds
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<label className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
						Status
					</label>
					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="px-3 py-1.5 rounded-md bg-white/5 border border-[var(--border)] text-sm">
						<option value="all">All</option>
						<option value="active">Active</option>
						<option value="acknowledged">Acknowledged</option>
						<option value="resolved">Resolved</option>
					</select>
					<label className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 ml-2">
						Pond
					</label>
					<select
						value={pondFilter}
						onChange={(e) => setPondFilter(e.target.value)}
						className="px-3 py-1.5 rounded-md bg-white/5 border border-[var(--border)] text-sm">
						<option value="all">All</option>
						{ponds.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</div>

				{aLoading ? (
					<LoadingSpinner />
				) : aErr ? (
					<ErrorMessage message="Failed to load alerts" />
				) : (
					<div className="space-y-3">
					{ackError && (
						<p className="px-1 text-[12px] text-rose-300" role="alert">{ackError}</p>
					)}
					{openAlertCount > 0 && (
						<div className="flex items-center justify-between gap-3 px-1">
							<p className="text-[12px] text-slate-400">
								{openAlertCount} open alert{openAlertCount === 1 ? '' : 's'} awaiting acknowledgement
							</p>
							<button
								type="button"
								onClick={ackAll}
								disabled={ackAllBusy}
								className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 transition-colors disabled:opacity-50">
								{ackAllBusy ? 'Acknowledging…' : 'Acknowledge all'}
							</button>
						</div>
					)}
					<div className="overflow-x-auto rounded-xl border border-[var(--border)]">
						<table className="min-w-full text-sm">
							<thead className="bg-white/5 text-[10px] uppercase tracking-wider text-slate-400">
								<tr>
									<th className="text-left px-4 py-2.5">Triggered</th>
									<th className="text-left px-4 py-2.5">Pond</th>
									<th className="text-left px-4 py-2.5">Sensor</th>
									<th className="text-left px-4 py-2.5">Value</th>
									<th className="text-left px-4 py-2.5">Optimal</th>
									<th className="text-left px-4 py-2.5">Count</th>
									<th className="text-left px-4 py-2.5">Acknowledged By</th>
									<th className="text-left px-4 py-2.5">Resolved At</th>
									<th className="text-left px-4 py-2.5">Actions</th>
								</tr>
							</thead>
							<tbody>
								{filteredAlerts.length === 0 ? (
									<tr>
										<td
											colSpan={9}
											className="text-center py-8 text-slate-500">
											No alerts
										</td>
									</tr>
								) : (
									filteredAlerts.map((a) => (
										<tr
											key={a.id}
											className="border-t border-[var(--border)] hover:bg-white/3">
											<td className="px-4 py-3 text-mono text-[12px] text-slate-300 whitespace-nowrap">
												{new Date(a.triggeredAt).toLocaleString()}
											</td>
											<td className="px-4 py-3 font-semibold text-slate-100 whitespace-nowrap">
												{a.pondName}
											</td>
											<td className="px-4 py-3 text-slate-200 whitespace-nowrap">
												{SENSOR_LABEL[a.sensor] ?? a.sensor}
											</td>
											<td className="px-4 py-3 text-mono text-rose-300">
												{a.sensor === 'connectivity'
													? formatDuration(a.lastValue)
													: a.lastValue.toFixed(2)}
											</td>
											<td className="px-4 py-3 text-mono text-slate-400">
												{a.sensor === 'connectivity'
													? '—'
													: `${a.optimalMin}–${a.optimalMax}`}
											</td>
											<td className="px-4 py-3 text-mono">
												{a.consecutiveCount}
											</td>
											<td className="px-4 py-3 text-slate-300 whitespace-nowrap">
												{a.acknowledgedByName ?? '—'}
											</td>
											<td className="px-4 py-3 text-slate-300 whitespace-nowrap">
												{a.resolvedAt
													? new Date(a.resolvedAt).toLocaleString()
													: '—'}
											</td>
											<td className="px-4 py-3 whitespace-nowrap">
												{!a.acknowledgedAt && !a.resolvedAt ? (
													<button
														type="button"
														onClick={() => ackOne(a.id)}
														disabled={ackBusy.has(a.id) || ackAllBusy}
														className="px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-400/30 disabled:opacity-50">
														{ackBusy.has(a.id) ? '…' : 'Acknowledge'}
													</button>
												) : (
													<span className="text-[11px] text-slate-500">
														{a.resolvedAt ? 'Resolved' : 'Acknowledged'}
													</span>
												)}
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
					</div>
				)}
			</div>
		</MainLayout>
	);
}
