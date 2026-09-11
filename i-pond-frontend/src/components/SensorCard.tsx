import { SensorReading } from '@/types';
import { fmt } from '@/lib/pondStatus';
import React from 'react';

interface SensorCardProps {
	title: string;
	reading: SensorReading | null;
	icon: React.ReactNode;
	optimal?: { min: number; max: number };
	isLoading?: boolean;
}

export default function SensorCard({
	title,
	reading,
	icon,
	optimal,
	isLoading,
}: SensorCardProps) {
	const getStatus = () => {
		if (!reading) return 'idle';
		if (!optimal) return 'live';
		if (reading.value < optimal.min || reading.value > optimal.max) return 'alert';
		return 'optimal';
	};

	const status = getStatus();

	const palette = {
		idle: {
			ring: 'border-[var(--border)]',
			glow: '',
			text: 'text-slate-400',
			pillBg: 'bg-slate-500/10',
			pillBorder: 'border-slate-500/30',
			pillText: 'text-slate-300',
			label: 'IDLE',
			accent: '#94a3b8',
		},
		live: {
			ring: 'border-cyan-400/30',
			glow: 'shadow-[0_0_30px_-12px_rgba(34,211,238,0.4)]',
			text: 'text-cyan-300',
			pillBg: 'bg-cyan-500/10',
			pillBorder: 'border-cyan-400/30',
			pillText: 'text-cyan-300',
			label: 'LIVE',
			accent: '#22d3ee',
		},
		optimal: {
			ring: 'border-emerald-400/30',
			glow: 'shadow-[0_0_30px_-12px_rgba(52,211,153,0.45)]',
			text: 'text-emerald-300',
			pillBg: 'bg-emerald-500/10',
			pillBorder: 'border-emerald-400/30',
			pillText: 'text-emerald-300',
			label: 'OPTIMAL',
			accent: '#34d399',
		},
		alert: {
			ring: 'border-rose-400/40',
			glow: 'shadow-[0_0_30px_-10px_rgba(244,63,94,0.55)]',
			text: 'text-rose-300',
			pillBg: 'bg-rose-500/10',
			pillBorder: 'border-rose-400/30',
			pillText: 'text-rose-300',
			label: 'ALERT',
			accent: '#fb7185',
		},
	}[status];

	return (
		<div
			className={`relative rounded-xl border p-5 bg-gradient-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 ${palette.ring} ${palette.glow}`}>
			<div
				className="pointer-events-none absolute inset-x-0 top-0 h-px"
				style={{ background: `linear-gradient(90deg, transparent, ${palette.accent}, transparent)` }}
			/>

			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<p className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
							{title}
						</p>
						<span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${palette.pillBg} ${palette.pillBorder} ${palette.pillText}`}>
							{palette.label}
						</span>
					</div>

					{isLoading ? (
						<div className="mt-3 h-10 w-32 bg-white/5 rounded animate-pulse" />
					) : reading ? (
						<p className={`text-mono text-4xl font-bold mt-2 ${palette.text}`}>
							{fmt(reading.value)}
							<span className="text-xl ml-1 text-slate-400 font-normal">{reading.unit}</span>
						</p>
					) : (
						<p className="text-2xl mt-2 text-slate-500 font-mono">— —</p>
					)}

					{optimal && (
						<p className="text-[11px] text-slate-500 mt-2 font-mono">
							OPT&nbsp;{fmt(optimal.min)}&ndash;{fmt(optimal.max)}&nbsp;{reading?.unit ?? ''}
						</p>
					)}
				</div>
				<div
					className="text-3xl shrink-0 w-11 h-11 rounded-lg flex items-center justify-center"
					style={{
						backgroundColor: palette.accent + '12',
						border: `1px solid ${palette.accent}30`,
					}}>
					{icon}
				</div>
			</div>

			{reading && (
				<div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
					<span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
						Updated
					</span>
					<span className="text-xs text-slate-400 font-mono">
						{new Date(reading.timestamp).toLocaleTimeString()}
					</span>
				</div>
			)}
		</div>
	);
}
