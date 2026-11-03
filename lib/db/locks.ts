import { randomUUID } from 'crypto';
import { MongoServerError } from 'mongodb';
import { getDb } from './mongo';

interface LockDoc {
  _id: string;
  until: Date;
  owner: string;
}

/**
 * Run `fn` while holding a short-lived lock. Another live holder means
 * `{ acquired: false }`; an expired lock (a crashed run) is taken over. Only
 * the owner releases, so a run that outlived its lock can't free a newer one.
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const col = (await getDb()).collection<LockDoc>('locks');
  const owner = randomUUID();
  const now = new Date();
  try {
    await col.updateOne(
      { _id: key, until: { $lt: now } },
      { $set: { until: new Date(now.getTime() + ttlMs), owner } },
      { upsert: true },
    );
  } catch (e) {
    // The upsert collided with a live lock's _id.
    if (e instanceof MongoServerError && e.code === 11000) return { acquired: false };
    throw e;
  }
  try {
    return { acquired: true, value: await fn() };
  } finally {
    await col.deleteOne({ _id: key, owner }).catch(() => undefined);
  }
}
