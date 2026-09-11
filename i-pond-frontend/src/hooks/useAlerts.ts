'use client';

import useSWR from 'swr';

export type ActiveAlert = {
	id: string;
	pondId: number;
	pondName: string;
	sensor: string;
	triggeredAt: string;
	consecutiveCount: number;
	lastValue: number;
	optimalMin: number;
	optimalMax: number;
};

async function fetcher(url: string): Promise<ActiveAlert[]> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) {
		if (res.status === 401) return [];
		throw new Error(`${url} -> ${res.status}`);
	}
	return (await res.json()) as ActiveAlert[];
}

export function useActiveAlerts() {
	const { data, error, mutate, isLoading } = useSWR<ActiveAlert[]>(
		'/api/alerts/active',
		fetcher,
		{ refreshInterval: 30_000, revalidateOnFocus: false },
	);
	return { alerts: data, mutate, isLoading, error };
}

export async function acknowledgeAlert(id: string): Promise<void> {
	const res = await fetch(`/api/alerts/${id}/acknowledge`, {
		method: 'POST',
		credentials: 'include',
	});
	if (!res.ok) throw new Error(`ack failed -> ${res.status}`);
}

export type UnreadCount = {
	total: number;
	maintenance: number;
	alerts: number;
};

async function unreadFetcher(url: string): Promise<UnreadCount> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) return { total: 0, maintenance: 0, alerts: 0 };
	return (await res.json()) as UnreadCount;
}

export function useUnreadCount() {
	const { data } = useSWR<UnreadCount>(
		'/api/notifications/unread-count',
		unreadFetcher,
		{ refreshInterval: 60_000, revalidateOnFocus: false },
	);
	return data ?? { total: 0, maintenance: 0, alerts: 0 };
}
