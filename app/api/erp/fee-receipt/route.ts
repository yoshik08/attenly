import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser, resolvePassword } from '@/lib/db/users';
import { getLatestSnapshot } from '@/lib/db/snapshots';
import { clearErpSession, loadErpSession, saveErpSession } from '@/lib/db/erp-session';
import { autoLogin, ErpRateLimited, isSessionExpiredError } from '@/lib/erp/full-sync';
import { fetchFeeReceiptHtml } from '@/lib/erp/client';
import { parseFeeReceipt } from '@/lib/erp/parsers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/erp/fee-receipt?order=<order number>&account=<university id>
 *
 * The receipt of one synced fee order. The order is looked up in the snapshot
 * this server stored, so the browser only ever names an order number — the ERP's
 * receipt link never leaves the server. A saved ERP session is reused; when the
 * ERP has dropped it, the stored password buys one fresh login.
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const url = new URL(req.url);
  const orderNo = (url.searchParams.get('order') ?? '').trim();
  if (!orderNo) return Response.json({ ok: false, error: 'Say which order to open.' }, { status: 400 });

  try {
    const user = await getUser(me.googleId);
    if (!user) return Response.json({ ok: false, error: 'No ERP account is linked yet.' }, { status: 404 });
    const account = findAccount(user, url.searchParams.get('account'));
    if (!account) return Response.json({ ok: false, error: 'That account isn’t linked.' }, { status: 404 });

    const snapshot = await getLatestSnapshot(user.googleId, account.universityId);
    const order = snapshot?.feeOrders?.find((o) => o.orderNo === orderNo);
    if (!order) return Response.json({ ok: false, error: 'That order isn’t in the synced list yet.' }, { status: 404 });
    if (!order.receiptHref) return Response.json({ ok: false, error: 'The ERP has no receipt for that order yet.' }, { status: 404 });

    const creds = resolvePassword(account);
    let session = await loadErpSession(account.universityId);
    if (!session) {
      if (!creds) {
        return Response.json(
          { ok: false, code: 'needs_password', error: 'Enter your ERP password once to open receipts.' },
          { status: 409 },
        );
      }
      session = await autoLogin(account.universityId, creds.password);
    }

    let html: string;
    try {
      html = (await fetchFeeReceiptHtml(session, order.receiptHref)).html;
    } catch (e) {
      if (!isSessionExpiredError(e) || !creds) throw e;
      await clearErpSession(account.universityId);
      session = await autoLogin(account.universityId, creds.password);
      html = (await fetchFeeReceiptHtml(session, order.receiptHref)).html;
    }
    await saveErpSession(account.universityId, session).catch(() => undefined);

    const receipt = parseFeeReceipt(html);
    if (!receipt) {
      return Response.json({ ok: false, error: 'The ERP did not return a readable receipt.' }, { status: 502 });
    }
    return Response.json({ ok: true, receipt });
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return Response.json({ ok: false, error: e.message }, { status: 429 });
    }
    console.error('[api/erp/fee-receipt]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Attenly could not read that receipt. Try again in a moment.' }, { status: 502 });
  }
}
