/**
 * A no-Google sync's snapshot. The cloud builds one from a pull and keeps the previous
 * values of any dataset that failed (lib/db/snapshots.ts, saveFullSnapshot); a browser
 * signed in without Google does the same with its own copy. Pure: the server builds,
 * the browser keeps.
 */
import type { ClientSnapshot } from './db/snapshots';
import type { Dataset, FullSyncData } from './erp/full-sync';
import { termFromIds, type TermOptions } from './terms';

/** Carries the refreshed sealed ERP session back to the browser on every local answer. */
export const LOCAL_ERP_HEADER = 'X-Attenly-Erp';

/** A year and semester as the ERP's forms take them. */
export interface TermIds {
  academicyear: string;
  semesterid: string;
}

const TERM_ID = /^[A-Za-z0-9 _-]{1,32}$/;

/** `value` when it is a well-formed year and semester, else null. */
export function termIdsOf(value: unknown): TermIds | null {
  const t = value as { academicyear?: unknown; semesterid?: unknown } | null;
  if (!t || typeof t.academicyear !== 'string' || typeof t.semesterid !== 'string') return null;
  if (!TERM_ID.test(t.academicyear) || !TERM_ID.test(t.semesterid)) return null;
  return { academicyear: t.academicyear, semesterid: t.semesterid };
}

export function sameTerm(a: { academicyear?: string; semesterid?: string } | null | undefined, b: { academicyear?: string; semesterid?: string } | null | undefined): boolean {
  return Boolean(a && b && a.academicyear === b.academicyear && a.semesterid === b.semesterid);
}

/** What one pull from the ERP looks like to the browser, before anything older is kept. */
export function snapshotFromPull(universityId: string, data: FullSyncData, termOptions?: TermOptions | null): ClientSnapshot {
  const options = termOptions ?? null;
  const term = data.term.yearLabel || !options ? data.term : { ...termFromIds(data.term, options), semester: data.term.semester || termFromIds(data.term, options).semester };
  return {
    universityId,
    term,
    syncedAt: data.syncedAt,
    attendance: data.attendance,
    timetable: data.timetable,
    internals: data.internals,
    results: data.results,
    cgpaRows: data.cgpaRows,
    cgpa: data.cgpa,
    sgpaTerms: data.sgpaTerms,
    feeOrders: data.feeOrders,
    classes: data.classes,
    termOptions: options,
    issues: data.issues ?? {},
    attendanceSyncedAt: data.failed.includes('attendance') ? null : data.syncedAt,
  };
}

/**
 * The new snapshot, with every dataset that failed this pull carried over from the
 * previous one when both are the same term, so a flaky ERP page never blanks good data.
 */
export function keepFailed(previous: ClientSnapshot | null, next: ClientSnapshot, failed: readonly Dataset[]): ClientSnapshot {
  if (!previous || previous.universityId !== next.universityId) return next;
  const kept = (d: Dataset) => failed.includes(d);
  if (!sameTerm(previous.term, next.term)) {
    // CGPA and fee orders belong to the account, not the term: keep them across a term change.
    return {
      ...next,
      cgpaRows: kept('cgpa') ? previous.cgpaRows : next.cgpaRows,
      cgpa: kept('cgpa') ? previous.cgpa : next.cgpa,
      sgpaTerms: kept('cgpa') ? previous.sgpaTerms : next.sgpaTerms,
      feeOrders: kept('fees') ? previous.feeOrders : next.feeOrders,
      termOptions: next.termOptions ?? previous.termOptions,
    };
  }
  return {
    ...next,
    attendance: kept('attendance') ? previous.attendance : next.attendance,
    // Kept attendance is only as new as the sync that last read it.
    attendanceSyncedAt: kept('attendance') ? previous.attendanceSyncedAt : next.attendanceSyncedAt,
    timetable: kept('timetable') ? previous.timetable : next.timetable,
    internals: kept('internals') ? previous.internals : next.internals,
    results: kept('results') ? previous.results : next.results,
    cgpaRows: kept('cgpa') ? previous.cgpaRows : next.cgpaRows,
    cgpa: kept('cgpa') ? previous.cgpa : next.cgpa,
    sgpaTerms: kept('cgpa') ? previous.sgpaTerms : next.sgpaTerms,
    feeOrders: kept('fees') ? previous.feeOrders : next.feeOrders,
    classes: kept('registers') ? previous.classes : next.classes,
    termOptions: next.termOptions ?? previous.termOptions,
  };
}
