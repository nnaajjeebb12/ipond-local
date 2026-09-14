export type PondStatus = 'online' | 'stale' | 'offline';

export function getPondStatus(
  lastSeenMs: number | null,
  nowMs: number = Date.now()
): PondStatus {
  if (!lastSeenMs) return 'offline';
  const mins = (nowMs - lastSeenMs) / 1000 / 60;
  if (mins < 16) return 'online';
  if (mins < 20) return 'stale';
  return 'offline';
}

export const STATUS_DOT_BG: Record<PondStatus, string> = {
  online: 'bg-emerald-400',
  stale: 'bg-amber-400',
  offline: 'bg-rose-500',
};

export const STATUS_DOT_GLOW: Record<PondStatus, string> = {
  online: 'shadow-[0_0_10px_rgba(52,211,153,0.7)]',
  stale: 'shadow-[0_0_10px_rgba(251,191,36,0.7)]',
  offline: 'shadow-[0_0_10px_rgba(244,63,94,0.7)]',
};

export const STATUS_LABEL: Record<PondStatus, string> = {
  online: 'Online',
  stale: 'Stale',
  offline: 'Offline',
};

export const fmt = (v: number | null | undefined): string =>
  v != null && Number.isFinite(v) ? Number(v).toFixed(2) : '—';
