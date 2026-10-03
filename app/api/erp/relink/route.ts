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
import type { SnapshotDoc } from '@/app/api/snapshots/route';

export const dynamic = 'force-dynamic';

/**
 * POST /api/erp/relink  { universityId }
 * One-tap re-link using the server-sealed credentials stored with the
 * student's latest snapshot. The password is decrypted in memory only and
 * never sent to the client; the captcha is solved server-side.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { universityId?: string } | null;
  const universityId = typeof body?.universityId === 'string' ? body.universityId.trim() : '';
  if (!universityId) {
    return Response.json({ error: 'universityId is required.' }, { status: 400 });
  }

  let snapshot: SnapshotDoc | null;
  try {
    const db = await getDb();
    snapshot = await db
      .collection<SnapshotDoc>('snapshots')
      .find({ universityId })
      .sort({ syncedAt: -1 })
      .limit(1)
      .next();
  } catch (e) {
    if (isMongoMisconfigured(e)) {
      return Response.json(
        { error: 'MongoDB is not configured.', code: 'mongo_not_configured' },
        { status: 503 },
      );
    }
    console.error('[api/erp/relink] snapshot read failed:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not read the saved login.' }, { status: 502 });
  }
  if (!snapshot?.creds) {
    return Response.json({ ok: false, error: 'No saved login for this ID.', code: 'no_saved_login' }, { status: 404 });
  }

  const creds = unsealSession<{ pw?: string }>(snapshot.creds);
  if (!creds?.pw) {
    return Response.json(
      { ok: false, error: 'Saved login expired. Link manually once.', code: 'creds_invalid' },
      { status: 410 },
    );
  }

  try {
    const { solution, preSession } = await fetchSolvedCaptcha();
    const result = await performLogin(preSession, universityId, creds.pw, solution);
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
