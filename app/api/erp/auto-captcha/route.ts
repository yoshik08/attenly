import { getGoogleUser, unauthorized } from '@/lib/auth';
import { fetchSolvedCaptcha } from '@/lib/erp/autocaptcha';
import { ErpRateLimited } from '@/lib/erp/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/erp/auto-captcha — a fresh ERP captcha already read in-process by the
 * CRNN model (lib/erp/solve.ts): { image, solution, sessionToken }. 502 when the
 * reading fails; the form then falls back to typing it.
 */
export async function GET() {
  if (!(await getGoogleUser())) return unauthorized();
  try {
    const { captchaImage, sessionToken, solution } = await fetchSolvedCaptcha();
    return Response.json({ image: captchaImage, solution, sessionToken });
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return Response.json({ error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    console.error('[api/erp/auto-captcha]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Auto-decode failed. Type the captcha yourself.', code: 'solve_failed' }, { status: 502 });
  }
}
