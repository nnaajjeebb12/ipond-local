'use client';

import useSWR from 'swr';

type HealthState = 'live' | 'offline' | 'loading';

type StatusPayload = {
	status: 'online' | 'offline';
	label: string;
};

async function fetcher(url: string): Promise<StatusPayload> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return (await res.json()) as StatusPayload;
}

export function useSystemHealth() {
	const { data, error, isLoading } = useSWR<StatusPayload>(
		'/api/system/status',
		fetcher,
		{
			refreshInterval: 60_000,
			revalidateOnFocus: false,
		},
	);

	let state: HealthState;
	let label: string;
	let detail: string;

	if (error) {
		state = 'offline';
		label = 'Server Offline';
		detail = 'Cannot reach server';
	} else if (!data && isLoading) {
		state = 'loading';
		label = 'Checking…';
		detail = 'Pinging database…';
	} else if (data?.status === 'online') {
		state = 'live';
		label = data.label;
		detail = 'Database ping ok';
	} else {
		state = 'offline';
		label = data?.label ?? 'Server Offline';
		detail = 'Database unreachable';
	}

	return { state, label, detail };
}
