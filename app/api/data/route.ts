import { getGoogleUser, isGoogleConfigured } from '@/lib/auth';
import { getUser, viewAccounts } from '@/lib/db/users';
import { getLatestSnapshot, toClientSnapshot } from '@/lib/db/snapshots';
import { FRESH_MS } from '@/lib/sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/data?account=<universityId>
 * Instant load for the app: who is signed in, their linked ERP accounts (no
 * passwords) and the latest cloud-synced snapshot of the chosen account. No
 * ERP round-trip happens here; the client asks /api/erp/hard-sync when the
 * snapshot is older than FRESH_MS.
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) {
    return Response.json({ signedIn: false, googleConfigured: isGoogleConfigured() });
  }
  const requested = new URL(req.url).searchParams.get('account');
  try {
    // The app always asks for the account it showed last, so fetch that snapshot alongside
    // the user instead of after it: one database round trip instead of two.
    const [user, guess] = await Promise.all([
      getUser(me.googleId),
      requested ? getLatestSnapshot(me.googleId, requested) : Promise.resolve(null),
    ]);
    const accounts = user ? viewAccounts(user) : [];
    const active = accounts.find((a) => a.universityId === requested) ?? accounts[0] ?? null;
    // Snapshots are keyed by the Google user, so a guess for an account that is no longer linked
    // is simply discarded.
    const snap = !active ? null : active.universityId === requested ? guess : await getLatestSnapshot(me.googleId, active.universityId);
    return Response.json({
      signedIn: true,
      user: { name: me.name, email: me.email, image: me.image },
      accounts,
      active: active?.universityId ?? null,
      snapshot: snap ? toClientSnapshot(snap) : null,
      lastInstructionDay: user?.lastInstructionDay ?? null,
      freshMs: FRESH_MS,
      serverNow: Date.now(),
    });
  } catch (e) {
    console.error('[api/data]', e instanceof Error ? e.message : e);
    return Response.json(
      { signedIn: true, error: 'Attenly can’t reach its database right now.', code: 'db_unavailable' },
      { status: 503 },
    );
  }
}
