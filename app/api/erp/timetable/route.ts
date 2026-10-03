import {
  fetchTimetableHtml,
  isSessionExpiredError,
  ErpRateLimited,
} from '@/lib/erp/client';
import { parseTimetable } from '@/lib/erp/parsers';
import { getAuthedSession, refreshSessionCookie } from '@/lib/erp/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/timetable?academicyear=&semesterid=&semester=
 * Proxies the ERP timetable search and returns the week grid:
 * [{ day: 'Mon', periods: [{ period, start, end, subjectCode, subjectTitle,
 *    room, faculty, type }] }].
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
    const { html, jar, csrf } = await fetchTimetableHtml(session, term);
    const days = parseTimetable(html);
    await refreshSessionCookie({ ...session, jar, csrf, term });
    return Response.json({ days });
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
    console.error('[api/erp/timetable]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not fetch the timetable from the ERP.' }, { status: 502 });
  }
}
