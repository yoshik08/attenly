import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser } from '@/lib/db/users';
import { withErpSession } from '@/lib/db/erp-session';
import { readPaperScan } from '@/lib/erp/records';
import { paperKeyFrom, scanResponse } from '@/lib/erp/serve';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/erp/booklet?account=<id>&code=<course>&exam=<exam>&ay=<2026-2027>&sem=<Odd Sem>
 *
 * The scanned answer script of one evaluated paper, streamed from the ERP (scans run to
 * several MB). The browser names the paper; the ERP's links never leave the server. The
 * ERP labels these files text/html, so only bytes that start like a PDF pass through.
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const url = new URL(req.url);
  const key = paperKeyFrom((n) => url.searchParams.get(n));
  if (!key) return new Response('Say which paper to open.', { status: 400 });

  const user = await getUser(me.googleId).catch(() => null);
  const account = user ? findAccount(user, url.searchParams.get('account')) : null;
  if (!account) return new Response('That account isn’t linked.', { status: 404 });

  try {
    return await scanResponse(await withErpSession(account, (s) => readPaperScan(s, key)), key);
  } catch (e) {
    console.error('[api/erp/booklet]', e instanceof Error ? e.message : e);
    return new Response('The ERP didn’t hand over that scan. Try again in a moment.', { status: 502 });
  }
}
