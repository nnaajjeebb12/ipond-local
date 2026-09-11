'use client';

import { BackButton, ErrorMessage, LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import SensorCard from '@/components/SensorCard';
import SensorChart from '@/components/charts/SensorChart';
import { usePond, useSensorReadings, type Range } from '@/hooks/useApi';
import { useThresholds } from '@/hooks/useThresholds';
import { use, useState } from 'react';

interface SensorDetailProps {
	params: Promise<{ pondId: string; sensorType: string }>;
}

const SENSOR_CONFIGS: Record<
	string,
	{ label: string; icon: string; unit: string; color: string }
> = {
	temperature: { label: 'Temperature', icon: '🌡️', unit: '°C', color: '#22c55e' },
	ph: { label: 'pH Level', icon: '⚗️', unit: 'pH', color: '#86efac' },
	dox: { label: 'Dissolved Oxygen', icon: '💨', unit: 'mg/L', color: '#4ade80' },
	salinity: { label: 'Salinity', icon: '🧂', unit: 'ppt', color: '#16a34a' },
};

export default function SensorDetailPage({ params }: SensorDetailProps) {
	const { pondId, sensorType } = use(params);
	const { pond, isLoading: isPondLoading } = usePond(pondId);
	const { lookup } = useThresholds(pondId);
	const optimal = lookup(sensorType);
	const [range, setRange] = useState<Range>('today');
	const {
		readings,
		payload,
		isLoading: isReadingsLoading,
		isValidating,
		lastUpdated,
		refresh,
		error,
	} = useSensorReadings(pondId, sensorType, range);

	const RANGE_OPTIONS: { value: Range; label: string }[] = [
		{ value: 'today', label: 'Today' },
		{ value: '7d', label: '7d' },
		{ value: '14d', label: '14d' },
		{ value: '30d', label: '30d' },
	];

	const config = SENSOR_CONFIGS[sensorType];
	if (!config)
		return (
			<MainLayout>
				<ErrorMessage message="Sensor not found" />
			</MainLayout>
		);

	const latestReading = readings?.[readings.length - 1] || null;

	return (
		<MainLayout>
			<div className="space-y-8">
				<div>
					<BackButton
						href={`/dashboard/${pondId}`}
						label={`Back to ${pond?.name || 'Pond'}`}
					/>
					<div className="flex items-end justify-between flex-wrap gap-4 mt-2">
						<div>
							<div className="flex items-center gap-2 mb-2">
								<span className="text-2xl">{config.icon}</span>
								<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-cyan-300">
									{pond?.name} · {config.unit}
								</span>
							</div>
							<h1 className="text-4xl font-bold text-white tracking-tight">
								{config.label}
							</h1>
						</div>
					</div>
				</div>

				<div className="flex items-center gap-3 flex-wrap">
					<div className="inline-flex items-center gap-1 p-1 rounded-lg border border-[var(--border)] bg-white/3">
						{RANGE_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								onClick={() => setRange(opt.value)}
								className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
									range === opt.value
										? 'bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_-5px_rgba(34,211,238,0.6)]'
										: 'text-slate-400 hover:text-slate-200'
								}`}>
								{opt.label}
							</button>
						))}
					</div>
					<button
						onClick={refresh}
						disabled={isValidating}
						title="Refresh"
						aria-label="Refresh"
						className="p-2 rounded-lg border border-[var(--border)] bg-white/5 text-slate-300 hover:bg-white/10 hover:text-cyan-300 hover:border-cyan-400/40 disabled:opacity-50 transition-colors">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`}>
							<polyline points="23 4 23 10 17 10" />
							<polyline points="1 20 1 14 7 14" />
							<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
						</svg>
					</button>
					<span className="text-[11px] text-slate-500 font-mono">
						{lastUpdated
							? `Last sync: ${new Date(lastUpdated).toLocaleTimeString()}`
							: '—'}
					</span>
				</div>

				{error && <ErrorMessage message="Failed to load sensor data" />}

				{isReadingsLoading || isPondLoading ? (
					<LoadingSpinner />
				) : (
					<>
						<div>
							<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400 mb-3">
								Current Reading
							</h2>
							<SensorCard
								title={config.label}
								reading={latestReading}
								icon={config.icon}
								optimal={optimal}
								isLoading={isReadingsLoading}
							/>
						</div>

						{readings && readings.length > 0 && (
							<div>
								<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400 mb-3">
									Statistics
								</h2>
								<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
									<StatBlock
										label="Current"
										value={`${latestReading?.value.toFixed(2) || 'N/A'}`}
										unit={config.unit}
										accent="cyan"
									/>
									<StatBlock
										label="Average"
										value={(
											readings.reduce((sum, r) => sum + r.value, 0) / readings.length
										).toFixed(2)}
										unit={config.unit}
										accent="emerald"
									/>
									<StatBlock
										label="Maximum"
										value={Math.max(...readings.map((r) => r.value)).toFixed(2)}
										unit={config.unit}
										accent="rose"
									/>
									<StatBlock
										label="Minimum"
										value={Math.min(...readings.map((r) => r.value)).toFixed(2)}
										unit={config.unit}
										accent="amber"
									/>
								</div>
							</div>
						)}

						{readings && readings.length > 0 && (
							<div>
								<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400 mb-3">
									Trend Analysis
								</h2>
								<SensorChart
									mode={payload?.mode === 'aggregated' ? 'aggregated' : 'raw'}
									sensor={
										sensorType === 'dox'
											? 'dissolved_oxygen'
											: (sensorType as
													| 'temperature'
													| 'ph'
													| 'salinity'
													| 'dissolved_oxygen')
									}
									unit={config.unit}
									label={`${config.label} Over Time`}
									range={range}
									isLoading={isReadingsLoading}
									optimalMin={optimal?.min}
									optimalMax={optimal?.max}
									optimalValue={optimal?.value ?? null}
									data={payload?.mode === 'raw' ? payload.data : undefined}
									aggregated={
										payload?.mode === 'aggregated' ? payload.data : undefined
									}
									bucketSize={
										payload?.mode === 'aggregated' ? payload.bucketSize : undefined
									}
								/>
							</div>
						)}

						{readings && readings.length > 0 && (
							<div>
								<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400 mb-3">
									Recent Readings
								</h2>
								<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm overflow-hidden">
									<div className="overflow-x-auto">
										<table className="w-full">
											<thead className="bg-white/3 border-b border-white/5">
												<tr>
													<th className="px-6 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-400">
														Time
													</th>
													<th className="px-6 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-400">
														Value
													</th>
													<th className="px-6 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-400">
														Status
													</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-white/5">
												{readings
													.slice(-20)
													.reverse()
													.map((reading, idx) => {
														const isOptimal =
															optimal !== undefined &&
															reading.value >= optimal.min &&
															reading.value <= optimal.max;
														return (
															<tr key={idx} className="hover:bg-white/3 transition-colors">
																<td className="px-6 py-3 text-sm text-slate-300 font-mono">
																	{new Date(reading.timestamp).toLocaleString()}
																</td>
																<td className="px-6 py-3 text-sm text-white font-semibold font-mono">
																	{reading.value.toFixed(2)}{' '}
																	<span className="text-slate-500 font-normal">
																		{config.unit}
																	</span>
																</td>
																<td className="px-6 py-3 text-sm">
																	<span
																		className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
																			isOptimal
																				? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30'
																				: 'bg-rose-500/10 text-rose-300 border-rose-400/30'
																		}`}>
																		<span
																			className="w-1.5 h-1.5 rounded-full"
																			style={{
																				backgroundColor: isOptimal
																					? '#34d399'
																					: '#fb7185',
																			}}
																		/>
																		{isOptimal ? 'Optimal' : 'Alert'}
																	</span>
																</td>
															</tr>
														);
													})}
											</tbody>
										</table>
									</div>
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</MainLayout>
	);
}

function StatBlock({
	label,
	value,
	unit,
	accent,
}: {
	label: string;
	value: string;
	unit: string;
	accent: 'cyan' | 'emerald' | 'rose' | 'amber';
}) {
	const map = {
		cyan: { text: 'text-cyan-300', bar: '#22d3ee' },
		emerald: { text: 'text-emerald-300', bar: '#34d399' },
		rose: { text: 'text-rose-300', bar: '#fb7185' },
		amber: { text: 'text-amber-300', bar: '#fbbf24' },
	}[accent];
	return (
		<div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-5">
			<div
				className="absolute inset-x-0 top-0 h-px"
				style={{ background: `linear-gradient(90deg, transparent, ${map.bar}80, transparent)` }}
			/>
			<p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400">
				{label}
			</p>
			<p className={`text-mono text-3xl font-bold mt-2 ${map.text}`}>
				{value}
				<span className="text-base text-slate-500 ml-1.5 font-normal">{unit}</span>
			</p>
		</div>
	);
}
