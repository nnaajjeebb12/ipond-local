'use client';

import { BackButton, ErrorMessage, LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import SensorCard from '@/components/SensorCard';
import { useLatestReading, usePond } from '@/hooks/useApi';
import { usePondStatuses } from '@/hooks/useDashboardStats';
import { useThresholds } from '@/hooks/useThresholds';
import { STATUS_DOT_BG, STATUS_DOT_GLOW, STATUS_LABEL } from '@/lib/pondStatus';
import Link from 'next/link';
import { use } from 'react';

interface PondDashboardProps {
	params: Promise<{ pondId: string }>;
}

const SENSOR_CONFIG = [
	{ type: 'temperature', label: 'Temperature', icon: '🌡️' },
	{ type: 'ph', label: 'pH Level', icon: '⚗️' },
	{ type: 'dox', label: 'Dissolved Oxygen', icon: '💨' },
	{ type: 'salinity', label: 'Salinity', icon: '🧂' },
];

export default function PondDashboardPage({ params }: PondDashboardProps) {
	const { pondId } = use(params);
	const { pond, isLoading: isPondLoading, error: pondError } = usePond(pondId);
	const { byId: statusByPondId } = usePondStatuses();
	const status = statusByPondId.get(pondId);
	const { lookup } = useThresholds(pondId);

	if (pondError)
		return (
			<MainLayout>
				<ErrorMessage message="Failed to load pond details" />
			</MainLayout>
		);
	if (isPondLoading)
		return (
			<MainLayout>
				<LoadingSpinner />
			</MainLayout>
		);
	if (!pond)
		return (
			<MainLayout>
				<ErrorMessage message="Pond not found" />
			</MainLayout>
		);

	return (
		<MainLayout>
			<div className="space-y-8">
				<div>
					<BackButton href="/dashboard" label="Back to Ponds" />
					<div className="flex items-end justify-between flex-wrap gap-4 mt-2">
						<div>
							<div className="flex items-center gap-2 mb-2">
								{(() => {
									const key = status?.status ?? 'offline';
									const animate = key === 'online';
									return (
										<>
											<span
												className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT_BG[key]} ${STATUS_DOT_GLOW[key]} ${animate ? 'animate-[pulse-dot_1.6s_ease-in-out_infinite]' : ''}`}
											/>
											<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-[var(--text-secondary)]">
												{STATUS_LABEL[key]} · Pond #{pond.id}
											</span>
										</>
									);
								})()}
							</div>
							<h1 className="text-4xl font-bold text-white tracking-tight">
								{pond.name}
							</h1>
							<p className="text-slate-400 mt-1.5 text-sm">{pond.location}</p>
						</div>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
					<MetaCard
						label="Location"
						value={pond.location}
						icon={
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
								<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
								<circle cx="12" cy="10" r="3" />
							</svg>
						}
					/>
					<MetaCard
						label="Capacity"
						value={`${(pond.capacity / 1000).toFixed(1)}k L`}
						icon={
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
								<path d="M12 2L4 12s2 8 8 8 8-8 8-8L12 2z" />
							</svg>
						}
					/>
					<MetaCard
						label="Surface Area"
						value={`${pond.area.toFixed(1)} m²`}
						icon={
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
								<rect x="3" y="3" width="18" height="18" rx="2" />
								<path d="M3 9h18M9 21V9" />
							</svg>
						}
					/>
				</div>

				<div>
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
							Real-Time Sensors
						</h2>
						<span className="text-[10px] text-slate-500 font-mono">
							tap card for trends
						</span>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-3">
						{SENSOR_CONFIG.map((sensor) => (
							<Link
								key={sensor.type}
								href={`/dashboard/${pondId}/${sensor.type}`}
								className="block">
								<SensorCardWithData
									pondId={pondId}
									sensorType={sensor.type}
									title={sensor.label}
									icon={sensor.icon}
									optimal={lookup(sensor.type)}
								/>
							</Link>
						))}
					</div>
				</div>
			</div>
		</MainLayout>
	);
}

function MetaCard({
	label,
	value,
	icon,
}: {
	label: string;
	value: string;
	icon: React.ReactNode;
}) {
	return (
		<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-5">
			<div className="flex items-start justify-between">
				<div>
					<p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400">
						{label}
					</p>
					<p className="text-xl font-semibold text-white mt-1.5">{value}</p>
				</div>
				<div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-400/20 text-cyan-300 flex items-center justify-center">
					{icon}
				</div>
			</div>
		</div>
	);
}

function SensorCardWithData({
	pondId,
	sensorType,
	title,
	icon,
	optimal,
}: {
	pondId: string;
	sensorType: string;
	title: string;
	icon: string;
	optimal?: { min: number; max: number };
}) {
	const { reading, isLoading } = useLatestReading(pondId, sensorType);
	return (
		<SensorCard
			title={title}
			reading={reading}
			icon={icon}
			optimal={optimal}
			isLoading={isLoading}
		/>
	);
}
