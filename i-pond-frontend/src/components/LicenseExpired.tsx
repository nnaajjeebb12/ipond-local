import type { LicenseInfo } from '@/lib/license';

const REASON_TITLE: Record<LicenseInfo['reason'], string> = {
	ok: 'License Expired',
	missing: 'No License Found',
	malformed: 'Invalid License File',
	bad_signature: 'Invalid License Signature',
	serial_mismatch: 'License Not Valid For This Device',
	expired: 'License Expired',
};

const REASON_DETAIL: Record<LicenseInfo['reason'], string> = {
	ok: 'This installation is no longer licensed.',
	missing: 'No license file was found on this device.',
	malformed: 'The license file on this device could not be read.',
	bad_signature: 'The license file on this device failed verification.',
	serial_mismatch: 'This license was issued for a different device.',
	expired: 'The license for this installation has ended.',
};

function formatDate(iso: string | null): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

/**
 * Terminal state. Rendered in place of the app — there is no dismiss control
 * and no route that skips it.
 */
export default function LicenseExpired({ info }: { info: LicenseInfo }) {
	const overdue =
		info.daysLeft !== null && info.daysLeft < 0 ? Math.abs(info.daysLeft) : null;

	return (
		<div className="min-h-screen flex items-center justify-center bg-[#080d1a] px-4 py-10">
			<div className="w-full max-w-lg rounded-2xl border border-rose-500/35 bg-[rgba(15,23,42,0.96)] shadow-[0_0_60px_-15px_rgba(244,63,94,0.55)]">
				<div className="px-8 pt-8 pb-6 text-center border-b border-rose-500/20">
					<div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-400/40 flex items-center justify-center">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="#fb7185"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="w-7 h-7">
							<rect x="3" y="11" width="18" height="11" rx="2" />
							<path d="M7 11V7a5 5 0 0 1 10 0v4" />
						</svg>
					</div>
					<h1 className="text-3xl font-bold text-rose-200 tracking-tight">
						{REASON_TITLE[info.reason]}
					</h1>
					<p className="mt-2 text-sm text-slate-400">
						{REASON_DETAIL[info.reason]}
					</p>
					<p className="mt-5 text-sm text-slate-300">
						Contact{' '}
						<a
							href="mailto:sales@soletronix.com"
							className="font-semibold text-cyan-300 underline underline-offset-2">
							sales@soletronix.com
						</a>
					</p>
				</div>

				<dl className="px-8 py-6 space-y-3 text-sm">
					<div className="flex items-baseline justify-between gap-4">
						<dt className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-500">
							Client
						</dt>
						<dd className="font-semibold text-slate-100 text-right truncate">
							{info.client ?? 'Unknown'}
						</dd>
					</div>
					<div className="flex items-baseline justify-between gap-4">
						<dt className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-500">
							Expired
						</dt>
						<dd className="font-mono text-slate-100 text-right">
							{formatDate(info.expiresAt)}
						</dd>
					</div>
					{overdue !== null && (
						<div className="flex items-baseline justify-between gap-4">
							<dt className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-500">
								Overdue
							</dt>
							<dd className="font-mono text-rose-300 text-right">
								{overdue} day{overdue === 1 ? '' : 's'}
							</dd>
						</div>
					)}
					{info.reason === 'serial_mismatch' && (
						<div className="flex items-baseline justify-between gap-4">
							<dt className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-500">
								Device
							</dt>
							<dd className="font-mono text-[12px] text-slate-400 text-right truncate">
								{info.machineSerial ?? 'unreadable'}
							</dd>
						</div>
					)}
				</dl>

				<p className="px-8 pb-8 text-[11px] text-slate-600 text-center">
					See ME · Soletronix Aquaculture Monitoring
				</p>
			</div>
		</div>
	);
}
