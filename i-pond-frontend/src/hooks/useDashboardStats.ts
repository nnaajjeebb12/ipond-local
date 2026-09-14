'use client';

import useSWR from 'swr';
import type { PondStatus as PondStatusType } from '@/lib/pondStatus';

export type DashboardStats = {
	activePonds: number;
	activeSensors: number;
	totalPonds: number;
	totalSensors: number;
	systemStatus: 'healthy' | 'degraded' | 'offline';
	lastReceivedAt: string | null;
	minutesSinceLastData: number | null;
};

async function fetcher(url: string): Promise<DashboardStats> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return (await res.json()) as DashboardStats;
}

export function useDashboardStats() {
	const { data, error, isLoading } = useSWR<DashboardStats>(
		'/api/dashboard/stats',
		fetcher,
		{ refreshInterval: 30_000, revalidateOnFocus: false },
	);
	return { stats: data, isLoading, error };
}

export type PondStatus = {
	pondId: number;
	status: PondStatusType;
	lastSeen: string | null;
	minutesSinceLastData: number | null;
};

async function pondStatusFetcher(url: string): Promise<PondStatus[]> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) throw new Error(`${url} -> ${res.status}`);
	return (await res.json()) as PondStatus[];
}

export function usePondStatuses() {
	const { data, error, isLoading } = useSWR<PondStatus[]>(
		'/api/ponds/status',
		pondStatusFetcher,
		{ refreshInterval: 30_000, revalidateOnFocus: false },
	);

	const byId = new Map<string, PondStatus>();
	if (data) {
		for (const s of data) byId.set(String(s.pondId), s);
	}

	return { statuses: data, byId, isLoading, error };
}
