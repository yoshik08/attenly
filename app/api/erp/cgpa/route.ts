import {
  fetchCgpaHtml,
  isSessionExpiredError,
  ErpRateLimited,
} from '@/lib/erp/client';
import { parseCgpa, computeGpa } from '@/lib/erp/parsers';
import { getAuthedSession, refreshSessionCookie } from '@/lib/erp/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/cgpa
 * The ERP's "My CGPA" grid: every course taken with grade, grade point and
 * credits. CGPA and per-term SGPA are computed server-side from those rows.
 */
export async function GET() {
  const session = await getAuthedSession();
  if (!session) {
    return Response.json({ error: 'Not logged in.', code: 'session_expired' }, { status: 401 });
  }

  try {
    const { html, jar, csrf } = await fetchCgpaHtml(session);
    const rows = parseCgpa(html);
    const { cgpa, terms } = computeGpa(rows);
    await refreshSessionCookie({ ...session, jar, csrf });
    return Response.json({ rows, cgpa, terms });
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
    console.error('[api/erp/cgpa]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not fetch CGPA from the ERP.' }, { status: 502 });
  }
}
