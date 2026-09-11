'use client';

import { useState } from 'react';
import useSWR from 'swr';

type SyncStatusPayload = {
	lastSyncAt: string | null;
	pendingCount: number;
	online: boolean;
	serverReachable: boolean;
	configured: boolean;
};

type TriggerResult = {
	ok: boolean;
	reason: string;
	synced: number;
	pending: number;
	message: string;
};

async function fetcher(url: string): Promise<SyncStatusPayload> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return (await res.json()) as SyncStatusPayload;
}

function relative(iso: string | null): string {
	if (!iso) return 'never';
	const ms = Date.now() - new Date(iso).getTime();
	if (!Number.isFinite(ms)) return 'never';
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Cloud sync indicator plus a manual trigger. Lives in the sidebar footer. */
export default function SyncStatus() {
	const { data, mutate } = useSWR<SyncStatusPayload>('/api/sync/status', fetcher, {
		refreshInterval: 60_000,
		revalidateOnFocus: false,
	});
	const [busy, setBusy] = useState(false);
	const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

	async function onSync() {
		setBusy(true);
		setToast(null);
		try {
			const res = await fetch('/api/sync/trigger', { method: 'POST' });
			const body = (await res.json()) as TriggerResult;
			setToast({ text: body.message, ok: body.ok });
			await mutate();
		} catch {
			setToast({ text: 'Sync request failed', ok: false });
		} finally {
			setBusy(false);
			setTimeout(() => setToast(null), 6000);
		}
	}

	if (!data) {
		return (
			<p className="text-[11px] text-slate-500">Checking sync…</p>
		);
	}

	const { online, serverReachable, pendingCount, lastSyncAt, configured } = data;

	let dotCls = 'bg-slate-500';
	let label: string;

	if (!configured) {
		label = 'Cloud sync not configured';
	} else if (!online) {
		dotCls = 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.7)]';
		label = 'Not synced — no internet';
	} else if (!serverReachable) {
		dotCls = 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]';
		label = 'Cloud server unreachable';
	} else if (pendingCount > 0) {
		dotCls = 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]';
		label = `Last synced: ${relative(lastSyncAt)}`;
	} else {
		dotCls = 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]';
		label = `Last synced: ${relative(lastSyncAt)}`;
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
				<span className="text-[11px] text-slate-300 truncate" title={label}>
					{label}
				</span>
			</div>

			{configured && pendingCount > 0 && (
				<p className="text-[10px] text-slate-500">
					{pendingCount.toLocaleString()} reading
					{pendingCount === 1 ? '' : 's'} pending
				</p>
			)}

			<button
				type="button"
				onClick={onSync}
				disabled={busy || !configured}
				className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-cyan-500/15 hover:text-cyan-200 hover:border-cyan-400/40 border border-[var(--border)] text-[12px] font-medium text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
				{busy ? (
					<>
						<span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-cyan-300/30 border-t-cyan-300 animate-spin" />
						Syncing…
					</>
				) : (
					<>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="w-3.5 h-3.5">
							<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.6-4.2" />
							<path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.6 4.2" />
							<polyline points="21 3 21 8 16 8" />
							<polyline points="3 21 3 16 8 16" />
						</svg>
						Sync to Cloud
					</>
				)}
			</button>

			{toast && (
				<p
					className={`text-[10px] leading-snug ${toast.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
					{toast.text}
				</p>
			)}
		</div>
	);
}
