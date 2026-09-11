'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => { setTimeout(() => setMounted(true), 0); }, []);
	if (!mounted) {
		return <div className="w-9 h-9" aria-hidden />;
	}

	const isDark = (theme ?? resolvedTheme) !== 'light';

	return (
		<button
			type="button"
			aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
			title={isDark ? 'Light mode' : 'Dark mode'}
			onClick={() => setTheme(isDark ? 'light' : 'dark')}
			className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-white/5 hover:bg-cyan-500/10 hover:border-cyan-400/40 text-slate-300 hover:text-cyan-300 transition-colors">
			{isDark ? (
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
				</svg>
			) : (
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
					<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
				</svg>
			)}
		</button>
	);
}
