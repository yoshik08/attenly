import { getGoogleUser, unauthorized } from '@/lib/auth';
import { getUser, makePrimary, removeAccount, setAccountTerm, viewAccounts } from '@/lib/db/users';
import { deleteSnapshots } from '@/lib/db/snapshots';

export const dynamic = 'force-dynamic';

async function list(googleId: string) {
  const user = await getUser(googleId);
  return user ? viewAccounts(user) : [];
}

/** GET /api/erp/accounts — linked ERP accounts (never passwords). */
export async function GET() {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  return Response.json({ accounts: await list(me.googleId) });
}

const TERM_ID = /^[A-Za-z0-9 _-]{1,32}$/;

/**
 * PATCH /api/erp/accounts
 *   { universityId, primary: true }                       make an account the primary one
 *   { universityId, term: { academicyear, semesterid } }  sync that year and semester (ERP ids)
 *   { universityId, term: null }                          back to the newest term with attendance
 */
export async function PATCH(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { universityId?: unknown; primary?: unknown; term?: unknown };
  if (typeof body.universityId !== 'string') {
    return Response.json({ ok: false, error: 'Say which account to change.' }, { status: 400 });
  }
  let found: boolean;
  if (body.primary === true) {
    found = await makePrimary(me.googleId, body.universityId);
  } else if ('term' in body) {
    const t = body.term as { academicyear?: unknown; semesterid?: unknown } | null;
    if (t !== null && !(typeof t?.academicyear === 'string' && TERM_ID.test(t.academicyear) && typeof t?.semesterid === 'string' && TERM_ID.test(t.semesterid))) {
      return Response.json({ ok: false, error: 'Pick an academic year and a semester.' }, { status: 400 });
    }
    found = await setAccountTerm(me.googleId, body.universityId, t ? { academicyear: t.academicyear as string, semesterid: t.semesterid as string } : null);
  } else {
    return Response.json({ ok: false, error: 'Nothing to change.' }, { status: 400 });
  }
  if (!found) return Response.json({ ok: false, error: 'That account isn’t linked.' }, { status: 404 });
  return Response.json({ ok: true, accounts: await list(me.googleId) });
}

/**
 * DELETE /api/erp/accounts?universityId=… — unlink an ERP account: removes
 * its saved password and every synced snapshot of it.
 */
export async function DELETE(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const universityId = new URL(req.url).searchParams.get('universityId') ?? '';
  if (!universityId) return Response.json({ ok: false, error: 'Say which account to remove.' }, { status: 400 });
  const removed = await removeAccount(me.googleId, universityId);
  if (!removed) return Response.json({ ok: false, error: 'That account isn’t linked.' }, { status: 404 });
  await deleteSnapshots(me.googleId, universityId);
  return Response.json({ ok: true, accounts: await list(me.googleId) });
}
