import { ERP_BASE, fetchFeeReceiptHtml } from '@/lib/erp/client';
import { parseFeeReceipt } from '@/lib/erp/parsers';
import { localBody, localFailure, localJson, withLocalErp } from '@/lib/local';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** True when `href` stays on the ERP (relative, or absolute on the ERP's own origin). */
function onErp(href: string): boolean {
  try {
    return new URL(href, ERP_BASE).origin === new URL(ERP_BASE).origin;
  } catch {
    return false;
  }
}

/**
 * POST /api/local/fee-receipt
 * Body: { key, erp?, href }
 *
 * One fee order's receipt for a browser signed in without Google. There is no stored
 * snapshot to look the order up in, so the browser names the receipt link from its own
 * copy. Only the ERP's receipt pages are followed, and only on the ERP's own origin.
 */
export async function POST(req: Request) {
  const body = await localBody(req);
  const href = typeof body.href === 'string' ? body.href : '';
  if (!href || href.length > 1000 || !/[?&]r=[^&#]*fee_receipt/i.test(href) || !onErp(href)) {
    return Response.json({ ok: false, error: 'Say which receipt to open.' }, { status: 400 });
  }

  try {
    const { value: html, erp } = await withLocalErp(body, async (s) => (await fetchFeeReceiptHtml(s, href)).html);
    const receipt = parseFeeReceipt(html);
    if (!receipt) return localJson({ ok: false, error: 'The ERP did not return a readable receipt.' }, erp, { status: 502 });
    return localJson({ ok: true, receipt }, erp);
  } catch (e) {
    console.error('[api/local/fee-receipt]', e instanceof Error ? e.message : e);
    return localFailure(e, 'Attenly could not read that receipt. Try again in a moment.');
  }
}
