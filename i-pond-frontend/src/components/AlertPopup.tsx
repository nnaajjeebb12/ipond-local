'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useActiveAlerts, acknowledgeAlert, type ActiveAlert } from '@/hooks/useAlerts';
import { fmt } from '@/lib/pondStatus';

const SENSOR_LABELS: Record<string, { name: string; unit: string }> = {
	temperature: { name: 'Temperature', unit: '°C' },
	ph: { name: 'pH', unit: 'pH' },
	salinity: { name: 'Salinity', unit: 'ppt' },
	dissolved_oxygen: { name: 'Dissolved Oxygen', unit: 'mg/L' },
	connectivity: { name: 'Connectivity', unit: '' },
};

export default function AlertPopup() {
	const { alerts, mutate } = useActiveAlerts();
	const [mounted, setMounted] = useState(false);
	const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

	useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) return null;

	const visible: ActiveAlert[] =
		alerts?.filter((a) => !dismissedIds.has(a.id)) ?? [];
	if (visible.length === 0) return null;

	async function onAck(id: string) {
		setBusyIds((s) => new Set(s).add(id));
		try {
			await acknowledgeAlert(id);
			setDismissedIds((s) => new Set(s).add(id));
			await mutate();
		} catch (err) {
			console.error('ack_failed', err);
		} finally {
			setBusyIds((s) => {
				const n = new Set(s);
				n.delete(id);
				return n;
			});
		}
	}

	return createPortal(
		<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
			<div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-rose-500/40 bg-[rgba(15,23,42,0.96)] shadow-[0_0_40px_-10px_rgba(244,63,94,0.5)]">
				<div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between sticky top-0 bg-[rgba(15,23,42,0.96)] backdrop-blur">
					<div className="flex items-center gap-2">
						<span className="text-xl">⚠️</span>
						<h2 className="font-bold text-rose-200 tracking-tight">
							Sensor Alert{visible.length > 1 ? 's' : ''}
						</h2>
						<span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold">
							{visible.length}
						</span>
					</div>
				</div>
				<div className="p-4 space-y-3">
					{visible.map((a) => {
						const meta = SENSOR_LABELS[a.sensor] ?? {
							name: a.sensor,
							unit: '',
						};
						const isConnectivity = a.sensor === 'connectivity';
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
										. Check ESP32 device.
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
								<button
									onClick={() => onAck(a.id)}
									disabled={busyIds.has(a.id)}
									className="mt-3 w-full px-4 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 text-sm font-semibold transition-colors disabled:opacity-50">
									{busyIds.has(a.id) ? 'Acknowledging…' : 'Acknowledge'}
								</button>
							</div>
						);
					})}
				</div>
			</div>
		</div>,
		document.body,
	);
}
