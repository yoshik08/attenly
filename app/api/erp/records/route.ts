import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser } from '@/lib/db/users';
import { getRecord, putRecord } from '@/lib/db/records';
import { ErpRateLimited } from '@/lib/erp/full-sync';
import { RECORD_MAX_AGE, readRecord, withErpSession, type RecordSet } from '@/lib/erp/records';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SETS: RecordSet[] = ['marks', 'papers', 'profile', 'fees', 'circulars', 'courses'];
const ID = /^\d{1,4}$/;

/**
 * GET /api/erp/records?set=marks|papers|profile|fees|circulars|courses&account=<id>[&ay=29&sem=2][&fresh=1]
 *
 * One screen's ERP data. Served from the cache while it is younger than the set's
 * max age; otherwise read from the ERP (reusing the saved session) and cached.
 * When the ERP fails, the last cached copy is still returned, marked stale.
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const url = new URL(req.url);
  const set = url.searchParams.get('set') as RecordSet;
  if (!SETS.includes(set)) return Response.json({ ok: false, error: 'Unknown set.' }, { status: 400 });
  const ay = url.searchParams.get('ay') ?? undefined;
  const sem = url.searchParams.get('sem') ?? undefined;
  if ((ay && !ID.test(ay)) || (sem && !ID.test(sem))) return Response.json({ ok: false, error: 'Bad term.' }, { status: 400 });
  const fresh = url.searchParams.get('fresh') === '1';

  let user;
  try {
    user = await getUser(me.googleId);
  } catch {
    return Response.json({ ok: false, code: 'db_unavailable', error: 'Attenly can’t reach its database right now.' }, { status: 503 });
  }
  const account = user ? findAccount(user, url.searchParams.get('account')) : null;
  if (!user || !account) return Response.json({ ok: false, error: 'That account isn’t linked.' }, { status: 404 });

  const key = set === 'marks' && ay && sem ? `marks:${ay}:${sem}` : set;
  const cached = await getRecord(me.googleId, account.universityId, key).catch(() => null);
  if (cached && !fresh && Date.now() - cached.fetchedAt.getTime() < RECORD_MAX_AGE[set]) {
    return Response.json({ ok: true, data: cached.data, fetchedAt: cached.fetchedAt, cached: true });
  }

  try {
    const data = await withErpSession(account, (s) => readRecord(s, set, { ay, sem }));
    // Marks asked without a term settle on one; cache under that term too.
    const fetchedAt = await putRecord(me.googleId, account.universityId, key, data);
    if (set === 'marks' && key === 'marks') {
      const t = (data as { term?: { academicyear: string; semesterid: string } | null }).term;
      if (t) await putRecord(me.googleId, account.universityId, `marks:${t.academicyear}:${t.semesterid}`, data).catch(() => undefined);
    }
    return Response.json({ ok: true, data, fetchedAt, cached: false });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const message =
      e instanceof ErpRateLimited
        ? e.message
        : code === 'needs_password'
          ? (e as Error).message
          : 'The ERP didn’t answer. Showing what Attenly read last.';
    console.error('[api/erp/records]', set, e instanceof Error ? e.message : e);
    if (cached) return Response.json({ ok: true, data: cached.data, fetchedAt: cached.fetchedAt, cached: true, stale: true, error: message });
    const status = code === 'needs_password' ? 409 : e instanceof ErpRateLimited ? 429 : 502;
    return Response.json({ ok: false, code: code ?? 'erp_failed', error: code ? message : 'The ERP didn’t answer. Try again in a moment.' }, { status });
  }
}
