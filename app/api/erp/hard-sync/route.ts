import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, isMongoMisconfigured } from '@/lib/db/mongo';
import { unsealSession, ErpRateLimited } from '@/lib/erp/client';
import { autoLogin, pullAll, isSessionExpiredError } from '@/lib/erp/full-sync';
import { saveFullSnapshot } from '@/lib/db/snapshots';
import { refreshSessionCookie } from '@/lib/erp/session';
import type { UserDoc } from '@/lib/db/users';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/erp/hard-sync
 * Body (optional): { yearId?: string, semesterId?: string }
 *
 * User-triggered hard sync: decrypts the sealed ERP password for the
 * signed-in Google user, logs into the ERP (auto CAPTCHA), pulls everything
 * for the selected term (or the current term), and refreshes the snapshot.
 * The password only exists decrypted in memory for the duration of the sync.
 */
export async function POST(req: Request) {
  const gsession = await getServerSession(authOptions);
  const googleId = (gsession?.user as { id?: string } | undefined)?.id;
  if (!googleId) {
    return Response.json({ ok: false, error: 'Sign in with Google first.', code: 'auth_required' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // No body is fine — syncs the current term.
  }
  const yearId = typeof body.yearId === 'string' ? body.yearId : undefined;
  const semesterId = typeof body.semesterId === 'string' ? body.semesterId : undefined;

  let user: UserDoc | null;
  try {
    const db = await getDb();
    user = await db.collection<UserDoc>('users').findOne({ googleId });
  } catch (e) {
    if (isMongoMisconfigured(e)) {
      return Response.json({ ok: false, error: 'MongoDB is not configured.', code: 'mongo_not_configured' }, { status: 503 });
    }
    return Response.json({ ok: false, error: 'Could not read the saved login.' }, { status: 502 });
  }
  if (!user?.creds || !user?.universityId) {
    return Response.json({ ok: false, error: 'No saved ERP login for this account.', code: 'no_saved_login' }, { status: 404 });
  }
  const creds = unsealSession<{ pw?: string }>(user.creds);
  if (!creds?.pw) {
    return Response.json({ ok: false, error: 'Saved login expired. Link your ERP again.', code: 'creds_invalid' }, { status: 410 });
  }

  try {
    const authed = await autoLogin(user.universityId, creds.pw);
    await refreshSessionCookie(authed);

    // Term override if the user picked a specific year/sem.
    const termOverride =
      yearId && semesterId
        ? { academicyear: yearId, semesterid: semesterId, semester: semesterId }
        : undefined;
    const data = await pullAll(authed, termOverride);

    await saveFullSnapshot({
      universityId: user.universityId,
      googleId,
      term: data.term,
      data,
      termOptions: authed.termOptions,
    });

    return Response.json({ ok: true, data });
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return Response.json({ ok: false, error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    if (isSessionExpiredError(e)) {
      return Response.json({ ok: false, error: 'ERP session expired. Try again.', code: 'session_expired' }, { status: 401 });
    }
    console.error('[api/erp/hard-sync]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'Sync failed.' }, { status: 502 });
  }
}
