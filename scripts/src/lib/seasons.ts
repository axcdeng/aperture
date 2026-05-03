// Mirror of /web/lib/seasons.ts — kept as a small copy so the scripts
// package doesn't need to import from the web app.
export type SeasonId = 'high-stakes' | 'push-back' | 'unknown';

interface Season {
  id: SeasonId;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
}

export const SEASONS: Record<SeasonId, Season> = {
  'high-stakes': {
    id: 'high-stakes',
    name: 'High Stakes',
    startDate: '2024-05-01',
    endDate: '2025-04-30',
    color: '#f59e0b',
  },
  'push-back': {
    id: 'push-back',
    name: 'Push Back',
    startDate: '2025-05-01',
    endDate: '2026-04-30',
    color: '#3b82f6',
  },
  unknown: {
    id: 'unknown',
    name: 'Unknown',
    startDate: '1970-01-01',
    endDate: '1970-01-01',
    color: '#5f5f5f',
  },
};

export function seasonForDate(iso: string | Date): SeasonId {
  const d = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  for (const s of Object.values(SEASONS)) {
    if (s.id === 'unknown') continue;
    const start = new Date(s.startDate).getTime();
    const end = new Date(s.endDate).getTime();
    if (d >= start && d <= end) return s.id;
  }
  return 'unknown';
}
