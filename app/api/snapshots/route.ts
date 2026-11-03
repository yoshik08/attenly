import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser } from '@/lib/db/users';
import { getLatestSnapshot, toClientSnapshot } from '@/lib/db/snapshots';

export const dynamic = 'force-dynamic';

/**
 * GET /api/snapshots?mine=1[&universityId=]
 * Kept for pages opened before this version shipped. Signed-in users only,
 * and only their own accounts (it used to answer for any universityId).
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const universityId = new URL(req.url).searchParams.get('universityId');
  try {
    const user = await getUser(me.googleId);
    const account = user ? findAccount(user, universityId) : null;
    const snap = account ? await getLatestSnapshot(me.googleId, account.universityId) : null;
    if (!snap) return Response.json({ error: 'No snapshot found.', code: 'not_found' }, { status: 404 });
    return Response.json({ snapshot: toClientSnapshot(snap) });
  } catch (e) {
    console.error('[api/snapshots]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not load the snapshot.' }, { status: 502 });
  }
}
