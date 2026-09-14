'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { mutate as globalMutate } from 'swr';

const ERROR_TEXT: Record<string, string> = {
	name_required: 'Give the pond a name.',
	name_too_long: 'That name is too long (120 characters max).',
	invalid_pond_code: 'Pond code may only contain letters, numbers and dashes.',
	pond_code_taken: 'That pond code is already in use on this appliance.',
	invalid_capacity: 'Capacity must be a number.',
	invalid_area: 'Area must be a number.',
};

/**
 * "+ Add Pond" — creates a pond on this appliance. The code it gets (PND-011,
 * PND-012, …) is what the gateway must post under (`pnd: 11`). The main
 * server is not told: the same code must be created there by hand under
 * this site's owner, or sync stops on that pond with `pond_mismatch`.
 */
export default function AddPondButton({ compact = false }: { compact?: boolean }) {
	const [open, setOpen] = useState(false);
	const [mounted, setMounted] = useState(false);
	const [name, setName] = useState('');
	const [code, setCode] = useState('');
	const [location, setLocation] = useState('');
	const [capacity, setCapacity] = useState('');
	const [area, setArea] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<string | null>(null);

	useEffect(() => setMounted(true), []);

	function reset() {
		setName('');
		setCode('');
		setLocation('');
		setCapacity('');
		setArea('');
		setError(null);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch('/api/ponds', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					pond_code: code.trim() || undefined,
					location: location.trim() || undefined,
					capacity: capacity.trim() || undefined,
					area: area.trim() || undefined,
				}),
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string; pond_code?: string; name?: string };
			if (!res.ok) {
				setError(ERROR_TEXT[body.error ?? ''] ?? `Could not create the pond (server said ${res.status}).`);
				return;
			}
			await globalMutate('/api/ponds');
			await globalMutate('/api/ponds/status');
			setOpen(false);
			reset();
			setCreated(`${body.name} created as ${body.pond_code}`);
			setTimeout(() => setCreated(null), 6000);
		} catch (err) {
			console.error('pond_create_failed', err);
			setError('Could not reach the server.');
		} finally {
			setSubmitting(false);
		}
	}

	const inputCls =
		'w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--border)] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50';
	const labelCls = 'block text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1';

	return (
		<>
			<div className="flex items-center gap-3">
				{created && <span className="text-[11px] text-emerald-300">{created}</span>}
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={
						compact
							? 'px-2.5 py-1 rounded-md text-[11px] font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-400/30 transition-colors'
							: 'px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-sm font-semibold transition-colors'
					}>
					+ Add Pond
				</button>
			</div>

			{mounted && open &&
				createPortal(
					<div
						className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
						onClick={() => !submitting && setOpen(false)}>
						<form
							onSubmit={submit}
							onClick={(e) => e.stopPropagation()}
							className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.96)] shadow-2xl">
							<div className="px-5 py-4 border-b border-[var(--border)]">
								<h2 className="font-bold text-white">Add Pond</h2>
								<p className="text-[11px] text-slate-400 mt-0.5">
									The code is what the gateway posts under (PND-011 → <span className="font-mono">pnd: 11</span>).
									Create the same code under this site&apos;s account on the main server too, or its readings
									will wait on the Pi.
								</p>
							</div>
							<div className="p-5 space-y-3">
								<div>
									<label className={labelCls}>Name *</label>
									<input
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="Pond 11"
										required
										maxLength={120}
										autoFocus
										className={inputCls}
									/>
								</div>
								<div>
									<label className={labelCls}>Pond code</label>
									<input
										value={code}
										onChange={(e) => setCode(e.target.value.toUpperCase())}
										placeholder="Leave blank for the next PND-### number"
										maxLength={32}
										className={`${inputCls} font-mono`}
									/>
								</div>
								<div>
									<label className={labelCls}>Location</label>
									<input
										value={location}
										onChange={(e) => setLocation(e.target.value)}
										placeholder="Optional"
										maxLength={200}
										className={inputCls}
									/>
								</div>
								<div className="grid grid-cols-2 gap-3">
									<div>
										<label className={labelCls}>Capacity</label>
										<input
											value={capacity}
											onChange={(e) => setCapacity(e.target.value)}
											placeholder="Optional"
											inputMode="decimal"
											className={inputCls}
										/>
									</div>
									<div>
										<label className={labelCls}>Area</label>
										<input
											value={area}
											onChange={(e) => setArea(e.target.value)}
											placeholder="Optional"
											inputMode="decimal"
											className={inputCls}
										/>
									</div>
								</div>
								{error && (
									<p className="text-[11px] text-rose-300" role="alert">
										{error}
									</p>
								)}
							</div>
							<div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
								<button
									type="button"
									onClick={() => {
										setOpen(false);
										reset();
									}}
									disabled={submitting}
									className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors">
									Cancel
								</button>
								<button
									type="submit"
									disabled={submitting || !name.trim()}
									className="px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-sm font-semibold disabled:opacity-50 transition-colors">
									{submitting ? 'Creating…' : 'Create pond'}
								</button>
							</div>
						</form>
					</div>,
					document.body,
				)}
		</>
	);
}
