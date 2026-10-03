import {
  fetchAttendanceHtml,
  isSessionExpiredError,
  ErpRateLimited,
} from '@/lib/erp/client';
import { parseAttendance } from '@/lib/erp/parsers';
import { getAuthedSession, refreshSessionCookie } from '@/lib/erp/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/attendance?academicyear=&semesterid=&semester=
 * Proxies the ERP attendance search and returns normalized per-subject LTPS
 * counts: [{ code, title, components: { L,T,P,S: { conducted, attended } } }].
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
    const { html, jar, csrf } = await fetchAttendanceHtml(session, term);
    const subjects = parseAttendance(html);
    await refreshSessionCookie({ ...session, jar, csrf, term });
    return Response.json({ subjects });
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
    console.error('[api/erp/attendance]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not fetch attendance from the ERP.' }, { status: 502 });
  }
}
