import { getGoogleUser, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/db/users';
import { syncAccount, type SyncCode } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STATUS: Partial<Record<SyncCode, number>> = {
  busy: 409,
  needs_password: 409,
  bad_credentials: 409,
  no_account: 404,
  rate_limited: 429,
  bad_captcha: 502,
  solver_unavailable: 502,
  erp_slow: 504,
  erp_unreachable: 502,
  failed: 502,
};

/**
 * POST /api/erp/hard-sync
 * Body: { universityId?: string, mode?: 'force' | 'auto' }
 *
 * 'force' (the sync button) always logs into the ERP and pulls fresh data. It
 * answers within five seconds: the saved ERP session is reused when there is
 * one, the term probe is skipped when the term has not changed, and whatever
 * the ERP has not answered by then is reported as 'erp_slow' instead of left
 * spinning. 'auto' (the app's background refresh) only does so when the latest
 * cloud snapshot is older than ~5.5 minutes, otherwise it returns that snapshot.
 */
export async function POST(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { universityId?: unknown; mode?: unknown };
  const universityId = typeof body.universityId === 'string' ? body.universityId : null;
  const force = body.mode !== 'auto';

  try {
    const user = await getUser(me.googleId);
    if (!user) return Response.json({ ok: false, code: 'no_account', error: 'No ERP account is linked yet.' }, { status: 404 });
    const result = await syncAccount({ user, universityId, force, manual: force });
    return Response.json(
      { ok: result.ok, code: result.code, error: result.ok ? undefined : result.message, snapshot: result.snapshot },
      { status: result.ok ? 200 : (STATUS[result.code] ?? 502) },
    );
  } catch (e) {
    console.error('[api/erp/hard-sync]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, code: 'db_unavailable', error: 'Attenly can’t reach its database right now.' }, { status: 503 });
  }
}
