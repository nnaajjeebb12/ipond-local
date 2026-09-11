import useSWR, { SWRConfiguration } from 'swr';

export type Threshold = {
	id: string;
	pondId: number;
	sensor: string;
	optimal_min: number;
	optimal_max: number;
	optimal_value: number | null;
	updated_at: string;
	updated_by: string | null;
};

export type ThresholdMap = Record<
	string,
	{ min: number; max: number; value: number | null }
>;

const swrConfig: SWRConfiguration = {
	refreshInterval: 60_000,
	revalidateOnFocus: false,
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

const SENSOR_ALIAS: Record<string, string> = {
	dox: 'dissolved_oxygen',
	dissolved_oxygen: 'dissolved_oxygen',
	temperature: 'temperature',
	ph: 'ph',
	salinity: 'salinity',
};

export function useThresholds(pondId?: string | null) {
	const url = pondId
		? `/api/thresholds?pond=${encodeURIComponent(pondId)}`
		: null;
	const { data, error, isLoading, mutate } = useSWR<Threshold[]>(
		url,
		jsonFetcher,
		swrConfig
	);

	const map: ThresholdMap = {};
	if (data) {
		for (const t of data) {
			map[t.sensor] = {
				min: t.optimal_min,
				max: t.optimal_max,
				value: t.optimal_value ?? null,
			};
		}
	}

	function lookup(
		sensorType: string,
	): { min: number; max: number; value: number | null } | undefined {
		const key = SENSOR_ALIAS[sensorType] ?? sensorType;
		return map[key];
	}

	return { thresholds: data, map, lookup, isLoading, error, mutate };
}
