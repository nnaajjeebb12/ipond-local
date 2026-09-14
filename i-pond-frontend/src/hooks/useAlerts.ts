'use client';

import useSWR, { mutate as globalMutate } from 'swr';

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

/**
 * The bell badge and the alert list are different SWR keys. Anything that
 * acknowledges alerts must poke both, or the badge shows a stale count for up
 * to a minute after the list is already empty.
 */
export async function refreshAlertViews(): Promise<void> {
	await Promise.all([
		globalMutate('/api/alerts/active'),
		globalMutate('/api/alerts'),
		globalMutate('/api/notifications/unread-count'),
	]);
}

/** Acknowledges every open alert server-side in one call. Returns how many. */
export async function acknowledgeAllAlerts(): Promise<number> {
	const res = await fetch('/api/alerts/acknowledge-all', {
		method: 'POST',
		credentials: 'include',
	});
	if (!res.ok) throw new Error(`ack all failed -> ${res.status}`);
	const body = (await res.json()) as { acknowledged?: number };
	return body.acknowledged ?? 0;
}

const HANDLED_KEY = 'ipond.alertsHandledThisSession';

/** What the popup suppresses on: the CONDITION, not the alert row. */
export function alertKey(a: Pick<ActiveAlert, 'pondId' | 'sensor'>): string {
	return `${a.pondId}:${a.sensor}`;
}

/**
 * Once an alert is ignored OR acknowledged in this browser session, the same
 * condition (pond + sensor) does not pop up again until the tab is closed —
 * even if the server raises a fresh alert row for it (it re-checks every few
 * minutes and a pond that stays offline would otherwise nag every time).
 *
 * sessionStorage, deliberately: a new tab or a new day starts clean, so a
 * condition that is still going on is seen again eventually. Ignored alerts
 * remain open on the server and in /notifications; acknowledged ones are
 * marked there.
 */
export function loadHandledAlertKeys(): Set<string> {
	try {
		const raw = sessionStorage.getItem(HANDLED_KEY);
		if (!raw) return new Set();
		const arr = JSON.parse(raw);
		return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
	} catch {
		return new Set();
	}
}

export function saveHandledAlertKeys(keys: Set<string>): void {
	try {
		sessionStorage.setItem(HANDLED_KEY, JSON.stringify([...keys]));
	} catch {
		// storage unavailable — suppression lasts for this page only
	}
}

export type UnreadCount = {
	total: number;
	alerts: number;
};

async function unreadFetcher(url: string): Promise<UnreadCount> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) return { total: 0, alerts: 0 };
	return (await res.json()) as UnreadCount;
}

export function useUnreadCount() {
	const { data } = useSWR<UnreadCount>(
		'/api/notifications/unread-count',
		unreadFetcher,
		{ refreshInterval: 60_000, revalidateOnFocus: false },
	);
	return data ?? { total: 0, alerts: 0 };
}
