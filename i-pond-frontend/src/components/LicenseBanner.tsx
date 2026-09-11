'use client';

import { useState } from 'react';
import useSWR from 'swr';

type LicenseStatus = {
	valid: boolean;
	client: string | null;
	expiresAt: string | null;
	daysLeft: number | null;
};

async function fetcher(url: string): Promise<LicenseStatus> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return (await res.json()) as LicenseStatus;
}

/**
 * Expiry warning strip. Amber inside 30 days, red inside 7.
 * The hard block lives in the root layout — this is only the heads-up.
 */
export default function LicenseBanner() {
	const [dismissed, setDismissed] = useState(false);
	const { data } = useSWR<LicenseStatus>('/api/license', fetcher, {
		refreshInterval: 60 * 60 * 1000,
		revalidateOnFocus: false,
	});

	if (dismissed) return null;
	if (!data || !data.valid || data.daysLeft === null) return null;

	const days = data.daysLeft;
	if (days > 30) return null;

	const critical = days <= 7;
	const wrapCls = critical
		? 'bg-rose-500/10 border-b border-rose-400/30'
		: 'bg-amber-500/10 border-b border-amber-400/30';
	const textCls = critical ? 'text-rose-300' : 'text-amber-300';

	return (
		<div className={`${wrapCls} px-4 py-2 flex items-center justify-between`}>
			<span className={`${textCls} text-sm`}>
				⚠ License expires in {days} day{days === 1 ? '' : 's'}
				{critical ? '!' : '.'} Contact{' '}
				<a href="mailto:sales@soletronix.com" className="underline font-semibold">
					sales@soletronix.com
				</a>
				{critical ? ' immediately.' : ' to renew.'}
			</span>
			<button
				onClick={() => setDismissed(true)}
				aria-label="Dismiss"
				className={`${textCls} ml-3 px-2 py-0.5 rounded hover:bg-white/5`}>
				✕
			</button>
		</div>
	);
}
