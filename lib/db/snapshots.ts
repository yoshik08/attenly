import { getDb } from './mongo';
import { sealSession } from '../erp/client';
import type { FullSyncData } from '../erp/full-sync';

/**
 * Snapshot document. Credentials live ONLY as the AES-256-GCM sealed `creds`
 * blob — never plaintext. GET projections always exclude `creds`.
 */
export interface SnapshotDoc {
  universityId: string;
  googleId?: string;
  term: { academicyear: string; semesterid: string; semester: string };
  termKey: string;
  syncedAt: Date;
  attendance: unknown[];
  timetable: unknown[];
  internals: unknown[];
  results: unknown[];
  cgpaRows: unknown[];
  cgpa: number | null;
  sgpaTerms: unknown[];
  termOptions?: { years: { id: string; label: string }[]; semesters: { id: string; label: string }[] };
  creds?: string;
}

export function termKey(term: { academicyear?: string; semesterid?: string; semester?: string }): string {
  return [term.academicyear ?? '', term.semesterid ?? '', term.semester ?? ''].join('::');
}

/** Persist a full sync. When `password` is supplied it is sealed into `creds`. */
export async function saveFullSnapshot(input: {
  universityId: string;
  googleId?: string;
  term: { academicyear: string; semesterid: string; semester: string };
  data: FullSyncData;
  password?: string;
  termOptions?: { years: { id: string; label: string }[]; semesters: { id: string; label: string }[] };
}): Promise<{ savedAt: string }> {
  let creds: string | undefined;
  if (input.password) {
    creds = sealSession({ pw: input.password });
  }
  const doc: SnapshotDoc = {
    universityId: input.universityId,
    ...(input.googleId ? { googleId: input.googleId } : {}),
    term: input.term,
    termKey: termKey(input.term),
    syncedAt: new Date(input.data.syncedAt),
    attendance: input.data.attendance,
    timetable: input.data.timetable,
    internals: input.data.internals,
    results: input.data.results,
    cgpaRows: input.data.cgpaRows,
    cgpa: input.data.cgpa,
    sgpaTerms: input.data.sgpaTerms,
    ...(input.termOptions ? { termOptions: input.termOptions } : {}),
    ...(creds ? { creds } : {}),
  };
  const db = await getDb();
  // $set only touches the listed fields, so a sync without a password keeps
  // any previously sealed creds blob intact.
  await db.collection<SnapshotDoc>('snapshots').updateOne(
    { universityId: doc.universityId, termKey: doc.termKey },
    { $set: doc },
    { upsert: true },
  );
  return { savedAt: doc.syncedAt.toISOString() };
}

/** Latest snapshot for a Google user (creds excluded). */
export async function getLatestSnapshotForGoogle(googleId: string, universityId?: string): Promise<Omit<SnapshotDoc, 'creds'> | null> {
  const db = await getDb();
  const filter: Record<string, string> = { googleId };
  if (universityId) filter.universityId = universityId;
  return db
    .collection<SnapshotDoc>('snapshots')
    .find(filter, { projection: { creds: 0 } })
    .sort({ syncedAt: -1 })
    .limit(1)
    .next();
}
