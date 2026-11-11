import { getDb } from './mongo';
import type { FullSyncData, SyncTerm } from '../erp/full-sync';
import type { SubjectAttendance } from '../math';
import type { CgpaRow, ClassRecord, FeeOrder, InternalRow, ResultRow, TimetableDay } from '../erp/parsers';
import { termFromIds, type TermOptions } from '../terms';

/**
 * One synced term for one ERP account. Older documents may still carry a
 * `creds` field from the Oct 2026 build; it is never read, never returned,
 * and removed on the next save.
 */
export interface SnapshotDoc {
  universityId: string;
  googleId?: string;
  term: SyncTerm;
  termKey: string;
  syncedAt: Date;
  attendance: SubjectAttendance[];
  timetable: TimetableDay[];
  internals: InternalRow[];
  results: ResultRow[];
  cgpaRows: CgpaRow[];
  cgpa: number | null;
  sgpaTerms: FullSyncData['sgpaTerms'];
  /** Every online fee order (Payments). */
  feeOrders: FeeOrder[];
  /** One record per conducted class (History). */
  classes: ClassRecord[];
  termOptions?: { years: { id: string; label: string }[]; semesters: { id: string; label: string }[] };
  /** Why a dataset is missing or old after the latest sync (e.g. the ERP's attendance register is down). */
  issues?: FullSyncData['issues'];
  /** When the attendance shown was last read from the ERP; null when it never was for this term. */
  attendanceSyncedAt?: Date | null;
  creds?: string;
}

/** What the browser receives. */
export interface ClientSnapshot {
  universityId: string;
  term: SyncTerm;
  syncedAt: string;
  attendance: SubjectAttendance[];
  timetable: TimetableDay[];
  internals: InternalRow[];
  results: ResultRow[];
  cgpaRows: CgpaRow[];
  cgpa: number | null;
  sgpaTerms: FullSyncData['sgpaTerms'];
  /** Every online fee order (Payments). */
  feeOrders: FeeOrder[];
  /** One record per conducted class (History). */
  classes: ClassRecord[];
  /** The ERP's academic years and semesters, for choosing another term. */
  termOptions: TermOptions | null;
  /** Why a dataset is missing or old after the latest sync. */
  issues: FullSyncData['issues'];
  /** When the attendance shown was last read from the ERP (null: never, for this term). */
  attendanceSyncedAt: string | null;
}

export function termKey(term: { academicyear?: string; semesterid?: string; semester?: string }): string {
  return [term.academicyear ?? '', term.semesterid ?? '', term.semester ?? ''].join('::');
}

const snapshots = async () => (await getDb()).collection<SnapshotDoc>('snapshots');

export function toClientSnapshot(doc: Omit<SnapshotDoc, 'creds'>): ClientSnapshot {
  const options = doc.termOptions ?? null;
  // Older snapshots stored only the ERP's internal year id ("30"); add its label.
  const term = doc.term.yearLabel || !options ? doc.term : { ...termFromIds(doc.term, options), semester: doc.term.semester || termFromIds(doc.term, options).semester };
  return {
    universityId: doc.universityId,
    term,
    syncedAt: new Date(doc.syncedAt).toISOString(),
    attendance: doc.attendance ?? [],
    timetable: doc.timetable ?? [],
    internals: doc.internals ?? [],
    results: doc.results ?? [],
    cgpaRows: doc.cgpaRows ?? [],
    cgpa: doc.cgpa ?? null,
    sgpaTerms: doc.sgpaTerms ?? [],
    feeOrders: doc.feeOrders ?? [],
    classes: doc.classes ?? [],
    termOptions: options,
    issues: doc.issues ?? {},
    attendanceSyncedAt:
      doc.attendanceSyncedAt !== undefined
        ? doc.attendanceSyncedAt && new Date(doc.attendanceSyncedAt).toISOString()
        : new Date(doc.syncedAt).toISOString(),
  };
}

/** Latest snapshot for one of a Google user's ERP accounts. */
export async function getLatestSnapshot(googleId: string, universityId: string): Promise<SnapshotDoc | null> {
  return (await snapshots())
    .find({ googleId, universityId }, { projection: { creds: 0 } })
    .sort({ syncedAt: -1 })
    .limit(1)
    .next();
}

/**
 * Persist a sync. Datasets that failed this run keep the values from the
 * previous snapshot so a flaky ERP page never blanks out good data.
 */
export async function saveFullSnapshot(input: {
  universityId: string;
  googleId: string;
  data: FullSyncData;
  previous?: SnapshotDoc | null;
  termOptions?: SnapshotDoc['termOptions'];
}): Promise<SnapshotDoc> {
  const { data, previous } = input;
  const sameTerm = !!previous && termKey(previous.term) === termKey(data.term);
  const keep = <K extends keyof SnapshotDoc>(dataset: FullSyncData['failed'][number], key: K, fresh: SnapshotDoc[K]) =>
    data.failed.includes(dataset) && sameTerm ? previous![key] : fresh;
  // Kept attendance is only as new as the sync that last read it.
  const attendanceSyncedAt = !data.failed.includes('attendance')
    ? new Date(data.syncedAt)
    : sameTerm
      ? previous!.attendanceSyncedAt !== undefined
        ? previous!.attendanceSyncedAt
        : new Date(previous!.syncedAt)
      : null;

  const cgpaRows = keep('cgpa', 'cgpaRows', data.cgpaRows);
  const doc: SnapshotDoc = {
    universityId: input.universityId,
    googleId: input.googleId,
    term: data.term,
    termKey: termKey(data.term),
    syncedAt: new Date(data.syncedAt),
    attendance: keep('attendance', 'attendance', data.attendance),
    timetable: keep('timetable', 'timetable', data.timetable),
    internals: keep('internals', 'internals', data.internals),
    results: keep('results', 'results', data.results),
    cgpaRows,
    cgpa: cgpaRows === data.cgpaRows ? data.cgpa : (previous?.cgpa ?? null),
    sgpaTerms: cgpaRows === data.cgpaRows ? data.sgpaTerms : (previous?.sgpaTerms ?? []),
    feeOrders: keep('fees', 'feeOrders', data.feeOrders),
    classes: keep('registers', 'classes', data.classes),
    ...(input.termOptions ? { termOptions: input.termOptions } : {}),
    issues: data.issues ?? {},
    attendanceSyncedAt,
  };
  // Keyed by the Google user too: the same ERP account under two Google
  // accounts must never overwrite (or, on removal, delete) the other's data.
  await (await snapshots()).updateOne(
    { googleId: doc.googleId, universityId: doc.universityId, termKey: doc.termKey },
    { $set: doc, $unset: { creds: '' } },
    { upsert: true },
  );
  return doc;
}

/** Remove every synced term of one account (used when the account is unlinked). */
export async function deleteSnapshots(googleId: string, universityId: string): Promise<number> {
  const res = await (await snapshots()).deleteMany({ googleId, universityId });
  return res.deletedCount;
}
