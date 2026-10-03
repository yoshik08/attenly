import { fetchSolvedCaptcha } from '@/lib/erp/autocaptcha';
import { ErpRateLimited } from '@/lib/erp/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/auto-captcha
 * Fetches a fresh ERP captcha and, when a REST solver is configured via
 * SOLVER_URL, decodes it server-side. Responds with { image, solution,
 * sessionToken }. The solver's internals never reach the client — only the
 * plain-text solution. Without SOLVER_URL, responds 501 so the UI falls
 * back to manual entry.
 */
export async function GET() {
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
    // Generic message — never leak solver internals or ERP details.
    return Response.json(
      { error: 'Auto-decode failed. Type the captcha yourself.', code: 'solve_failed' },
      { status: 502 },
    );
  }
}
