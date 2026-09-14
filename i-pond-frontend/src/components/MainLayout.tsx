'use client';

import ThemeToggle from '@/components/ThemeToggle';
import LicenseBanner from '@/components/LicenseBanner';
import SyncStatus from '@/components/SyncStatus';
import { useSystemHealth } from '@/hooks/useSystemHealth';
import { useUnreadCount } from '@/hooks/useAlerts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { ReactNode, useEffect, useState } from 'react';

interface LayoutProps {
	children: ReactNode;
}

const ICONS = {
	dashboard: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<rect x="3" y="3" width="7" height="9" rx="1.5" />
			<rect x="14" y="3" width="7" height="5" rx="1.5" />
			<rect x="14" y="12" width="7" height="9" rx="1.5" />
			<rect x="3" y="16" width="7" height="5" rx="1.5" />
		</svg>
	),
	reports: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<path d="M3 3v18h18" />
			<path d="M7 14l4-4 4 4 5-6" />
		</svg>
	),
	thresholds: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<line x1="4" y1="6" x2="14" y2="6" />
			<circle cx="17" cy="6" r="2.5" />
			<line x1="4" y1="12" x2="8" y2="12" />
			<circle cx="11" cy="12" r="2.5" />
			<line x1="14" y1="12" x2="20" y2="12" />
			<line x1="4" y1="18" x2="16" y2="18" />
			<circle cx="19" cy="18" r="2.5" />
		</svg>
	),
	users: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</svg>
	),
	logs: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline points="14 2 14 8 20 8" />
			<line x1="8" y1="13" x2="16" y2="13" />
			<line x1="8" y1="17" x2="16" y2="17" />
			<line x1="8" y1="9" x2="10" y2="9" />
		</svg>
	),
	bell: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
			<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
		</svg>
	),
	utilization: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<rect x="3" y="10" width="4" height="11" rx="1" />
			<rect x="10" y="6" width="4" height="15" rx="1" />
			<rect x="17" y="13" width="4" height="8" rx="1" />
		</svg>
	),
	appliance: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
			<rect x="3" y="4" width="18" height="12" rx="2" />
			<path d="M8 20h8M12 16v4" />
		</svg>
	),
} as const;

const HEALTH_STYLES: Record<
	'live' | 'offline' | 'loading',
	{ bg: string; border: string; text: string; dot: string }
> = {
	live: {
		bg: 'bg-emerald-500/10',
		border: 'border-emerald-500/25',
		text: 'text-emerald-300',
		dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]',
	},
	offline: {
		bg: 'bg-rose-500/10',
		border: 'border-rose-500/25',
		text: 'text-rose-300',
		dot: 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.7)]',
	},
	loading: {
		bg: 'bg-slate-500/10',
		border: 'border-slate-500/25',
		text: 'text-slate-300',
		dot: 'bg-slate-400',
	},
};

export default function MainLayout({ children }: LayoutProps) {
	const pathname = usePathname();
	const health = useSystemHealth();
	const unread = useUnreadCount();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [lastPath, setLastPath] = useState(pathname);

	if (lastPath !== pathname) {
		setLastPath(pathname);
		setDrawerOpen(false);
	}

	useEffect(() => {
		if (drawerOpen) document.body.style.overflow = 'hidden';
		else document.body.style.overflow = '';
		return () => { document.body.style.overflow = ''; };
	}, [drawerOpen]);

	type NavItem = {
		href: string;
		label: string;
		icon: keyof typeof ICONS;
		badge?: number;
	};
	const navItems: NavItem[] = [
		{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
		{ href: '/reports', label: 'Reports', icon: 'reports' },
		{ href: '/utilization', label: 'Utilization', icon: 'utilization' },
		{ href: '/settings/thresholds', label: 'Thresholds', icon: 'thresholds' },
		{
			href: '/notifications',
			label: 'Notifications',
			icon: 'bell',
			badge: unread.total,
		},
		{ href: '/admin/logs', label: 'Ingestion Logs', icon: 'logs' },
		{ href: '/settings/appliance', label: 'Appliance', icon: 'appliance' },
	];

	const SidebarContent = (
		<>
			<div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-cyan-400/30 to-transparent pointer-events-none" />

			<div className="px-6 pt-6 pb-5 border-b border-[var(--border)]">
				<div className="flex items-center gap-3">
					<div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/30 to-emerald-500/20 border border-cyan-400/40 flex items-center justify-center">
						<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
							<path d="M12 2.5C8 8 5 11 5 14.5a7 7 0 0 0 14 0c0-3.5-3-6.5-7-12Z" />
						</svg>
						<span
							className={`absolute -top-1 -right-1 inline-block w-2 h-2 rounded-full ${HEALTH_STYLES[health.state].dot} ${health.state === 'live' ? 'animate-[pulse-dot_1.6s_ease-in-out_infinite]' : ''}`}
						/>
					</div>
					<div>
						<h1 className="text-lg font-bold tracking-tight text-white">See ME</h1>
						<p className="text-[11px] text-slate-400 -mt-0.5">Aquaculture Control</p>
					</div>
				</div>
				<div
					title={health.detail}
					className={`mt-4 flex items-center gap-2 px-2.5 py-1.5 rounded-md border w-fit ${HEALTH_STYLES[health.state].bg} ${HEALTH_STYLES[health.state].border}`}>
					<span
						className={`inline-block w-2 h-2 rounded-full ${HEALTH_STYLES[health.state].dot} ${health.state === 'live' ? 'animate-[pulse-dot_1.6s_ease-in-out_infinite]' : ''}`}
					/>
					<span
						className={`text-[11px] font-semibold tracking-wide ${HEALTH_STYLES[health.state].text}`}>
						{health.label}
					</span>
				</div>
				<p className="mt-1.5 text-[10px] text-slate-500 font-mono truncate">
					{health.detail}
				</p>
			</div>

			<nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
				<p className="px-3 pb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
					Navigation
				</p>
				{navItems.map((item) => {
					const active =
						pathname === item.href ||
						(item.href !== '/dashboard' && pathname?.startsWith(item.href));
					return (
						<Link
							key={item.href}
							href={item.href}
							className={`group relative flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-lg text-sm font-medium transition-all ${
								active
									? 'bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-300 border border-cyan-400/30'
									: 'text-slate-400 hover:text-slate-100 hover:bg-white/5 border border-transparent'
							}`}>
							{active && (
								<span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)]" />
							)}
							<span className={active ? 'text-cyan-300' : 'text-slate-500 group-hover:text-slate-200'}>
								{ICONS[item.icon]}
							</span>
							<span className="flex-1">{item.label}</span>
							{item.badge !== undefined && item.badge > 0 && (
								<span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[10px] font-bold bg-rose-500/25 text-rose-200 border border-rose-400/40">
									{item.badge > 99 ? '99+' : item.badge}
								</span>
							)}
						</Link>
					);
				})}
			</nav>

			<div className="border-t border-[var(--border)] p-4 pb-safe space-y-3">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<p className="text-sm font-semibold text-white truncate">Local Appliance</p>
						<p className="text-[11px] text-slate-400 truncate">On-site monitoring</p>
					</div>
					<ThemeToggle />
				</div>
				<SyncStatus />
			</div>
		</>
	);

	return (
		<div className="flex flex-col md:flex-row min-h-screen md:h-screen bg-transparent text-slate-100">
			{/* Mobile top bar */}
			<header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] backdrop-blur-xl pt-safe">
				<button
					type="button"
					aria-label="Open menu"
					onClick={() => setDrawerOpen(true)}
					className="p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] text-slate-300">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
						<line x1="3" y1="6" x2="21" y2="6" />
						<line x1="3" y1="12" x2="21" y2="12" />
						<line x1="3" y1="18" x2="21" y2="18" />
					</svg>
				</button>
				<div className="flex items-center gap-2">
					<div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/30 to-emerald-500/20 border border-cyan-400/40 flex items-center justify-center">
						<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
							<path d="M12 2.5C8 8 5 11 5 14.5a7 7 0 0 0 14 0c0-3.5-3-6.5-7-12Z" />
						</svg>
					</div>
					<h1 className="text-base font-bold tracking-tight text-white">See ME</h1>
				</div>
				<ThemeToggle />
			</header>

			{/* Desktop sidebar */}
			<aside className="hidden md:flex w-72 shrink-0 relative border-r border-[var(--border)] bg-[rgba(10,15,31,0.7)] backdrop-blur-xl flex-col">
				{SidebarContent}
			</aside>

			{/* Mobile drawer */}
			{drawerOpen && (
				<div
					className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
					onClick={() => setDrawerOpen(false)}
					aria-hidden="true"
				/>
			)}
			<aside
				className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-[var(--border)] bg-[var(--bg-surface)] backdrop-blur-xl flex flex-col transform transition-transform duration-200 ease-out ${
					drawerOpen ? 'translate-x-0' : '-translate-x-full'
				}`}
				aria-hidden={!drawerOpen}>
				<div className="flex justify-end px-3 pt-3">
					<button
						type="button"
						aria-label="Close menu"
						onClick={() => setDrawerOpen(false)}
						className="p-2 rounded-lg text-slate-300 hover:bg-white/5">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
				{SidebarContent}
			</aside>

			<main className="flex-1 overflow-auto pb-safe">
				<LicenseBanner />
				<div className="px-4 py-5 md:px-8 md:py-8 max-w-[1600px] mx-auto">{children}</div>
			</main>
		</div>
	);
}
