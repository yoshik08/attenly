import { interactiveLogin, pullAll, ErpRateLimited, isSessionExpiredError } from '@/lib/erp/full-sync';
import { localBody, localJson, sealErp, sealLogin } from '@/lib/local';
import { snapshotFromPull, termIdsOf } from '@/lib/local-snapshot';
import { CORE_DATASETS } from '@/lib/sync-codes';
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
 * POST /api/local/login
 * Body: { universityId, password, captchaText, sessionToken, term? }
 *
 * Sign in without Google: logs into the ERP with the captcha the person confirmed and
 * pulls everything for the term, like /api/erp/link-and-sync, but saves nothing. The
 * browser gets the snapshot, its login sealed so only this server can open it (`key`),
 * and the sealed ERP session (X-Attenly-Erp) to reuse on its next sync.
 */
export async function POST(req: Request) {
  const body = await localBody(req);
  const str = (k: string, max: number) => (typeof body[k] === 'string' ? (body[k] as string).slice(0, max) : '');
  const universityId = str('universityId', 32).trim();
  const password = str('password', 128);
  const captchaText = str('captchaText', 16).trim();
  const sessionToken = str('sessionToken', 4096);
  if (!universityId || !password || !captchaText || !sessionToken) {
    return fail(400, 'missing_fields', 'Fill in your University ID, password and the captcha.');
  }
  if (!/^[A-Za-z0-9]+$/.test(universityId)) {
    return fail(400, 'bad_id', 'A University ID is letters and digits only.');
  }

  let session: Awaited<ReturnType<typeof interactiveLogin>>;
  try {
    session = await interactiveLogin(universityId, password, captchaText, sessionToken);
  } catch (e) {
    if (e instanceof ErpRateLimited) return fail(429, 'rate_limited', e.message);
    const code = (e as { code?: string }).code;
    if (!code) {
      console.error('[api/local/login] login', e instanceof Error ? e.message : e);
      return fail(502, 'erp_unreachable', 'Attenly could not reach the ERP. Try again in a moment.');
    }
    return fail(LOGIN_STATUS[code] ?? 401, code, e instanceof Error ? e.message : 'The ERP did not accept the login.');
  }

  try {
    // Re-entering a password keeps the semester this device picked.
    const chosen = termIdsOf(body.term);
    const data = await pullAll(session, chosen ? termFromIds(chosen, session.termOptions) : undefined, { registers: true });
    if (CORE_DATASETS.every((d) => data.failed.includes(d))) {
      return fail(502, 'erp_unreachable', 'The ERP accepted the login but returned no data. Try again in a moment.');
    }
    return localJson(
      {
        ok: true,
        universityId,
        key: sealLogin(universityId, password),
        snapshot: snapshotFromPull(universityId, data, session.termOptions),
        failed: data.failed,
      },
      sealErp(universityId, session),
    );
  } catch (e) {
    if (e instanceof ErpRateLimited) return fail(429, 'rate_limited', e.message);
    if (isSessionExpiredError(e)) return fail(502, 'failed', 'The ERP session dropped mid-sync. Try again.');
    console.error('[api/local/login] pull', e instanceof Error ? e.message : e);
    return fail(502, 'failed', 'Signing in stopped partway. Try again in a moment.');
  }
}
