import { startLoginSession, unsealSession, type CaptchaSession } from './client';
import { coded } from './errors';

export interface SolvedCaptcha {
  captchaImage: string;
  sessionToken: string;
  solution: string;
  preSession: CaptchaSession;
}

/** The Render free tier can take ~30 s to wake the solver. */
const SOLVER_TIMEOUT_MS = 45_000;

/**
 * Fetch a fresh ERP captcha and read it with the CRNN solver at SOLVER_URL.
 * Server-side only. Coded errors: 'no_solver' | 'captcha_expired' |
 * 'solve_failed'; ErpRateLimited and ERP network errors propagate as-is.
 */
export async function fetchSolvedCaptcha(): Promise<SolvedCaptcha> {
  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) throw coded('Auto-decode is not configured.', 'no_solver');

  const { captchaImage, sessionToken } = await startLoginSession();
  const preSession = unsealSession<CaptchaSession>(sessionToken);
  if (!preSession) throw coded('Captcha session expired.', 'captcha_expired');

  let res: Response;
  try {
    res = await fetch(new URL('/solve', solverUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captchaImage }),
      signal: AbortSignal.timeout(SOLVER_TIMEOUT_MS),
    });
  } catch (e) {
    throw coded(`Solver unreachable: ${e instanceof Error ? e.message : String(e)}`, 'solve_failed');
  }
  if (!res.ok) throw coded(`Solver HTTP ${res.status}`, 'solve_failed');

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const solution = String(data.solution ?? data.text ?? data.captcha ?? '').trim();
  if (!solution) throw coded('Solver returned no text.', 'solve_failed');

  return { captchaImage, sessionToken, solution, preSession };
}
