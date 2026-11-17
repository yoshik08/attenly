import { getDb } from './mongo';

/**
 * The last copy of each on-demand ERP set (marks, profile, fees, …) per account,
 * so a screen opens from the cache and the ERP is asked at most every few minutes.
 */
interface RecordDoc {
  googleId: string;
  universityId: string;
  /** The set, plus its term for marks ("marks:29:2"). */
  key: string;
  data: unknown;
  fetchedAt: Date;
}

let indexed = false;

async function collection() {
  const col = (await getDb()).collection<RecordDoc>('records');
  if (!indexed) {
    indexed = true;
    col.createIndex({ googleId: 1, universityId: 1, key: 1 }, { unique: true }).catch(() => {
      indexed = false;
    });
  }
  return col;
}

export async function getRecord(googleId: string, universityId: string, key: string): Promise<{ data: unknown; fetchedAt: Date } | null> {
  const doc = await (await collection()).findOne({ googleId, universityId, key }, { projection: { data: 1, fetchedAt: 1 } });
  return doc ? { data: doc.data, fetchedAt: doc.fetchedAt } : null;
}

export async function putRecord(googleId: string, universityId: string, key: string, data: unknown): Promise<Date> {
  const fetchedAt = new Date();
  await (await collection()).updateOne({ googleId, universityId, key }, { $set: { data, fetchedAt } }, { upsert: true });
  return fetchedAt;
}

/** Forget every set of an account (it was unlinked). */
export async function deleteRecords(googleId: string, universityId: string): Promise<void> {
  await (await collection()).deleteMany({ googleId, universityId }).catch(() => undefined);
}
