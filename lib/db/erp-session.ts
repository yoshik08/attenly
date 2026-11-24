import { getDb } from './mongo';
import { recordSync, resolvePassword, type ErpAccount } from './users';
import { isSessionExpiredError, sealSession, unsealSession, type AuthedSession } from '../erp/client';
import { autoLogin } from '../erp/full-sync';
import { coded } from '../erp/errors';

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

/**
 * The saved session, or null. `maxLoginAgeMs` also refuses one whose login is older than
 * that, so a caller that wants a password changed on the ERP noticed soon logs in again.
 */
export async function loadErpSession(universityId: string, maxLoginAgeMs?: number): Promise<AuthedSession | null> {
  const doc = await (await collection()).findOne({ universityId });
  if (!doc) return null;
  if (Date.now() - new Date(doc.savedAt).getTime() > SESSION_TTL_MS) return null;
  const session = unsealSession<Omit<AuthedSession, 'exp'>>(doc.sealed);
  if (!session || !session.jar || Object.keys(session.jar).length === 0 || !session.csrf) return null;
  if (maxLoginAgeMs != null && Date.now() - (session.loggedInAt ?? 0) > maxLoginAgeMs) return null;
  return { ...session, exp: 0 };
}

export async function saveErpSession(universityId: string, session: AuthedSession): Promise<void> {
  if (!session.jar || Object.keys(session.jar).length === 0) return;
  const sealed = sealSession({
    jar: session.jar,
    csrf: session.csrf,
    ...(session.loggedInAt ? { loggedInAt: session.loggedInAt } : {}),
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

/**
 * A logged-in ERP session for a linked `account`: the saved one when it still works,
 * else one fresh login with the stored password. Saves whatever session it ends with.
 *
 * A password the ERP already rejected (the account waits for a new one) is never tried
 * again: every screen that opened would otherwise send the ERP another bad login. When
 * this login is the one rejected, the account is paused the same way a sync pauses it.
 */
export async function withErpSession<T>(account: ErpAccount, fn: (session: AuthedSession) => Promise<T>, googleId?: string): Promise<T> {
  const creds = account.needsPassword ? null : resolvePassword(account);
  const missing = () =>
    coded(
      account.needsPassword
        ? 'The ERP rejected the saved password. Enter your current ERP password to read this.'
        : 'Enter your ERP password once to read this from the ERP.',
      'needs_password',
    );
  const login = async (password: string) => {
    try {
      return await autoLogin(account.universityId, password);
    } catch (e) {
      if ((e as { code?: string })?.code !== 'bad_credentials') throw e;
      await clearErpSession(account.universityId);
      if (googleId) {
        const message = 'The ERP rejected the saved password. Enter your current ERP password.';
        await recordSync(googleId, account.universityId, { ok: false, code: 'bad_credentials', message, needsPassword: true }).catch(() => undefined);
      }
      throw coded('The ERP rejected the saved password. Enter your current ERP password to read this.', 'needs_password');
    }
  };
  let session = await loadErpSession(account.universityId);
  if (!session) {
    if (!creds) throw missing();
    session = await login(creds.password);
  }
  let result: T;
  try {
    result = await fn(session);
  } catch (e) {
    if (!isSessionExpiredError(e)) throw e;
    await clearErpSession(account.universityId);
    if (!creds) throw missing();
    session = await login(creds.password);
    result = await fn(session);
  }
  await saveErpSession(account.universityId, session).catch(() => undefined);
  return result;
}
