import {
  performLogin,
  unsealSession,
  sealSession,
  ErpRateLimited,
  type CaptchaSession,
} from '@/lib/erp/client';
import { sessionCookieOptions, SESSION_COOKIE } from '@/lib/erp/session';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/erp/login  { universityId, password, captchaText, sessionToken }
 * Performs the ERP login server-side per the protocol. On success sets an
 * httpOnly, AES-256-GCM-encrypted session cookie holding the cookie jar + CSRF.
 * The password is used only for this request — never stored or logged.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    universityId?: string;
    password?: string;
    captchaText?: string;
    sessionToken?: string;
  } | null;

  const { universityId, password, captchaText, sessionToken } = body ?? {};
  if (!universityId || !password || !captchaText || !sessionToken) {
    return Response.json({ error: 'Please fill in every field.' }, { status: 400 });
  }

  const preSession = unsealSession<CaptchaSession>(sessionToken);
  if (!preSession) {
    return Response.json(
      { ok: false, error: 'Captcha expired. Please reload it and try again.', code: 'captcha_expired' },
      { status: 400 },
    );
  }

  try {
    const result = await performLogin(preSession, universityId, password, captchaText);
    if (!result.ok) {
      const status = result.code === 'rate_limited' ? 429 : 401;
      return Response.json({ ok: false, error: result.error, code: result.code }, { status });
    }
    const token = sealSession({
      jar: result.jar,
      csrf: result.csrf,
      exp: Date.now() + 7 * 24 * 3600 * 1000,
    });
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
    return Response.json({ ok: true, termOptions: result.termOptions ?? { years: [], semesters: [] } });
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return Response.json({ ok: false, error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    console.error('[api/erp/login]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Login failed. Please try again.', code: 'unknown' }, { status: 502 });
  }
}
