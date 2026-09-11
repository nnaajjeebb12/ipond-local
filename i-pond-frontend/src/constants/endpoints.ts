export const API_BASE_URL =
	process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export const API_ENDPOINTS = {
	PONDS: '/ponds',
	SENSOR_DATA: '/sensor-data',
	READINGS: '/readings',
	REPORTS: '/reports',
	LICENSE: '/license',
} as const;
