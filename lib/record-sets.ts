/**
 * The ERP screens read on demand (lib/erp/records.ts) and how long a copy of each
 * stays good. Shared by the server's cache and the browser's, so it imports nothing.
 */
export type RecordSet = 'marks' | 'papers' | 'profile' | 'fees' | 'circulars' | 'courses';

export const RECORD_SETS: readonly RecordSet[] = ['marks', 'papers', 'profile', 'fees', 'circulars', 'courses'];

/** How long a cached set is served without asking the ERP again. */
export const RECORD_MAX_AGE: Record<RecordSet, number> = {
  marks: 20 * 60_000,
  papers: 6 * 3600_000,
  profile: 6 * 3600_000,
  fees: 60 * 60_000,
  circulars: 30 * 60_000,
  courses: 6 * 3600_000,
};
