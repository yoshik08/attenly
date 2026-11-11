import { getDb } from './mongo';
import { sealSession, unsealSession, type AuthedSession } from '../erp/client';

/**
 * A logged-in ERP session, kept between syncs so the manual sync button does
 * not pay for a captcha solve and a login every time. The jar is sealed with
 * SESSION_SECRET (AES-256-GCM), never leaves the server, and is dropped as soon
 * as the ERP says the session expired.
 */
interface SessionDoc {
  universityId: string;
  sealed: string;
  savedAt: Date;
}

/** The ERP's PHP session lasts hours; a day-old one is not worth trusting. */
const SESSION_TTL_MS = 6 * 3600 * 1000;

let indexed = false;

async function collection() {
  const col = (await getDb()).collection<SessionDoc>('erpSessions');
  if (!indexed) {
    // Expired sessions clean themselves up.
    await col.createIndex({ savedAt: 1 }, { expireAfterSeconds: Math.round(SESSION_TTL_MS / 1000) }).catch(() => undefined);
    indexed = true;
  }
  return col;
}

export async function loadErpSession(universityId: string): Promise<AuthedSession | null> {
  const doc = await (await collection()).findOne({ universityId });
  if (!doc) return null;
  if (Date.now() - new Date(doc.savedAt).getTime() > SESSION_TTL_MS) return null;
  const session = unsealSession<Omit<AuthedSession, 'exp'>>(doc.sealed);
  if (!session || !session.jar || Object.keys(session.jar).length === 0 || !session.csrf) return null;
  return { ...session, exp: 0 };
}

export async function saveErpSession(universityId: string, session: AuthedSession): Promise<void> {
  if (!session.jar || Object.keys(session.jar).length === 0) return;
  const sealed = sealSession({
    jar: session.jar,
    csrf: session.csrf,
    ...(session.term ? { term: session.term } : {}),
    ...(session.termOptions ? { termOptions: session.termOptions } : {}),
  });
  await (await collection()).updateOne(
    { universityId },
    { $set: { universityId, sealed, savedAt: new Date() } },
    { upsert: true },
  );
}

export async function clearErpSession(universityId: string): Promise<void> {
  await (await collection()).deleteOne({ universityId }).catch(() => undefined);
}

/** Drop every session of one account (used when the account is unlinked). */
export async function clearErpSessions(universityId: string): Promise<number> {
  const res = await (await collection()).deleteMany({ universityId });
  return res.deletedCount;
}
