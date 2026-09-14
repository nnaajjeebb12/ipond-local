'use client';

import { LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';

type LicenseStatus = {
	valid: boolean;
	client: string | null;
	expiresAt: string | null;
	daysLeft: number | null;
	reason: string;
};

type OwnerStatus = {
	ownerId: string | null;
	source: 'db' | 'env' | 'none';
	name: string | null;
	target: string;
	admin: boolean;
	online: boolean;
	serverReachable: boolean;
};

type PondRef = { pond_code: string; name: string };
type ConnectSummary = {
	owner: { id: string; name: string; email: string; role: string };
	ponds: {
		cloudCount: number;
		updated: PondRef[];
		created: PondRef[];
		localOnly: PondRef[];
		uncoded: { name: string }[];
	};
	note: string | null;
};

async function jsonFetcher<T>(url: string): Promise<T> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return (await res.json()) as T;
}

const LICENSE_REASON: Record<string, string> = {
	ok: 'Valid',
	missing: 'No license file found',
	malformed: 'License file is unreadable',
	bad_signature: 'License signature is invalid',
	serial_mismatch: 'License was issued for a different Pi',
	expired: 'Expired',
};

const cardCls =
	'rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-6 space-y-4';
const labelCls = 'text-[10px] uppercase tracking-wider text-slate-500 font-semibold';
const inputCls =
	'w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--border)] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50';

/* ------------------------------------------------------------------ */
/* License                                                             */
/* ------------------------------------------------------------------ */

function LicenseCard() {
	const { data, error } = useSWR<LicenseStatus>('/api/license', jsonFetcher, {
		refreshInterval: 60 * 60 * 1000,
		revalidateOnFocus: false,
	});

	if (error) return <div className={cardCls}><p className="text-sm text-rose-300">Could not read license status.</p></div>;
	if (!data) return <div className={cardCls}><LoadingSpinner /></div>;

	const days = data.daysLeft;
	const tone = !data.valid
		? 'text-rose-300'
		: days !== null && days <= 7
			? 'text-rose-300'
			: days !== null && days <= 30
				? 'text-amber-300'
				: 'text-emerald-300';
	const dot = !data.valid
		? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.7)]'
		: days !== null && days <= 30
			? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]'
			: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]';

	return (
		<div className={cardCls}>
			<div className="flex items-center justify-between flex-wrap gap-3">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center text-xl">
						🔑
					</div>
					<div>
						<h3 className="text-base font-semibold text-white">License</h3>
						<p className="text-[11px] text-slate-500">Checked every hour; the expiry block itself is enforced on every request.</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
					<span className={`text-sm font-semibold ${tone}`}>
						{LICENSE_REASON[data.reason] ?? data.reason}
					</span>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div>
					<p className={labelCls}>Licensed to</p>
					<p className="text-sm text-slate-100 mt-1">{data.client ?? '—'}</p>
				</div>
				<div>
					<p className={labelCls}>Days remaining</p>
					<p className={`text-2xl font-bold font-mono mt-1 ${tone}`}>
						{days === null ? '—' : days < 0 ? 0 : days}
					</p>
				</div>
				<div>
					<p className={labelCls}>Expires</p>
					<p className="text-sm text-slate-100 mt-1 font-mono">
						{data.expiresAt ? new Date(data.expiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}
					</p>
				</div>
			</div>

			{data.valid && days !== null && days <= 30 && (
				<p className="text-[11px] text-amber-300/90">
					Renewals: <a href="mailto:sales@soletronix.com" className="underline">sales@soletronix.com</a>
				</p>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Cloud owner                                                         */
/* ------------------------------------------------------------------ */

function AdminLogin({ onDone }: { onDone: () => void }) {
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const res = await fetch('/api/admin/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password }),
			});
			if (res.status === 401) {
				setError('Wrong username or password.');
				return;
			}
			if (!res.ok) {
				setError(`Login failed (server said ${res.status}).`);
				return;
			}
			setPassword('');
			onDone();
		} catch {
			setError('Could not reach the server.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={submit} className="rounded-lg bg-white/3 border border-white/10 p-4 space-y-3">
			<p className="text-sm text-slate-300">
				Changing the owner needs the local admin login. This is the appliance&apos;s own login, not a
				main-server account.
			</p>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<input
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					placeholder="Username"
					autoComplete="username"
					required
					className={inputCls}
				/>
				<input
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
					type="password"
					autoComplete="current-password"
					required
					className={inputCls}
				/>
			</div>
			{error && <p className="text-[11px] text-rose-300" role="alert">{error}</p>}
			<button
				type="submit"
				disabled={busy || !username || !password}
				className="px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-sm font-semibold disabled:opacity-50 transition-colors">
				{busy ? 'Signing in…' : 'Admin login'}
			</button>
		</form>
	);
}

function CloudConnect({ status, onDone }: { status: OwnerStatus; onDone: () => void }) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [summary, setSummary] = useState<ConnectSummary | null>(null);

	const blocked = !status.serverReachable
		? status.online
			? 'Main server unreachable right now — try again later.'
			: 'Requires internet connection to sign in to the main server.'
		: null;

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setSummary(null);
		try {
			const res = await fetch('/api/settings/cloud-connect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: email.trim(), password }),
			});
			const body = (await res.json().catch(() => ({}))) as Partial<ConnectSummary> & { message?: string; error?: string };
			if (!res.ok) {
				setError(body.message ?? `Could not connect (server said ${res.status}).`);
				return;
			}
			setPassword('');
			setSummary(body as ConnectSummary);
			onDone();
		} catch {
			setError('Could not reach the appliance server.');
		} finally {
			setBusy(false);
		}
	}

	const list = (items: PondRef[]) => items.map((p) => `${p.pond_code} (${p.name})`).join(', ');

	return (
		<form onSubmit={submit} className="space-y-3">
			<div>
				<p className="text-sm text-slate-200 font-semibold">Sign in with the site&apos;s seeme-db.com account</p>
				<p className="text-[11px] text-slate-500 mt-0.5">
					The account becomes this appliance&apos;s cloud owner and its ponds are imported here. Where a pond
					exists in both places, the main server&apos;s record is kept. The password is used once and not stored.
				</p>
			</div>
			{blocked && (
				<p className="text-[11px] text-amber-300/90 rounded-lg bg-amber-500/10 border border-amber-400/20 px-3 py-2">
					{blocked}
				</p>
			)}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<input
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Email on seeme-db.com"
					type="email"
					autoComplete="off"
					disabled={!!blocked}
					required
					className={`${inputCls} disabled:opacity-50`}
				/>
				<input
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
					type="password"
					autoComplete="off"
					disabled={!!blocked}
					required
					className={`${inputCls} disabled:opacity-50`}
				/>
			</div>
			{error && <p className="text-[11px] text-rose-300" role="alert">{error}</p>}
			{summary && (
				<div className="rounded-lg bg-emerald-500/10 border border-emerald-400/20 px-3 py-2 text-[11px] text-slate-200 space-y-1">
					<p className="text-emerald-300 font-semibold">
						Connected as {summary.owner.name} ({summary.owner.email})
					</p>
					{summary.note && <p className="text-amber-300/90">{summary.note}</p>}
					{summary.ponds.updated.length > 0 && (
						<p>Updated from the main server: {list(summary.ponds.updated)}</p>
					)}
					{summary.ponds.created.length > 0 && (
						<p>Added to this appliance: {list(summary.ponds.created)}</p>
					)}
					{summary.ponds.localOnly.length > 0 && (
						<p className="text-amber-300/90">
							Only on this appliance — create these under {summary.owner.name} on the main server or their readings will wait here: {list(summary.ponds.localOnly)}
						</p>
					)}
					{summary.ponds.uncoded.length > 0 && (
						<p className="text-slate-400">
							On the main server without a pond code (cannot sync): {summary.ponds.uncoded.map((p) => p.name).join(', ')}
						</p>
					)}
					{summary.owner.role !== 'admin' && summary.ponds.cloudCount === 0 && (
						<p className="text-amber-300/90">The account has no ponds on the main server yet.</p>
					)}
				</div>
			)}
			<button
				type="submit"
				disabled={busy || !!blocked || !email.trim() || !password}
				className="px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-sm font-semibold disabled:opacity-50 transition-colors">
				{busy ? 'Signing in…' : 'Sign in & import ponds'}
			</button>
		</form>
	);
}

function ManualOwner({ status, onDone }: { status: OwnerStatus; onDone: () => void }) {
	const [newId, setNewId] = useState('');
	const [newName, setNewName] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

	async function save(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setMsg(null);
		try {
			const res = await fetch('/api/settings/owner', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ownerId: newId.trim(), name: newName.trim() }),
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string; name?: string };
			if (!res.ok) {
				setMsg({
					text:
						body.error === 'admin_required'
							? 'Your admin session has expired — log in again.'
							: body.error === 'invalid_owner_id'
								? 'That is not a valid owner ID (expected a UUID like 1b4e28ba-2fa1-11d2-883f-0016d3cca427).'
								: body.error === 'name_required'
									? 'Enter the owner name as well.'
									: `Could not save (server said ${res.status}).`,
					ok: false,
				});
				if (body.error === 'admin_required') onDone();
				return;
			}
			setNewId('');
			setNewName('');
			setMsg({ text: `Saved. Readings now sync as ${body.name}.`, ok: true });
			onDone();
		} catch {
			setMsg({ text: 'Could not reach the server.', ok: false });
		} finally {
			setBusy(false);
		}
	}

	async function logout() {
		await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
		onDone();
	}

	if (!status.admin) return <AdminLogin onDone={onDone} />;

	return (
		<form onSubmit={save} className="space-y-3">
			<div className="flex items-center justify-between flex-wrap gap-2">
				<p className="text-sm text-slate-300">
					Signed in as <span className="text-violet-300 font-semibold">local admin</span>
				</p>
				<button type="button" onClick={logout} className="text-[11px] text-slate-400 hover:text-slate-200 underline">
					Log out
				</button>
			</div>
			<p className="text-[11px] text-amber-300/90 rounded-lg bg-amber-500/10 border border-amber-400/20 px-3 py-2">
				The ID cannot be checked against the main server — copy it exactly as Soletronix gave it. If it is
				wrong, sync stops with &ldquo;pond not found under this owner&rdquo; and nothing is lost; correct it
				here and sync resumes.
			</p>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label className="block text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
						Owner name
					</label>
					<input
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						placeholder={status.name ?? 'e.g. Bayside Aquafarm'}
						maxLength={120}
						className={inputCls}
					/>
				</div>
				<div>
					<label className="block text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
						Owner ID
					</label>
					<input
						value={newId}
						onChange={(e) => setNewId(e.target.value)}
						placeholder={status.ownerId ?? '00000000-0000-0000-0000-000000000000'}
						className={`${inputCls} font-mono`}
					/>
				</div>
			</div>
			{msg && (
				<p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`} role="alert">
					{msg.text}
				</p>
			)}
			<button
				type="submit"
				disabled={busy || !newId.trim() || !newName.trim()}
				className="px-4 py-2 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-200 text-sm font-semibold disabled:opacity-50 transition-colors">
				{busy ? 'Saving…' : 'Save owner'}
			</button>
		</form>
	);
}

function OwnerCard() {
	const { data, error, mutate } = useSWR<OwnerStatus>('/api/settings/owner', jsonFetcher, {
		refreshInterval: 60_000,
		revalidateOnFocus: false,
	});
	const [showManual, setShowManual] = useState(false);

	if (error) return <div className={cardCls}><p className="text-sm text-rose-300">Could not read owner status.</p></div>;
	if (!data) return <div className={cardCls}><LoadingSpinner /></div>;

	async function refresh() {
		await mutate();
		await globalMutate('/api/ponds');
		await globalMutate('/api/ponds/status');
	}

	return (
		<div className={cardCls}>
			<div className="flex items-center justify-between flex-wrap gap-3">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-400/20 flex items-center justify-center text-xl">
						☁️
					</div>
					<div>
						<h3 className="text-base font-semibold text-white">Cloud owner</h3>
						<p className="text-[11px] text-slate-500">
							Every reading this appliance syncs is attributed to this account on{' '}
							<span className="font-mono">{data.target.replace(/^https?:\/\//, '')}</span>.
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2 text-[11px]">
					<span
						className={`inline-block w-2 h-2 rounded-full ${
							data.serverReachable ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : data.online ? 'bg-amber-400' : 'bg-rose-400'
						}`}
					/>
					<span className="text-slate-300">
						{data.serverReachable ? 'Main server reachable' : data.online ? 'Main server unreachable' : 'No internet'}
					</span>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<p className={labelCls}>Owner</p>
					<p className="text-sm text-slate-100 mt-1">
						{data.name ?? <span className="text-slate-500 italic">not connected yet</span>}
					</p>
				</div>
				<div>
					<p className={labelCls}>Owner ID</p>
					<p className="text-sm text-slate-100 mt-1 font-mono break-all">
						{data.ownerId ?? <span className="text-rose-300">not set — sync is disabled</span>}
					</p>
					<p className="text-[11px] mt-1 text-slate-500">
						{data.source === 'db' ? 'Set on this page' : data.source === 'env' ? 'From SYNC_OWNER_ID in .env' : 'Sign in below to set it'}
					</p>
				</div>
			</div>

			<div className="border-t border-[var(--border)] pt-4 space-y-4">
				<CloudConnect status={data} onDone={refresh} />
				<div>
					<button
						type="button"
						onClick={() => setShowManual((v) => !v)}
						className="text-[11px] text-slate-400 hover:text-slate-200 underline">
						{showManual ? 'Hide manual entry' : 'No internet? Enter the owner manually (admin)'}
					</button>
					{showManual && (
						<div className="mt-3 rounded-lg bg-white/3 border border-white/10 p-4">
							<ManualOwner status={data} onDone={refresh} />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */

export default function AppliancePage() {
	return (
		<MainLayout>
			<div className="space-y-8 max-w-4xl">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" className="w-4 h-4">
							<rect x="3" y="4" width="18" height="12" rx="2" />
							<path d="M8 20h8M12 16v4" />
						</svg>
						<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-cyan-300">
							Configuration
						</span>
					</div>
					<h1 className="text-4xl font-bold text-white tracking-tight">Appliance</h1>
					<p className="text-slate-400 mt-1.5 text-sm">
						License status and the cloud owner this Pi reports to.
					</p>
				</div>

				<LicenseCard />
				<OwnerCard />
			</div>
		</MainLayout>
	);
}
