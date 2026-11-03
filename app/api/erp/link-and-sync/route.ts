import { getGoogleUser, unauthorized } from '@/lib/auth';
import { interactiveLogin, pullAll, ErpRateLimited, isSessionExpiredError } from '@/lib/erp/full-sync';
import { getLatestSnapshot, saveFullSnapshot, toClientSnapshot } from '@/lib/db/snapshots';
import { findAccount, getUser, linkAccount } from '@/lib/db/users';
import { termFromIds } from '@/lib/terms';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LOGIN_STATUS: Record<string, number> = {
  captcha_expired: 422,
  bad_captcha: 422,
  bad_credentials: 401,
  rate_limited: 429,
};

function fail(status: number, code: string, error: string) {
  return Response.json({ ok: false, code, error }, { status });
}

/**
 * POST /api/erp/link-and-sync
 * Body: { universityId, password, captchaText, sessionToken, label? }
 *
 * Logs into the ERP with the captcha the person confirmed, pulls everything
 * for the current term, and only then saves the account (password stored
 * as-is, by the owner's choice) against the signed-in Google user.
 */
export async function POST(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (k: string, max: number) => (typeof body?.[k] === 'string' ? (body[k] as string).slice(0, max) : '');
  const universityId = str('universityId', 32).trim();
  const password = str('password', 128);
  const captchaText = str('captchaText', 16).trim();
  const sessionToken = str('sessionToken', 4096);
  const label = str('label', 40).trim();
  if (!universityId || !password || !captchaText || !sessionToken) {
    return fail(400, 'missing_fields', 'Fill in your University ID, password and the captcha.');
  }
  if (!/^[A-Za-z0-9]+$/.test(universityId)) {
    return fail(400, 'bad_id', 'A University ID is letters and digits only.');
  }

  // 1. Log in. A coded error is the ERP's own verdict and its words are the
  //    most useful message; anything else means the ERP couldn't be reached.
  let session: Awaited<ReturnType<typeof interactiveLogin>>;
  try {
    session = await interactiveLogin(universityId, password, captchaText, sessionToken);
  } catch (e) {
    if (e instanceof ErpRateLimited) return fail(429, 'rate_limited', e.message);
    const code = (e as { code?: string }).code;
    if (!code) {
      console.error('[api/erp/link-and-sync] login', e instanceof Error ? e.message : e);
      return fail(502, 'erp_unreachable', 'Attenly could not reach the ERP. Try again in a moment.');
    }
    return fail(LOGIN_STATUS[code] ?? 401, code, e instanceof Error ? e.message : 'The ERP did not accept the login.');
  }

  // 2. Pull and save, then remember the account.
  try {
    // Re-entering a password keeps the term chosen in Settings.
    const existing = await getUser(me.googleId);
    const chosen = existing ? findAccount(existing, universityId)?.term : null;
    const data = await pullAll(session, chosen ? termFromIds(chosen, session.termOptions) : undefined);
    if (data.failed.length === 5) {
      return fail(502, 'erp_unreachable', 'The ERP accepted the login but returned no data. Try again in a moment.');
    }
    const previous = await getLatestSnapshot(me.googleId, universityId);
    const saved = await saveFullSnapshot({
      universityId,
      googleId: me.googleId,
      data,
      previous,
      termOptions: session.termOptions,
    });
    await linkAccount({
      googleId: me.googleId,
      email: me.email ?? '',
      name: me.name ?? undefined,
      universityId,
      password,
      label: label || undefined,
    });
    return Response.json({ ok: true, universityId, snapshot: toClientSnapshot(saved) });
  } catch (e) {
    if (e instanceof ErpRateLimited) return fail(429, 'rate_limited', e.message);
    if (isSessionExpiredError(e)) return fail(502, 'failed', 'The ERP session dropped mid-sync. Try again.');
    console.error('[api/erp/link-and-sync] sync', e instanceof Error ? e.message : e);
    return fail(502, 'failed', 'Linking stopped partway. Try again in a moment.');
  }
}
