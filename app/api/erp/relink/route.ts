import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, isMongoMisconfigured } from '@/lib/db/mongo';
import {
  performLogin,
  unsealSession,
  sealSession,
  ErpRateLimited,
} from '@/lib/erp/client';
import { fetchSolvedCaptcha } from '@/lib/erp/autocaptcha';
import { sessionCookieOptions, SESSION_COOKIE } from '@/lib/erp/session';
import { cookies } from 'next/headers';
import type { UserDoc } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

/**
 * POST /api/erp/relink
 * One-tap re-link for Google-signed-in users. The ERP password is decrypted
 * from the user's sealed `creds` in memory only — never sent to the client.
 * Requires a Google session; the ERP session cookie is set on success.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  const googleId = (session?.user as { id?: string } | undefined)?.id;
  if (!googleId) {
    return Response.json({ ok: false, error: 'Sign in with Google first.', code: 'auth_required' }, { status: 401 });
  }

  let user: UserDoc | null;
  try {
    const db = await getDb();
    user = await db.collection<UserDoc>('users').findOne({ googleId });
  } catch (e) {
    if (isMongoMisconfigured(e)) {
      return Response.json(
        { ok: false, error: 'MongoDB is not configured.', code: 'mongo_not_configured' },
        { status: 503 },
      );
    }
    console.error('[api/erp/relink] user read failed:', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Could not read the saved login.' }, { status: 502 });
  }
  if (!user?.creds || !user?.universityId) {
    return Response.json({ ok: false, error: 'No saved ERP login for this account.', code: 'no_saved_login' }, { status: 404 });
  }

  const creds = unsealSession<{ pw?: string }>(user.creds);
  if (!creds?.pw) {
    return Response.json(
      { ok: false, error: 'Saved login expired. Link your ERP manually once.', code: 'creds_invalid' },
      { status: 410 },
    );
  }

  try {
    const { solution, preSession } = await fetchSolvedCaptcha();
    const result = await performLogin(preSession, user.universityId, creds.pw, solution);
    if (!result.ok) {
      const status = result.code === 'rate_limited' ? 429 : 401;
      return Response.json({ ok: false, error: result.error, code: result.code }, { status });
    }
    const token = sealSession({
      jar: result.jar,
      csrf: result.csrf,
      exp: Date.now() + 7 * 24 * 3600 * 1000,
    });
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    return Response.json({ ok: true, termOptions: result.termOptions ?? { years: [], semesters: [] } });
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return Response.json({ ok: false, error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    const code = (e as { code?: string }).code;
    if (code === 'no_solver') {
      return Response.json({ ok: false, error: 'Auto-decode is not configured.', code }, { status: 501 });
    }
    console.error('[api/erp/relink]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Re-link failed. Try the manual login.', code: 'unknown' }, { status: 502 });
  }
}
