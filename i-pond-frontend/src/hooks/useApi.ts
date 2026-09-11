import { Pond, SensorReading } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { SWRConfiguration } from 'swr';

export type Range = 'today' | '7d' | '14d' | '30d';

export type Health = 'normal' | 'warning' | 'critical';

export type AggregatedBucket = {
	time: number;
	avg: number;
	min: number;
	max: number;
	anomalyCount: number;
	health: Health;
};

export type RawPoint = {
	time: number;
	value: number;
};

export type ReadingsPayload =
	| { mode: 'raw'; data: RawPoint[] }
	| { mode: 'aggregated'; bucketSize: string; data: AggregatedBucket[] };

export type PondWithOwner = Pond & {
	company_name?: string | null;
};

const SENSOR_UNITS: Record<string, string> = {
	temperature: '°C',
	ph: 'pH',
	dox: 'mg/L',
	dissolved_oxygen: 'mg/L',
	salinity: 'ppt',
};

const SENSOR_PARAM: Record<string, string> = {
	temperature: 'temperature',
	ph: 'ph',
	dox: 'dissolved_oxygen',
	dissolved_oxygen: 'dissolved_oxygen',
	salinity: 'salinity',
};

const swrConfig: SWRConfiguration = {
	refreshInterval: 10_000,
	revalidateOnFocus: false,
	revalidateOnReconnect: true,
	keepPreviousData: true,
	dedupingInterval: 2_000,
};

async function jsonFetcher<T>(url: string): Promise<T> {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`fetch ${url} -> ${res.status} ${body.slice(0, 100)}`);
	}
	return (await res.json()) as T;
}

type LatestPayload = {
	pondId: string;
	time: string | null;
	timestamp: number | null;
	temperature: number | null;
	ph: number | null;
	salinity: number | null;
	dissolved_oxygen: number | null;
};

export function unitFor(sensorType: string): string {
	return SENSOR_UNITS[sensorType] ?? '';
}

export function usePonds() {
	const { data, error, isLoading } = useSWR<PondWithOwner[]>(
		'/api/ponds',
		jsonFetcher,
		swrConfig
	);
	return { ponds: data, isLoading, error };
}

export function usePond(pondId?: string) {
	const { ponds, isLoading, error } = usePonds();
	const pond = pondId ? ponds?.find((p) => p.id === pondId) ?? null : null;
	return { pond, isLoading, error };
}

function useTabVisible(): boolean {
	const [visible, setVisible] = useState(true);
	useEffect(() => {
	    if (typeof document === 'undefined') return;
	    setTimeout(() => setVisible(!document.hidden), 0);
		const onChange = () => setVisible(!document.hidden);
		document.addEventListener('visibilitychange', onChange);
		return () => document.removeEventListener('visibilitychange', onChange);
	}, []);
	return visible;
}

export function useReadings(
	pondId: string | null,
	sensorType: string,
	range: Range
) {
	const param = SENSOR_PARAM[sensorType];
	const enabled = !!param && (pondId === null || !!pondId);
	const isTodayPond = enabled && range === 'today' && !!pondId;

	const visible = useTabVisible();
	const [todayBuffer, setTodayBuffer] = useState<RawPoint[]>([]);
	const [lastTimestamp, setLastTimestamp] = useState<number | null>(null);
	const [lastUpdated, setLastUpdated] = useState<number | null>(null);
	const resetKeyRef = useRef<string>('');

	// Reset append state when pond/sensor/range changes.
	const resetKey = `${pondId ?? ''}|${sensorType}|${range}`;
	useEffect(() => {
	    if (resetKeyRef.current === resetKey) return;
	    resetKeyRef.current = resetKey;
	    setTimeout(() => {
	        setTodayBuffer([]);
	        setLastTimestamp(null);
	        setLastUpdated(null);
	    }, 0);
	}, [resetKey]);

	const baseUrl = enabled
		? `/api/readings?${pondId ? `pond=${encodeURIComponent(pondId)}&` : ''}sensor=${param}&range=${range}`
		: null;
	const url =
		baseUrl && isTodayPond && lastTimestamp !== null
			? `${baseUrl}&since=${lastTimestamp}`
			: baseUrl;

	const { data, error, isLoading, isValidating, mutate } = useSWR<ReadingsPayload>(
		url,
		jsonFetcher,
		{
			...swrConfig,
			refreshInterval: visible ? 10_000 : 0,
		}
	);

	// Revalidate immediately when tab returns to visible.
	useEffect(() => {
		if (visible && url) mutate();
	}, [visible, url, mutate]);

	// Merge today payloads (initial load = replace, subsequent polls = append).
	useEffect(() => {
		if (!data) return;
		if (isTodayPond && data.mode === 'raw') {
			if (lastTimestamp === null) {
				const ts = data.data.length > 0 ? data.data[data.data.length - 1].time : null;
				setTimeout(() => {
					setTodayBuffer(data.data);
					if (ts !== null) setLastTimestamp(ts);
				}, 0);
			} else if (data.data.length > 0) {
				setTimeout(() => {
					setTodayBuffer((prev) => [...prev, ...data.data]);
					setLastTimestamp(data.data[data.data.length - 1].time);
				}, 0);
			}
		}
		setTimeout(() => setLastUpdated(Date.now()), 0);
	}, [data, isTodayPond, lastTimestamp]);

	const refresh = useCallback(() => {
		if (isTodayPond) {
			setTodayBuffer([]);
			setLastTimestamp(null);
			setLastUpdated(null);
		} else {
			mutate();
		}
	}, [isTodayPond, mutate]);

	const payload: ReadingsPayload | undefined = isTodayPond
		? lastTimestamp === null && todayBuffer.length === 0
			? data
			: { mode: 'raw', data: todayBuffer }
		: data;

	return { payload, isLoading, error, isValidating, lastUpdated, refresh };
}

export function useSensorReadings(
	pondId: string,
	sensorType: string,
	range: Range = '7d'
) {
	const { payload, isLoading, error, isValidating, lastUpdated, refresh } =
		useReadings(pondId, sensorType, range);

	const readings: SensorReading[] | undefined = payload
		? payload.mode === 'raw'
			? payload.data.map((p) => ({
					id: `${pondId}-${sensorType}-${p.time}`,
					timestamp: p.time,
					value: p.value,
					unit: unitFor(sensorType),
					sensorId: `${pondId}-${sensorType}`,
					pondId,
				}))
			: payload.data.map((p) => ({
					id: `${pondId}-${sensorType}-${p.time}`,
					timestamp: p.time,
					value: p.avg,
					unit: unitFor(sensorType),
					sensorId: `${pondId}-${sensorType}`,
					pondId,
				}))
		: undefined;

	return { payload, readings, isLoading, error, isValidating, lastUpdated, refresh };
}

export type RawReadingsQuery =
	| { mode: 'preset'; preset: 'today' | '7d' | '14d' | '30d' }
	| { mode: 'custom'; from: string; to: string };

type RawApiRow = {
	timestamp: number;
	value: number;
	unit: string;
	pondId: string;
};

export function useRawReadings(
	pondId: string,
	sensorType: string,
	query: RawReadingsQuery | null
) {
	const param = SENSOR_PARAM[sensorType];
	const enabled = !!param && !!pondId && !!query;

	let url: string | null = null;
	if (enabled && query) {
		const qs = new URLSearchParams({ pond: pondId, sensor: param });
		if (query.mode === 'preset') {
			qs.set('range', query.preset);
		} else {
			qs.set('from', query.from);
			qs.set('to', query.to);
		}
		url = `/api/readings/raw?${qs.toString()}`;
	}

	const { data, error, isLoading, isValidating, mutate } = useSWR<{ data: RawApiRow[] }>(
		url,
		jsonFetcher,
		swrConfig
	);

	const readings: SensorReading[] | undefined = data?.data?.map((r) => ({
		id: `${pondId}-${sensorType}-${r.timestamp}`,
		timestamp: r.timestamp,
		value: r.value,
		unit: r.unit,
		sensorId: `${pondId}-${sensorType}`,
		pondId,
	}));

	return { readings, isLoading, error, isValidating, refresh: mutate };
}

export type AllReadingRow = {
	time: number;
	pondId: number;
	pondName: string;
	temperature: number | null;
	ph: number | null;
	salinity: number | null;
	dissolved_oxygen: number | null;
};

export type AllReadingsScope =
	| { mode: 'all' }
	| { mode: 'select'; pondIds: string[] };

export async function fetchAllReadings(
	scope: AllReadingsScope,
	from: string,
	to: string
): Promise<{ data: AllReadingRow[]; truncated?: boolean }> {
	const qs = new URLSearchParams({ from, to });
	if (scope.mode === 'all') qs.set('ponds', 'all');
	else qs.set('ponds', scope.pondIds.join(','));
	const res = await fetch(`/api/readings/all?${qs.toString()}`, {
		credentials: 'include',
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`fetch all -> ${res.status} ${body.slice(0, 200)}`);
	}
	return (await res.json()) as { data: AllReadingRow[]; truncated?: boolean };
}

export function useAllPondsReadings(sensorType: string, range: Range = '7d') {
	const { payload, isLoading, error } = useReadings(null, sensorType, range);

	const readings: SensorReading[] | undefined = payload
		? payload.mode === 'raw'
			? payload.data.map((p) => ({
					id: `all-${sensorType}-${p.time}`,
					timestamp: p.time,
					value: p.value,
					unit: unitFor(sensorType),
					sensorId: `all-${sensorType}`,
					pondId: 'all',
				}))
			: payload.data.map((p) => ({
					id: `all-${sensorType}-${p.time}`,
					timestamp: p.time,
					value: p.avg,
					unit: unitFor(sensorType),
					sensorId: `all-${sensorType}`,
					pondId: 'all',
				}))
		: undefined;

	return { payload, readings, isLoading, error };
}

export function useMultiPondReadings(
	sensorType: string,
	range: Range,
	pondIds: string[] | 'all',
) {
	const param = SENSOR_PARAM[sensorType];
	const visible = useTabVisible();
	const pondsKey = pondIds === 'all' ? 'all' : [...pondIds].sort().join(',');
	const enabled = !!param && (pondIds === 'all' || pondIds.length > 0);
	const url = enabled
		? `/api/readings?sensor=${param}&range=${range}&ponds=${encodeURIComponent(pondsKey)}`
		: null;
	const { data, error, isLoading } = useSWR<ReadingsPayload>(url, jsonFetcher, {
		...swrConfig,
		refreshInterval: visible ? 10_000 : 0,
	});
	return { payload: data, isLoading, error };
}

export type ComparePondSeries = {
	pondId: number;
	pondName: string;
	data: AggregatedBucket[];
};

export type CompareReadingsPayload = {
	bucketSize: string;
	series: ComparePondSeries[];
};

export function useCompareReadings(
	sensorType: string,
	range: Range,
	pondIds: string[] | 'all',
) {
	const param = SENSOR_PARAM[sensorType];
	const visible = useTabVisible();
	const pondsKey = pondIds === 'all' ? 'all' : [...pondIds].sort().join(',');
	const enabled = !!param && (pondIds === 'all' || pondIds.length > 0);
	const url = enabled
		? `/api/readings/compare?sensor=${param}&range=${range}&ponds=${encodeURIComponent(pondsKey)}`
		: null;
	const { data, error, isLoading } = useSWR<CompareReadingsPayload>(url, jsonFetcher, {
		...swrConfig,
		refreshInterval: visible ? 10_000 : 0,
	});
	return { payload: data, isLoading, error };
}

function useLatestPayload(pondId: string) {
	const url = pondId
		? `/api/readings/latest?pond=${encodeURIComponent(pondId)}`
		: null;
	return useSWR<LatestPayload>(url, jsonFetcher, swrConfig);
}

export function useLatestReading(pondId: string, sensorType: string) {
	const { data, error, isLoading } = useLatestPayload(pondId);

	let reading: SensorReading | null = null;
	if (data && data.timestamp !== null) {
		const key =
			sensorType === 'dox'
				? 'dissolved_oxygen'
				: (sensorType as keyof LatestPayload);
		const value = data[key as keyof LatestPayload];
		if (typeof value === 'number') {
			reading = {
				id: `${pondId}-${sensorType}-${data.timestamp}`,
				timestamp: data.timestamp,
				value,
				unit: SENSOR_UNITS[sensorType] ?? '',
				sensorId: `${pondId}-${sensorType}`,
				pondId,
			};
		}
	}

	return { reading, isLoading, error };
}
