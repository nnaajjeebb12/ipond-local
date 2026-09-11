'use client';

import { ErrorMessage, LoadingSpinner } from '@/components/Common';
import MainLayout from '@/components/MainLayout';
import {
	AllReadingRow,
	AllReadingsScope,
	fetchAllReadings,
	RawReadingsQuery,
	usePonds,
	useRawReadings,
} from '@/hooks/useApi';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

type Preset = 'today' | '7d' | '14d' | '30d';
type RangeMode = 'preset' | 'custom';
type ScopeMode = 'all' | 'select';

interface ReportFormData {
	pondId: string;
	sensorType: string;
	rangeMode: RangeMode;
	preset: Preset;
	customFrom: string;
	customTo: string;
}

const SENSOR_TYPES = [
	{ value: 'temperature', label: 'Temperature' },
	{ value: 'ph', label: 'pH Level' },
	{ value: 'dox', label: 'Dissolved Oxygen' },
	{ value: 'salinity', label: 'Salinity' },
];

const PRESETS: { value: Preset; label: string }[] = [
	{ value: 'today', label: 'Today' },
	{ value: '7d', label: 'Last 7 Days' },
	{ value: '14d', label: 'Last 14 Days' },
	{ value: '30d', label: 'Last 30 Days' },
];

const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 3600 * 1000;
const APP_TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || undefined;

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
	return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function presetLabel(preset: Preset): string {
	return PRESETS.find((p) => p.value === preset)?.label ?? preset;
}

function formatTs(ts: number): string {
	return new Date(ts).toLocaleString('en-PH', { timeZone: APP_TZ });
}

function validateCustom(from: string, to: string): string | null {
	if (!from || !to) return 'Pick both dates';
	const f = Date.parse(`${from}T00:00:00Z`);
	const t = Date.parse(`${to}T00:00:00Z`);
	if (!Number.isFinite(f) || !Number.isFinite(t)) return 'Invalid date';
	if (t < f) return 'To date is before From';
	const span = Math.round((t - f) / MS_PER_DAY);
	if (span > MAX_RANGE_DAYS) return `Max range is ${MAX_RANGE_DAYS} days`;
	return null;
}

export default function ReportsPage() {
	const { ponds, isLoading: isPondsLoading } = usePonds();
	const [selectedValues, setSelectedValues] = useState<ReportFormData | null>(
		null,
	);

	const { register, handleSubmit, control, setValue } = useForm<ReportFormData>({
		defaultValues: {
			pondId: '',
			sensorType: 'temperature',
			rangeMode: 'preset',
			preset: '7d',
			customFrom: isoDaysAgo(7),
			customTo: todayIso(),
		},
	});

	const { rangeMode, preset: activePreset, customFrom = '', customTo = '' } = useWatch({ control });

	const customError = useMemo(() => {
		if (rangeMode !== 'custom') return null;
		return validateCustom(customFrom, customTo);
	}, [rangeMode, customFrom, customTo]);

	const rawQuery: RawReadingsQuery | null = useMemo(() => {
		if (!selectedValues) return null;
		if (selectedValues.rangeMode === 'preset') {
			return { mode: 'preset', preset: selectedValues.preset };
		}
		return {
			mode: 'custom',
			from: selectedValues.customFrom,
			to: selectedValues.customTo,
		};
	}, [selectedValues]);

	const { readings, isLoading: isReadingsLoading, error: readingsError } =
		useRawReadings(
			selectedValues?.pondId || '',
			selectedValues?.sensorType || '',
			rawQuery,
		);

	const periodLabel = (v: ReportFormData) =>
		v.rangeMode === 'preset'
			? presetLabel(v.preset)
			: `${v.customFrom} → ${v.customTo}`;

	const selectedPond = ponds?.find((p) => p.id === selectedValues?.pondId);
	const selectedSensorLabel =
		SENSOR_TYPES.find((s) => s.value === selectedValues?.sensorType)?.label ??
		'';

	const handleGeneratePDF = () => {
		if (!selectedValues || !readings) return;
		const pdf = new jsPDF();
		pdf.setFontSize(20);
		pdf.text(`${selectedSensorLabel} Report - ${selectedPond?.name}`, 15, 15);
		pdf.setFontSize(10);
		pdf.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 25);
		pdf.text(`Location: ${selectedPond?.location ?? ''}`, 15, 30);
		pdf.text(`Period: ${periodLabel(selectedValues)}`, 15, 35);
		pdf.text(`Records: ${readings.length}`, 15, 40);
		const tableData = readings.map((r) => [
			formatTs(r.timestamp),
			selectedPond?.name ?? '',
			selectedSensorLabel,
			r.value.toFixed(2),
			`${r.unit}`,
		]);
		autoTable(pdf, {
			head: [['Time', 'Pond', 'Sensor', 'Value', 'Unit']],
			body: tableData,
			startY: 48,
			theme: 'grid',
			styles: { fontSize: 8 },
			didDrawPage: (data) => {
				const pageSize = pdf.internal.pageSize;
				pdf.setFontSize(8);
				pdf.text(
					`Page ${data.pageNumber}`,
					pageSize.getWidth() / 2,
					pageSize.getHeight() - 10,
					{ align: 'center' },
				);
			},
		});
		pdf.save(
			`${selectedSensorLabel}_${selectedPond?.name}_${todayIso()}.pdf`,
		);
	};

	const handleGenerateCSV = () => {
		if (!selectedValues || !readings) return;
		const csvContent = [
			['Time', 'Pond', 'Sensor', 'Value', 'Unit'],
			...readings.map((r) => [
				formatTs(r.timestamp),
				selectedPond?.name ?? '',
				selectedSensorLabel,
				r.value.toFixed(2),
				r.unit,
			]),
		]
			.map((row) => row.map((cell) => `"${cell}"`).join(','))
			.join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${selectedSensorLabel}_${selectedPond?.name}_${todayIso()}.csv`;
		a.click();
		window.URL.revokeObjectURL(url);
	};

	const onSubmit = (data: ReportFormData) => {
		if (data.rangeMode === 'custom' && customError) return;
		setSelectedValues(data);
	};

	const inputCls =
		'w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 text-slate-100 transition-colors';
	const labelCls =
		'block text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-1.5';
	const pillBase =
		'px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors';
	const pillIdle =
		'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10';
	const pillActive =
		'bg-cyan-400/15 border-cyan-400/40 text-cyan-200';

	return (
		<MainLayout>
			<div className="space-y-8">
				<div>
					<div className="flex items-center gap-2 mb-2">
						<svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" className="w-4 h-4">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
							<polyline points="14 2 14 8 20 8" />
						</svg>
						<span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-cyan-300">
							Export Center
						</span>
					</div>
					<h1 className="text-4xl font-bold text-white tracking-tight">Reports</h1>
					<p className="text-slate-400 mt-1.5 text-sm">
						Generate PDF and CSV reports
					</p>
				</div>

				<ExportAllSection ponds={ponds} />

				<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-6">
					<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400 mb-5">
						Single Sensor Report
					</h2>

					{isPondsLoading ? (
						<LoadingSpinner />
					) : (
						<form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<label htmlFor="pondId" className={labelCls}>Pond</label>
									<select
										id="pondId"
										{...register('pondId', { required: 'Select a pond' })}
										className={inputCls}>
										<option value="">Choose a pond…</option>
										{ponds?.map((pond) => (
											<option key={pond.id} value={pond.id}>
												{pond.name} - {pond.location}
											</option>
										))}
									</select>
								</div>
								<div>
									<label htmlFor="sensorType" className={labelCls}>Sensor</label>
									<select id="sensorType" {...register('sensorType')} className={inputCls}>
										{SENSOR_TYPES.map((s) => (
											<option key={s.value} value={s.value}>
												{s.label}
											</option>
										))}
									</select>
								</div>
							</div>

							<div>
								<label className={labelCls}>Date Range</label>
								<div className="flex flex-wrap gap-2">
									{PRESETS.map((p) => {
										const isActive =
											rangeMode === 'preset' && activePreset === p.value;
										return (
											<button
												key={p.value}
												type="button"
												onClick={() => {
													setValue('rangeMode', 'preset');
													setValue('preset', p.value);
												}}
												className={`${pillBase} ${isActive ? pillActive : pillIdle}`}>
												{p.label}
											</button>
										);
									})}
									<button
										type="button"
										onClick={() => setValue('rangeMode', 'custom')}
										className={`${pillBase} ${rangeMode === 'custom' ? pillActive : pillIdle}`}>
										Custom
									</button>
								</div>
							</div>

							{rangeMode === 'custom' && (
								<div className="space-y-2">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div>
											<label htmlFor="customFrom" className={labelCls}>From</label>
											<input
												id="customFrom"
												type="date"
												max={customTo || todayIso()}
												{...register('customFrom')}
												className={inputCls}
											/>
										</div>
										<div>
											<label htmlFor="customTo" className={labelCls}>To</label>
											<input
												id="customTo"
												type="date"
												min={customFrom || undefined}
												max={todayIso()}
												{...register('customTo')}
												className={inputCls}
											/>
										</div>
									</div>
									<p className="text-[11px] text-slate-500">
										Max range: {MAX_RANGE_DAYS} days
									</p>
									{customError && (
										<p className="text-xs text-rose-400 font-semibold">{customError}</p>
									)}
								</div>
							)}

							<button
								type="submit"
								disabled={rangeMode === 'custom' && !!customError}
								className="px-5 py-2.5 bg-linear-to-r from-cyan-500 to-emerald-500 text-slate-950 font-semibold rounded-lg hover:shadow-[0_0_30px_-5px_rgba(34,211,238,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
								Load Report Data →
							</button>
						</form>
					)}
				</div>

				{readingsError && <ErrorMessage message="Failed to load readings" />}

				{selectedValues && isReadingsLoading && <LoadingSpinner />}

				{selectedValues && readings && readings.length === 0 && !isReadingsLoading && (
					<div className="rounded-xl border border-[var(--border)] bg-white/3 p-6 text-sm text-slate-400">
						No readings in selected range.
					</div>
				)}

				{selectedValues && readings && readings.length > 0 && !isReadingsLoading && (
					<div className="space-y-6">
						<div className="flex gap-3 flex-wrap">
							<button
								onClick={handleGeneratePDF}
								className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-500/10 border border-rose-400/30 hover:bg-rose-500/20 text-rose-300 font-semibold rounded-lg transition-colors">
								<DownloadIcon /> Download PDF
							</button>
							<button
								onClick={handleGenerateCSV}
								className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-400/30 hover:bg-emerald-500/20 text-emerald-300 font-semibold rounded-lg transition-colors">
								<DownloadIcon /> Download CSV
							</button>
						</div>

						<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-6">
							<h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400 mb-4">
								Report Summary — {periodLabel(selectedValues)}
							</h3>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
								<MiniStat label="Records" value={String(readings.length)} accent="cyan" />
								<MiniStat
									label="Average"
									value={(
										readings.reduce((sum, r) => sum + r.value, 0) /
										readings.length
									).toFixed(2)}
									accent="emerald"
								/>
								<MiniStat
									label="Max"
									value={Math.max(...readings.map((r) => r.value)).toFixed(2)}
									accent="rose"
								/>
								<MiniStat
									label="Min"
									value={Math.min(...readings.map((r) => r.value)).toFixed(2)}
									accent="amber"
								/>
							</div>
						</div>

						<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm overflow-hidden">
							<div className="px-6 py-4 border-b border-white/5">
								<h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
									Data Preview (last 20 of {readings.length})
								</h3>
							</div>
							<div className="overflow-x-auto">
								<table className="w-full">
									<thead className="bg-white/3">
										<tr>
											<Th>Time</Th>
											<Th>Pond</Th>
											<Th>Sensor</Th>
											<Th>Value</Th>
											<Th>Unit</Th>
										</tr>
									</thead>
									<tbody className="divide-y divide-white/5">
										{readings
											.slice(-20)
											.reverse()
											.map((reading, idx) => (
												<tr key={idx} className="hover:bg-white/3 transition-colors">
													<td className="px-6 py-3 text-sm text-slate-300 font-mono">
														{formatTs(reading.timestamp)}
													</td>
													<td className="px-6 py-3 text-sm text-slate-300">
														{selectedPond?.name ?? '—'}
													</td>
													<td className="px-6 py-3 text-sm text-slate-300">
														{selectedSensorLabel}
													</td>
													<td className="px-6 py-3 text-sm text-white font-semibold font-mono">
														{reading.value.toFixed(2)}
													</td>
													<td className="px-6 py-3 text-sm text-slate-400">
														{reading.unit}
													</td>
												</tr>
											))}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				)}
			</div>
		</MainLayout>
	);
}

function ExportAllSection({
	ponds,
}: {
	ponds: { id: string; name: string; location: string }[] | undefined;
}) {
	const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
	const [selectedPondIds, setSelectedPondIds] = useState<string[]>([]);
	const [rangeMode, setRangeMode] = useState<RangeMode>('preset');
	const [preset, setPreset] = useState<Preset>('7d');
	const [customFrom, setCustomFrom] = useState<string>(isoDaysAgo(7));
	const [customTo, setCustomTo] = useState<string>(todayIso());
	const [busy, setBusy] = useState<null | 'csv' | 'pdf'>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const customError = useMemo(() => {
		if (rangeMode !== 'custom') return null;
		return validateCustom(customFrom, customTo);
	}, [rangeMode, customFrom, customTo]);

	const inputCls =
		'w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 text-slate-100 transition-colors';
	const labelCls =
		'block text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-400 mb-1.5';
	const pillBase =
		'px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors';
	const pillIdle =
		'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10';
	const pillActive =
		'bg-cyan-400/15 border-cyan-400/40 text-cyan-200';

	function resolveDates(): { from: string; to: string } | null {
		if (rangeMode === 'custom') {
			if (customError) return null;
			return { from: customFrom, to: customTo };
		}
		if (preset === 'today') {
			const t = todayIso();
			return { from: t, to: t };
		}
		const days = preset === '7d' ? 7 : preset === '14d' ? 14 : 30;
		return { from: isoDaysAgo(days - 1), to: todayIso() };
	}

	function resolveScope(): AllReadingsScope | null {
		if (scopeMode === 'all') return { mode: 'all' };
		if (selectedPondIds.length === 0) return null;
		return { mode: 'select', pondIds: selectedPondIds };
	}

	async function loadAll(): Promise<AllReadingRow[] | null> {
		setErrorMsg(null);
		const dates = resolveDates();
		if (!dates) {
			setErrorMsg(customError ?? 'Pick a valid date range');
			return null;
		}
		const scope = resolveScope();
		if (!scope) {
			setErrorMsg('Select at least one pond');
			return null;
		}
		try {
			const res = await fetchAllReadings(scope, dates.from, dates.to);
			if (res.data.length === 0) {
				setErrorMsg('No readings in selected range');
				return null;
			}
			return res.data;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to load';
			setErrorMsg(msg);
			return null;
		}
	}

	function fileLabel(): string {
		const dates = resolveDates();
		if (!dates) return todayIso();
		return `${dates.from}_to_${dates.to}`;
	}

	function periodLabelText(): string {
		const dates = resolveDates();
		if (!dates) return '';
		return `${dates.from} → ${dates.to}`;
	}

	const handleExportAllCSV = async () => {
		setBusy('csv');
		try {
			const rows = await loadAll();
			if (!rows) return;
			const header = [
				'Time',
				'Pond',
				'Temperature (°C)',
				'pH',
				'Salinity (ppt)',
				'Dissolved Oxygen (mg/L)',
			];
			const body = rows.map((r) => [
				formatTs(r.time),
				r.pondName,
				r.temperature !== null ? r.temperature.toFixed(2) : '',
				r.ph !== null ? r.ph.toFixed(2) : '',
				r.salinity !== null ? r.salinity.toFixed(2) : '',
				r.dissolved_oxygen !== null ? r.dissolved_oxygen.toFixed(2) : '',
			]);
			const csv = [header, ...body]
				.map((row) => row.map((cell) => `"${cell}"`).join(','))
				.join('\n');
			const blob = new Blob([csv], { type: 'text/csv' });
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `full_sensor_report_${fileLabel()}.csv`;
			a.click();
			window.URL.revokeObjectURL(url);
		} finally {
			setBusy(null);
		}
	};

	const handleExportAllPDF = async () => {
		setBusy('pdf');
		try {
			const rows = await loadAll();
			if (!rows) return;
			const pdf = new jsPDF({ orientation: 'landscape' });
			pdf.setFontSize(18);
			pdf.text(`Full Sensor Report — ${periodLabelText()}`, 15, 15);
			pdf.setFontSize(10);
			pdf.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 23);
			pdf.text(`Records: ${rows.length}`, 15, 28);
			const body = rows.map((r) => [
				formatTs(r.time),
				r.pondName,
				r.temperature !== null ? r.temperature.toFixed(2) : '—',
				r.ph !== null ? r.ph.toFixed(2) : '—',
				r.salinity !== null ? r.salinity.toFixed(2) : '—',
				r.dissolved_oxygen !== null ? r.dissolved_oxygen.toFixed(2) : '—',
			]);
			autoTable(pdf, {
				head: [['Time', 'Pond', 'Temp (°C)', 'pH', 'Salinity (ppt)', 'DO (mg/L)']],
				body,
				startY: 35,
				theme: 'grid',
				styles: { fontSize: 8 },
				didDrawPage: (data) => {
					const pageSize = pdf.internal.pageSize;
					pdf.setFontSize(8);
					pdf.text(
						`Page ${data.pageNumber}`,
						pageSize.getWidth() / 2,
						pageSize.getHeight() - 8,
						{ align: 'center' },
					);
				},
			});
			pdf.save(`full_sensor_report_${fileLabel()}.pdf`);
		} finally {
			setBusy(null);
		}
	};

	const togglePond = (id: string) => {
		setSelectedPondIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	};

	const disabledExport =
		!!busy || (rangeMode === 'custom' && !!customError);

	return (
		<div className="rounded-xl border border-[var(--border)] bg-linear-to-br from-[rgba(20,28,51,0.85)] to-[rgba(15,23,42,0.85)] backdrop-blur-sm p-6 space-y-5">
			<div>
				<h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-slate-400">
					Export All Sensors
				</h2>
				<p className="text-[12px] text-slate-500 mt-1">
					All four sensors as columns, one row per reading.
				</p>
			</div>

			<div>
				<label className={labelCls}>Ponds</label>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => setScopeMode('all')}
						className={`${pillBase} ${scopeMode === 'all' ? pillActive : pillIdle}`}>
						All Ponds
					</button>
					<button
						type="button"
						onClick={() => setScopeMode('select')}
						className={`${pillBase} ${scopeMode === 'select' ? pillActive : pillIdle}`}>
						Select Specific
					</button>
				</div>
			</div>

			{scopeMode === 'select' && (
				<div className="rounded-lg border border-white/5 bg-white/3 p-4">
					<p className={labelCls}>Pick ponds</p>
					{!ponds || ponds.length === 0 ? (
						<p className="text-xs text-slate-500">No ponds available.</p>
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
							{ponds.map((p) => (
								<label
									key={p.id}
									className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
									<input
										type="checkbox"
										checked={selectedPondIds.includes(p.id)}
										onChange={() => togglePond(p.id)}
										className="accent-cyan-400"
									/>
									<span className="truncate">
										{p.name} <span className="text-slate-500">— {p.location}</span>
									</span>
								</label>
							))}
						</div>
					)}
				</div>
			)}

			<div>
				<label className={labelCls}>Date Range</label>
				<div className="flex flex-wrap gap-2">
					{PRESETS.map((p) => {
						const isActive = rangeMode === 'preset' && preset === p.value;
						return (
							<button
								key={p.value}
								type="button"
								onClick={() => {
									setRangeMode('preset');
									setPreset(p.value);
								}}
								className={`${pillBase} ${isActive ? pillActive : pillIdle}`}>
								{p.label}
							</button>
						);
					})}
					<button
						type="button"
						onClick={() => setRangeMode('custom')}
						className={`${pillBase} ${rangeMode === 'custom' ? pillActive : pillIdle}`}>
						Custom
					</button>
				</div>
			</div>

			{rangeMode === 'custom' && (
				<div className="space-y-2">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label className={labelCls}>From</label>
							<input
								type="date"
								value={customFrom}
								onChange={(e) => setCustomFrom(e.target.value)}
								max={customTo || todayIso()}
								className={inputCls}
							/>
						</div>
						<div>
							<label className={labelCls}>To</label>
							<input
								type="date"
								value={customTo}
								onChange={(e) => setCustomTo(e.target.value)}
								min={customFrom || undefined}
								max={todayIso()}
								className={inputCls}
							/>
						</div>
					</div>
					<p className="text-[11px] text-slate-500">
						Max range: {MAX_RANGE_DAYS} days
					</p>
					{customError && (
						<p className="text-xs text-rose-400 font-semibold">{customError}</p>
					)}
				</div>
			)}

			{errorMsg && <p className="text-xs text-rose-400 font-semibold">{errorMsg}</p>}

			<div className="flex gap-3 flex-wrap pt-1">
				<button
					onClick={handleExportAllCSV}
					disabled={disabledExport}
					className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 border border-emerald-400/30 hover:bg-emerald-500/20 text-emerald-300 font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
					<DownloadIcon />
					{busy === 'csv' ? 'Exporting…' : 'Download CSV — All Sensors'}
				</button>
				<button
					onClick={handleExportAllPDF}
					disabled={disabledExport}
					className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-500/10 border border-rose-400/30 hover:bg-rose-500/20 text-rose-300 font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
					<DownloadIcon />
					{busy === 'pdf' ? 'Exporting…' : 'Download PDF — All Sensors'}
				</button>
			</div>
		</div>
	);
}

function DownloadIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</svg>
	);
}

function Th({ children }: { children: React.ReactNode }) {
	return (
		<th className="px-6 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-400">
			{children}
		</th>
	);
}

function MiniStat({
	label,
	value,
	accent,
}: {
	label: string;
	value: string;
	accent: 'cyan' | 'emerald' | 'rose' | 'amber';
}) {
	const text = {
		cyan: 'text-cyan-300',
		emerald: 'text-emerald-300',
		rose: 'text-rose-300',
		amber: 'text-amber-300',
	}[accent];
	return (
		<div className="rounded-lg bg-white/3 border border-white/5 p-4">
			<p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-slate-500">
				{label}
			</p>
			<p className={`text-mono text-2xl font-bold mt-1 ${text}`}>{value}</p>
		</div>
	);
}
