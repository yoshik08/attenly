import { getGoogleUser, unauthorized } from '@/lib/auth';
import { fetchSolvedCaptcha } from '@/lib/erp/autocaptcha';
import { ErpRateLimited } from '@/lib/erp/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/erp/auto-captcha — a fresh ERP captcha already read by the CRNN
 * solver: { image, solution, sessionToken }. 501 when no solver is
 * configured, 502 when it fails; the form then falls back to typing it.
 */
export async function GET() {
  if (!(await getGoogleUser())) return unauthorized();
  try {
    const { captchaImage, sessionToken, solution } = await fetchSolvedCaptcha();
    return Response.json({ image: captchaImage, solution, sessionToken });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'no_solver') {
      return Response.json({ error: 'Auto-decode is not configured.', code: 'no_solver' }, { status: 501 });
    }
    if (e instanceof ErpRateLimited) {
      return Response.json({ error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    console.error('[api/erp/auto-captcha]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Auto-decode failed. Type the captcha yourself.', code: 'solve_failed' }, { status: 502 });
  }
}
