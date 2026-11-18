import { startLoginSession, ErpRateLimited } from '@/lib/erp/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/captcha — a fresh ERP captcha to type by hand (the fallback
 * when auto-decode is unavailable). Returns the image as a data URL plus an
 * opaque, five-minute session token; the ERP cookies never leave the server.
 * Open without Google: signing in without it (/api/local/login) needs one too.
 */
export async function GET() {
  try {
    const { captchaImage, sessionToken } = await startLoginSession();
    return Response.json({ captchaImage, sessionToken });
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return Response.json({ error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    console.error('[api/erp/captcha]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Attenly could not reach the ERP. Try again in a moment.', code: 'erp_unreachable' }, { status: 502 });
  }
}
