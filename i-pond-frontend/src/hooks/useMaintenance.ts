'use client';

import useSWR from 'swr';

export type MaintenanceRow = {
	id: string;
	pondId: number;
	pondName: string;
	status: 'pending' | 'acknowledged' | 'resolved';
	createdAt: string;
};

async function fetcher(url: string): Promise<MaintenanceRow[]> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) return [];
	return (await res.json()) as MaintenanceRow[];
}

export function useMaintenanceRequests() {
	const { data, error, isLoading, mutate } = useSWR<MaintenanceRow[]>(
		'/api/maintenance',
		fetcher,
		{ refreshInterval: 30_000, revalidateOnFocus: false },
	);
	return { requests: data, error, isLoading, mutate };
}

export type ActiveMaintenanceState = 'pending' | 'acknowledged';

export function useActiveMaintenanceByPond() {
	const { requests } = useMaintenanceRequests();
	const byPond = new Map<string, ActiveMaintenanceState>();
	for (const r of requests ?? []) {
		if (r.status === 'pending' || r.status === 'acknowledged') {
			const key = String(r.pondId);
			const prev = byPond.get(key);
			if (prev !== 'pending') byPond.set(key, r.status);
		}
	}
	return byPond;
}
