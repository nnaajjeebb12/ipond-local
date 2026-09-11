export interface SensorReading {
	id: string;
	timestamp: number;
	value: number;
	unit: string;
	sensorId: string;
	pondId: string;
}

export interface Pond {
	id: string;
	name: string;
	location: string;
	capacity: number;
	area: number;
	pond_code?: string | null;
	company_name?: string | null;
}
