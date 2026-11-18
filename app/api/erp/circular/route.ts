import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser } from '@/lib/db/users';
import { withErpSession } from '@/lib/db/erp-session';
import { readCircularDocument } from '@/lib/erp/records';
import { circularResponse } from '@/lib/erp/serve';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/erp/circular?id=<circular id>&account=<university id>
 *
 * A circular's document, read from the ERP and passed through. The browser only
 * ever names the circular's number; the ERP's link never leaves the server.
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!/^\d{1,9}$/.test(id)) return new Response('Say which circular to open.', { status: 400 });

  const user = await getUser(me.googleId).catch(() => null);
  const account = user ? findAccount(user, url.searchParams.get('account')) : null;
  if (!account) return new Response('That account isn’t linked.', { status: 404 });

  try {
    return circularResponse(await withErpSession(account, (s) => readCircularDocument(s, id)), id);
  } catch (e) {
    console.error('[api/erp/circular]', e instanceof Error ? e.message : e);
    return new Response('The ERP didn’t hand over that circular. Try again in a moment.', { status: 502 });
  }
}
