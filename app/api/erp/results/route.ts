import {
  fetchResultsHtml,
  isSessionExpiredError,
  ErpRateLimited,
} from '@/lib/erp/client';
import { parseResults } from '@/lib/erp/parsers';
import { getAuthedSession, refreshSessionCookie } from '@/lib/erp/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/results?academicyear=&semesterid=&semester=
 * Sem-end course result grid (the "View Booklets" table): one row per
 * course/exam with the Booklet popup URL and PDF download URL when the ERP
 * exposes them.
 */
export async function GET(req: Request) {
  const session = await getAuthedSession();
  if (!session) {
    return Response.json({ error: 'Not logged in.', code: 'session_expired' }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const term = {
    academicyear: sp.get('academicyear') ?? session.term?.academicyear ?? '',
    semesterid: sp.get('semesterid') ?? session.term?.semesterid ?? '',
    semester: sp.get('semester') ?? session.term?.semester ?? '',
  };
  if (!term.academicyear) {
    return Response.json({ error: 'Choose a term first.' }, { status: 400 });
  }

  try {
    const { html, jar, csrf } = await fetchResultsHtml(session, term);
    const rows = parseResults(html);
    await refreshSessionCookie({ ...session, jar, csrf, term });
    return Response.json({ rows });
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
    console.error('[api/erp/results]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not fetch results from the ERP.' }, { status: 502 });
  }
}
