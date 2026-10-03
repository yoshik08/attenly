import { startLoginSession, ErpRateLimited } from '@/lib/erp/client';

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
  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) {
    return Response.json(
      { error: 'Auto-decode is not configured.', code: 'no_solver' },
      { status: 501 },
    );
  }

  try {
    const { captchaImage, sessionToken } = await startLoginSession();

    const solveEndpoint = new URL('/solve', solverUrl).toString();
    const res = await fetch(solveEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captchaImage }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`solver_http_${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
    const solution = String(data.solution ?? data.text ?? data.captcha ?? '').trim();
    if (!solution) throw new Error('solver_empty');

    return Response.json({ image: captchaImage, solution, sessionToken });
  } catch (e) {
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
