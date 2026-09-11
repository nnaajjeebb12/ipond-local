export function LoadingSpinner() {
	return (
		<div className="flex flex-col justify-center items-center h-64 gap-3">
			<div className="spinner-cyan" />
			<p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">
				Loading
			</p>
		</div>
	);
}

interface ErrorMessageProps {
	message: string;
}

export function ErrorMessage({ message }: ErrorMessageProps) {
	return (
		<div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 backdrop-blur-sm flex items-start gap-3">
			<div className="shrink-0 w-9 h-9 rounded-lg bg-rose-500/20 flex items-center justify-center">
				<svg viewBox="0 0 24 24" fill="none" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
			</div>
			<div>
				<p className="text-rose-300 font-semibold text-sm">Error</p>
				<p className="text-rose-200/80 text-sm mt-0.5">{message}</p>
			</div>
		</div>
	);
}

import Link from 'next/link';

interface BackButtonProps {
	href?: string;
	label?: string;
}

export function BackButton({
	href = '/dashboard',
	label = '← Back',
}: BackButtonProps) {
	return (
		<Link
			href={href}
			className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 text-sm font-medium mb-4 transition-colors group">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 transition-transform group-hover:-translate-x-0.5">
				<line x1="19" y1="12" x2="5" y2="12" />
				<polyline points="12 19 5 12 12 5" />
			</svg>
			<span>{label.replace(/^←\s*/, '')}</span>
		</Link>
	);
}
