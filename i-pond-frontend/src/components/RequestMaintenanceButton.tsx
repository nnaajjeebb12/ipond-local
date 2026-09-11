'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';

type MaintenanceRequest = {
	id: string;
	pondId: number;
	status: 'pending' | 'acknowledged' | 'resolved';
};

async function fetcher(url: string): Promise<MaintenanceRequest[]> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) return [];
	return (await res.json()) as MaintenanceRequest[];
}

export default function RequestMaintenanceButton({
	pondId,
	pondName,
}: {
	pondId: number;
	pondName: string;
}) {
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [mounted, setMounted] = useState(false);

	const { data: all, mutate } = useSWR<MaintenanceRequest[]>(
		'/api/maintenance',
		fetcher,
		{ refreshInterval: 60_000, revalidateOnFocus: false },
	);

	useEffect(() => setMounted(true), []);

	const myActive = all?.find(
		(r) =>
			r.pondId === pondId &&
			(r.status === 'pending' || r.status === 'acknowledged'),
	);

	const badge = myActive
		? myActive.status === 'pending'
			? { label: '🟡 Pending', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30' }
			: { label: '🔵 In Progress', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' }
		: null;

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!message.trim()) return;
		setSubmitting(true);
		try {
			const res = await fetch('/api/maintenance', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pondId, message: message.trim() }),
			});
			if (!res.ok) throw new Error(`status ${res.status}`);
			setOpen(false);
			setMessage('');
			setToast('Maintenance request sent');
			setTimeout(() => setToast(null), 3000);
			await mutate();
		} catch (err) {
			console.error('maintenance_submit_failed', err);
			setToast('Failed to send request');
			setTimeout(() => setToast(null), 3000);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<>
			<div className="flex items-center gap-2 flex-wrap">
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						e.preventDefault();
						setOpen(true);
					}}
					className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-400/30 transition-colors">
					Request Maintenance
				</button>
				{badge && (
					<span
						className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${badge.cls}`}>
						{badge.label}
					</span>
				)}
			</div>

			{mounted && open &&
				createPortal(
					<div
						className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
						onClick={() => setOpen(false)}>
						<form
							onSubmit={submit}
							onClick={(e) => e.stopPropagation()}
							className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.96)] shadow-2xl">
							<div className="px-5 py-4 border-b border-[var(--border)]">
								<h2 className="font-bold text-white">Request Maintenance</h2>
								<p className="text-[11px] text-slate-400 mt-0.5">{pondName}</p>
							</div>
							<div className="p-5 space-y-3">
								<label className="block text-[11px] uppercase tracking-wider font-semibold text-slate-400">
									Message
								</label>
								<textarea
									value={message}
									onChange={(e) => setMessage(e.target.value)}
									placeholder="Describe the issue…"
									rows={4}
									required
									maxLength={2000}
									className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--border)] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50"
								/>
							</div>
							<div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
								<button
									type="button"
									onClick={() => setOpen(false)}
									className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors">
									Cancel
								</button>
								<button
									type="submit"
									disabled={submitting || !message.trim()}
									className="px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-sm font-semibold disabled:opacity-50 transition-colors">
									{submitting ? 'Sending…' : 'Submit'}
								</button>
							</div>
						</form>
					</div>,
					document.body,
				)}

			{mounted && toast &&
				createPortal(
					<div className="fixed bottom-6 right-6 z-[1200] px-4 py-2.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-sm font-semibold shadow-lg">
						{toast}
					</div>,
					document.body,
				)}
		</>
	);
}
