import { getDb, isMongoMisconfigured } from '@/lib/db/mongo';
import type { UserDoc } from '@/lib/db/users';
import { unsealSession } from '@/lib/erp/client';
import { autoLogin, pullAll, isSessionExpiredError, ErpRateLimited } from '@/lib/erp/full-sync';
import { saveFullSnapshot } from '@/lib/db/snapshots';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/cron/sync
 * Backend sync — runs every 10 minutes via GitHub Actions. For every Google
 * user with sealed ERP credentials: decrypt, log in (auto captcha), pull
 * everything, and refresh their snapshot. No browser, no user interaction.
 *
 * Protected by CRON_SECRET (Authorization: Bearer …). The ERP password only
 * exists decrypted in memory for the duration of one user's sync.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let users: UserDoc[];
  try {
    const db = await getDb();
    users = await db
      .collection<UserDoc>('users')
      .find({ creds: { $exists: true }, universityId: { $exists: true } })
      .toArray();
  } catch (e) {
    if (isMongoMisconfigured(e)) {
      return Response.json({ error: 'MongoDB not configured.' }, { status: 503 });
    }
    throw e;
  }

  const results: { universityId: string; ok: boolean; error?: string }[] = [];
  for (const user of users) {
    const universityId = user.universityId ?? '';
    try {
      if (!user.creds) throw new Error('No sealed credentials.');
      const sealed = unsealSession<{ pw?: string }>(user.creds);
      const password = sealed?.pw;
      if (!password) throw new Error('Could not decrypt credentials.');
      const authed = await autoLogin(universityId, password);
      const data = await pullAll(authed);
      await saveFullSnapshot({ universityId, googleId: user.googleId, term: data.term, data });
      results.push({ universityId, ok: true });
    } catch (e) {
      if (e instanceof ErpRateLimited) {
        results.push({ universityId, ok: false, error: 'ERP rate-limited; backing off.' });
        break; // don't hammer the ERP — remaining users wait for the next tick
      }
      if (isSessionExpiredError(e)) {
        results.push({ universityId, ok: false, error: 'ERP session expired mid-sync.' });
        continue;
      }
      console.error(`[api/cron/sync] ${universityId}:`, e instanceof Error ? e.message : e);
      results.push({ universityId, ok: false, error: e instanceof Error ? e.message : 'Sync failed.' });
    }
  }

  return Response.json({ ok: true, synced: results.filter((r) => r.ok).length, results });
}
