'use client';

import MainLayout from '@/components/MainLayout';
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import useSWR from 'swr';

const APP_TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || undefined;

type Status = 'all' | 'success' | 'error';

type PondOption = {
	id: string;
	pond_code: string | null;
	name: string;
};

type LogRow = {
	id: string;
	received_at: string;
	pond_id: number | null;
	pond_code: string | null;
	pond_name: string | null;
	raw_payload: unknown;
	temperature: number | null;
	ph: number | null;
	salinity: number | null;
	dissolved_oxygen: number | null;
	http_status: number;
	ip_address: string | null;
	error_message: string | null;
};

type LogsResponse = {
	logs: LogRow[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
};

const fetcher = async <T,>(url: string): Promise<T> => {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return (await res.json()) as T;
};

const inputCls =
	'w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 text-slate-100 transition-colors';
const labelCls =
	'block text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-1.5';
const pillBase =
	'px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors';
const pillIdle = 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10';
const pillActive = 'bg-cyan-400/15 border-cyan-400/40 text-cyan-200';

function formatTs(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString('en-PH', { timeZone: APP_TZ });
}

function fmtNum(v: number | null, digits = 2): string {
	if (v === null || v === undefined) return '—';
	return v.toFixed(digits);
}

function buildQuery(params: {
	page: number;
	limit: number;
	pondId: string;
	status: Status;
	from: string;
	to: string;
}): string {
	const sp = new URLSearchParams();
	sp.set('page', String(params.page));
	sp.set('limit', String(params.limit));
	if (params.pondId) sp.set('pond', params.pondId);
	if (params.status !== 'all') sp.set('status', params.status);
	if (params.from) sp.set('from', `${params.from}T00:00:00`);
	if (params.to) sp.set('to', `${params.to}T23:59:59`);
	return sp.toString();
}

export default function AdminLogsPage() {
	return (
		<MainLayout>
			<LogsView />
		</MainLayout>
	);
}

function LogsView() {
	const { data: ponds } = useSWR<PondOption[]>('/api/ponds', fetcher);

	const [pondId, setPondId] = useState<string>('');
	const [status, setStatus] = useState<Status>('all');
	const [from, setFrom] = useState<string>('');
	const [to, setTo] = useState<string>('');
	const [page, setPage] = useState<number>(1);
	const [limit] = useState<number>(50);
	const [jumpInput, setJumpInput] = useState<string>('');
	const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
	const seenIdsRef = useRef<Set<string>>(new Set());
	const lastQueryRef = useRef<string>('');

	const query = useMemo(
		() =>
			buildQuery({
				page,
				limit,
				pondId,
				status,
				from,
				to,
			}),
		[page, limit, pondId, status, from, to],
	);

	const { data, error, isLoading, mutate } = useSWR<LogsResponse>(
		`/api/admin/logs?${query}`,
		fetcher,
		{
			refreshInterval: autoRefresh ? 10000 : 0,
			revalidateOnFocus: false,
			keepPreviousData: true,
		},
	);

	useEffect(() => {
		if (!data) return;
		const queryChanged = lastQueryRef.current !== query;
		lastQueryRef.current = query;
		if (page !== 1 || queryChanged) {
			seenIdsRef.current = new Set(data.logs.map((l) => l.id));
			setTimeout(() => setHighlightIds(new Set()), 0);
			return;
		}
		const prev = seenIdsRef.current;
		const next = new Set<string>();
		const fresh: string[] = [];
		for (const l of data.logs) {
			next.add(l.id);
			if (prev.size > 0 && !prev.has(l.id)) fresh.push(l.id);
		}
		seenIdsRef.current = next;
		if (fresh.length === 0) return;
		setTimeout(() => setHighlightIds(new Set(fresh)), 0);
		const t = setTimeout(() => setHighlightIds(new Set()), 2500);
		return () => clearTimeout(t);
	}, [data, page, query]);

	const resetFilters = () => {
		setPondId('');
		setStatus('all');
		setFrom('');
		setTo('');
		setPage(1);
	};

	const onFilterChange = () => setPage(1);

	const toggleExpand = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const goPrev = () => setPage((p) => Math.max(1, p - 1));
	const goNext = () =>
		setPage((p) => Math.min(data?.totalPages ?? p, p + 1));

	const submitJump = () => {
		const n = parseInt(jumpInput, 10);
		if (!Number.isFinite(n)) return;
		const max = data?.totalPages ?? 1;
		setPage(Math.max(1, Math.min(max, n)));
		setJumpInput('');
	};

	const exportCsv = useCallback(() => {
		const sp = new URLSearchParams();
		sp.set('export', 'true');
		if (pondId) sp.set('pond', pondId);
		if (status !== 'all') sp.set('status', status);
		if (from) sp.set('from', `${from}T00:00:00`);
		if (to) sp.set('to', `${to}T23:59:59`);
		window.location.href = `/api/admin/logs?${sp.toString()}`;
	}, [pondId, status, from, to]);

	const total = data?.total ?? 0;
	const totalPages = data?.totalPages ?? 1;
	const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
	const rangeEnd = Math.min(total, page * limit);

	return (
		<div className="space-y-8">
			<div>
				<div className="flex items-center gap-2 mb-2">
					<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-violet-300">
						Admin Console
					</span>
				</div>
				<h1 className="text-4xl font-bold text-white tracking-tight">
					Ingestion Logs
				</h1>
				<p className="text-slate-400 mt-1.5 text-sm">
					Every ESP32 ingest attempt — success and failure.
				</p>
			</div>

			<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-6 space-y-5">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<label className={labelCls}>Pond</label>
						<select
							value={pondId}
							onChange={(e) => {
								setPondId(e.target.value);
								onFilterChange();
							}}
							className={inputCls}>
							<option value="">All Ponds</option>
							{ponds?.map((p) => (
								<option key={p.id} value={p.id}>
									{p.pond_code ?? `#${p.id}`} — {p.name}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className={labelCls}>Status</label>
						<div className="flex flex-wrap gap-2 pt-1">
							{(['all', 'success', 'error'] as Status[]).map((s) => (
								<button
									key={s}
									type="button"
									onClick={() => {
										setStatus(s);
										onFilterChange();
									}}
									className={`${pillBase} ${
										status === s ? pillActive : pillIdle
									}`}>
									{s === 'all' ? 'All' : s === 'success' ? 'Success' : 'Error'}
								</button>
							))}
						</div>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					<div>
						<label className={labelCls}>From</label>
						<input
							type="date"
							value={from}
							onChange={(e) => {
								setFrom(e.target.value);
								onFilterChange();
							}}
							max={to || undefined}
							className={inputCls}
						/>
					</div>
					<div>
						<label className={labelCls}>To</label>
						<input
							type="date"
							value={to}
							onChange={(e) => {
								setTo(e.target.value);
								onFilterChange();
							}}
							min={from || undefined}
							className={inputCls}
						/>
					</div>
					<div className="flex items-end gap-2">
						<button
							onClick={resetFilters}
							className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 font-medium rounded-lg transition-colors">
							Reset Filters
						</button>
						<button
							onClick={() => mutate()}
							className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-medium rounded-lg transition-colors">
							Refresh
						</button>
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-3 pt-1">
					<label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
						<input
							type="checkbox"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.target.checked)}
							className="w-4 h-4 accent-cyan-500"
						/>
						Auto-refresh every 10s
					</label>
					<button
						onClick={exportCsv}
						className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-400/30 hover:bg-emerald-500/20 text-emerald-300 font-semibold rounded-lg transition-colors">
						<DownloadIcon /> Export CSV
					</button>
				</div>
			</div>

			<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm overflow-hidden">
				<div className="px-6 py-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
					<p className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
						{total === 0
							? 'No records'
							: `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()} records`}
					</p>
					{isLoading && (
						<span className="text-[11px] text-slate-500">Loading…</span>
					)}
				</div>

				{error && (
					<div className="px-6 py-4 text-rose-300 text-sm bg-rose-500/10 border-b border-rose-400/20">
						Failed to load logs.
					</div>
				)}

				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-white/3 text-[10px] uppercase tracking-wider text-slate-400">
							<tr>
								<Th>Received</Th>
								<Th>Pond</Th>
								<Th className="text-right">Temp °C</Th>
								<Th className="text-right">pH</Th>
								<Th className="text-right">Sal ppt</Th>
								<Th className="text-right">DO mg/L</Th>
								<Th>Status</Th>
								<Th>IP</Th>
								<Th>Error</Th>
								<Th></Th>
							</tr>
						</thead>
						<tbody className="divide-y divide-white/5">
							{!data && !error && (
								<tr>
									<td colSpan={10} className="px-6 py-8 text-center text-slate-500">
										Loading…
									</td>
								</tr>
							)}
							{data && data.logs.length === 0 && (
								<tr>
									<td colSpan={10} className="px-6 py-8 text-center text-slate-500">
										No matching logs.
									</td>
								</tr>
							)}
							{data?.logs.map((row) => {
								const isOpen = expanded.has(row.id);
								const highlighted = highlightIds.has(row.id);
								const ok = row.http_status >= 200 && row.http_status < 300;
								return (
									<Fragment key={row.id}>
										<tr
											onClick={() => toggleExpand(row.id)}
											className={`cursor-pointer transition-colors ${
												highlighted
													? 'bg-cyan-400/10 animate-[pulse_2s_ease-in-out]'
													: 'hover:bg-white/3'
											}`}>
											<Td className="text-slate-300 font-mono text-xs whitespace-nowrap">
												{formatTs(row.received_at)}
											</Td>
											<Td className="text-slate-200 whitespace-nowrap">
												{row.pond_code ? (
													<>
														<span className="font-mono text-cyan-300 mr-1">
															{row.pond_code}
														</span>
														{row.pond_name && (
															<span className="text-slate-400">— {row.pond_name}</span>
														)}
													</>
												) : (
													<span className="text-slate-500">—</span>
												)}
											</Td>
											<Td className="text-right font-mono text-slate-200">
												{fmtNum(row.temperature)}
											</Td>
											<Td className="text-right font-mono text-slate-200">
												{fmtNum(row.ph)}
											</Td>
											<Td className="text-right font-mono text-slate-200">
												{fmtNum(row.salinity)}
											</Td>
											<Td className="text-right font-mono text-slate-200">
												{fmtNum(row.dissolved_oxygen)}
											</Td>
											<Td>
												<StatusBadge status={row.http_status} ok={ok} />
											</Td>
											<Td className="font-mono text-xs text-slate-400">
												{row.ip_address ?? '—'}
											</Td>
											<Td className="text-rose-300 text-xs max-w-[200px] truncate">
												{row.error_message ?? ''}
											</Td>
											<Td className="text-right">
												<span className="text-slate-500 text-xs">
													{isOpen ? '▾' : '▸'}
												</span>
											</Td>
										</tr>
										{isOpen && (
											<tr className="bg-black/30">
												<td colSpan={10} className="px-6 py-4">
													<p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
														Raw Payload
													</p>
													<pre className="text-xs font-mono text-emerald-200 bg-black/40 border border-white/5 rounded-lg p-4 overflow-x-auto">
														{JSON.stringify(row.raw_payload, null, 2)}
													</pre>
												</td>
											</tr>
										)}
									</Fragment>
								);
							})}
						</tbody>
					</table>
				</div>

				<div className="px-6 py-4 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
					<div className="text-xs text-slate-400">
						Page {data?.page ?? page} of {totalPages.toLocaleString()}
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={goPrev}
							disabled={page <= 1}
							className="px-3 py-1.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">
							← Previous
						</button>
						<button
							onClick={goNext}
							disabled={page >= totalPages}
							className="px-3 py-1.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">
							Next →
						</button>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								submitJump();
							}}
							className="flex items-center gap-1.5">
							<label className="text-[11px] text-slate-500 uppercase tracking-wider">
								Jump
							</label>
							<input
								value={jumpInput}
								onChange={(e) => setJumpInput(e.target.value)}
								placeholder="#"
								className="w-16 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-slate-100 focus:outline-none focus:border-cyan-400/50"
							/>
							<button
								type="submit"
								className="px-2.5 py-1 rounded border border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold">
								Go
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
}

function StatusBadge({ status, ok }: { status: number; ok: boolean }) {
	const cls = ok
		? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30'
		: 'bg-rose-500/10 text-rose-300 border-rose-400/30';
	return (
		<span
			className={`px-2 py-0.5 rounded-full text-[10px] font-bold border font-mono ${cls}`}>
			{status}
		</span>
	);
}

function Th({
	children,
	className = '',
}: {
	children?: React.ReactNode;
	className?: string;
}) {
	return (
		<th
			className={`px-4 py-3 text-left font-semibold whitespace-nowrap ${className}`}>
			{children}
		</th>
	);
}

function Td({
	children,
	className = '',
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function DownloadIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="w-4 h-4">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</svg>
	);
}
