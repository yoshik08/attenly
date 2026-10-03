import { startLoginSession, ErpRateLimited } from '@/lib/erp/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/captcha
 * Fetches the ERP login page server-side, extracts the CSRF token and the
 * session-bound captcha image, and returns the image (base64 data URL) plus an
 * opaque, short-lived session token. The raw cookies never leave the server.
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
    return Response.json({ error: 'Could not reach the ERP. Please try again.' }, { status: 502 });
  }
}
