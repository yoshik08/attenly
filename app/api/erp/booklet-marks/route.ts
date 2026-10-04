import {
  fetchErpPageHtml,
  isSessionExpiredError,
  ErpRateLimited,
} from '@/lib/erp/client';
import { parseBookletMarks } from '@/lib/erp/parsers';
import { getAuthedSession, refreshSessionCookie } from '@/lib/erp/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/booklet-marks?u=<ERP-relative popup URL>
 * Fetches the "Booklet" QP-wise marks popup through the ERP session and
 * returns its table as { title, headers, rows }.
 */
export async function GET(req: Request) {
  const session = await getAuthedSession();
  if (!session) {
    return Response.json({ error: 'Not logged in.', code: 'session_expired' }, { status: 401 });
  }
  const u = new URL(req.url).searchParams.get('u') ?? '';
  if (!u) {
    return Response.json({ error: 'Missing booklet URL.' }, { status: 400 });
  }

  try {
    const { html, jar } = await fetchErpPageHtml(session, u);
    const marks = parseBookletMarks(html);
    await refreshSessionCookie({ ...session, jar });
    return Response.json(marks);
  } catch (e) {
    if (isSessionExpiredError(e)) {
      return Response.json(
        { error: 'ERP session expired. Please log in again.', code: 'session_expired' },
        { status: 401 },
      );
    }
    if (e instanceof ErpRateLimited) {
      return Response.json({ error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    console.error('[api/erp/booklet-marks]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not fetch the booklet marks.' }, { status: 502 });
  }
}
