import { createRemoteJWKSet, jwtVerify } from 'jose';
import { accountsOf, usersWithAccounts } from '@/lib/db/users';
import { syncAccount, type SyncCode } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/cron/sync — the backend sync, triggered by GitHub Actions.
 * Syncs every linked ERP account whose data is older than ~5.5 minutes,
 * skipping accounts that are waiting for a new password.
 *
 * Auth: a GitHub Actions OIDC token (audience "attenly-cron", repository
 * yoshik08/attenly), or CRON_SECRET as a manual fallback.
 *
 * The response is printed in a public Actions log, so account ids are masked.
 */
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE = 'attenly-cron';
const OIDC_REPO = 'yoshik08/attenly';
const JWKS = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));

/** Stop starting new syncs after this, so the function finishes inside maxDuration. */
const BUDGET_MS = 230_000;

async function authorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && token === secret) return true;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: OIDC_ISSUER, audience: OIDC_AUDIENCE });
    return payload.repository === OIDC_REPO;
  } catch {
    return false;
  }
}

const mask = (id: string) => `…${id.slice(-3)}`;

export async function POST(req: Request) {
  if (!(await authorized(req))) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const started = Date.now();

  let users;
  try {
    users = await usersWithAccounts();
  } catch (e) {
    console.error('[api/cron/sync] users', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Database unavailable.' }, { status: 503 });
  }

  const results: { account: string; code: SyncCode | 'skipped_budget' }[] = [];
  let rateLimited = false;
  for (const user of users) {
    for (const account of accountsOf(user)) {
      if (rateLimited || Date.now() - started > BUDGET_MS) {
        results.push({ account: mask(account.universityId), code: 'skipped_budget' });
        continue;
      }
      const r = await syncAccount({ user, universityId: account.universityId, force: false });
      results.push({ account: mask(account.universityId), code: r.code });
      if (r.code === 'rate_limited') rateLimited = true; // back off: the rest wait for the next run
    }
  }

  const count = (codes: string[]) => results.filter((r) => codes.includes(r.code)).length;
  return Response.json({
    ok: true,
    synced: count(['synced']),
    fresh: count(['fresh']),
    waiting: count(['needs_password', 'skipped_budget', 'busy']),
    failed: results.length - count(['synced', 'fresh', 'needs_password', 'skipped_budget', 'busy']),
    results,
  });
}
