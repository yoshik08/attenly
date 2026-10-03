import { startLoginSession, unsealSession, type CaptchaSession } from './client';

export interface SolvedCaptcha {
  captchaImage: string;
  sessionToken: string;
  solution: string;
  preSession: CaptchaSession;
}

function codedError(message: string, code: string): Error {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/**
 * Fetches a fresh ERP captcha and decodes it via the configured solver.
 * Server-side only. Throws coded errors: 'no_solver' | 'captcha_expired' |
 * 'solve_failed' (ErpRateLimited propagates as-is).
 */
export async function fetchSolvedCaptcha(): Promise<SolvedCaptcha> {
  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) throw codedError('Auto-decode is not configured.', 'no_solver');

  const { captchaImage, sessionToken } = await startLoginSession();
  const preSession = unsealSession<CaptchaSession>(sessionToken);
  if (!preSession) throw codedError('Captcha session expired.', 'captcha_expired');

  const solveEndpoint = new URL('/solve', solverUrl).toString();
  const res = await fetch(solveEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: captchaImage }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw codedError(`Solver HTTP ${res.status}`, 'solve_failed');

  const data = (await res.json()) as Record<string, unknown>;
  const solution = String(data.solution ?? data.text ?? data.captcha ?? '').trim();
  if (!solution) throw codedError('Solver returned no text.', 'solve_failed');

  return { captchaImage, sessionToken, solution, preSession };
}
