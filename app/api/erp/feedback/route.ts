import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser } from '@/lib/db/users';
import { ErpRateLimited } from '@/lib/erp/client';
import { withErpSession } from '@/lib/db/erp-session';
import { submitAllFeedback } from '@/lib/erp/feedback';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/erp/feedback?account=<id>
 *
 * "Force submit": answers every pending course feedback form on the ERP with Good and
 * posts it (lib/erp/feedback.ts). Writes to the ERP; only ever called from the button.
 */
export async function POST(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const url = new URL(req.url);
  let user;
  try {
    user = await getUser(me.googleId);
  } catch {
    return Response.json({ ok: false, code: 'db_unavailable', error: 'Attenly can’t reach its database right now.' }, { status: 503 });
  }
  const account = user ? findAccount(user, url.searchParams.get('account')) : null;
  if (!user || !account) return Response.json({ ok: false, error: 'That account isn’t linked.' }, { status: 404 });

  try {
    const run = await withErpSession(account, (s) => submitAllFeedback(s), me.googleId);
    return Response.json({ ok: true, run, at: new Date().toISOString() });
  } catch (e) {
    const code = (e as { code?: string }).code;
    console.error('[api/erp/feedback]', e instanceof Error ? e.message : e);
    if (e instanceof ErpRateLimited || code === 'rate_limited') {
      return Response.json({ ok: false, code: 'rate_limited', error: 'The ERP is rate-limiting Attenly. Wait a minute and press Force submit again.' }, { status: 429 });
    }
    if (code === 'needs_password') return Response.json({ ok: false, code, error: (e as Error).message }, { status: 409 });
    return Response.json({ ok: false, code: 'erp_failed', error: 'The ERP didn’t answer, so no feedback was submitted. Try again in a moment.' }, { status: 502 });
  }
}
