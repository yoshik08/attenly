import { startLoginSession, unsealSession, type CaptchaSession } from './client';
import { coded } from './errors';
import { solveCaptcha } from './solve';

export interface SolvedCaptcha {
  captchaImage: string;
  sessionToken: string;
  solution: string;
  preSession: CaptchaSession;
}

/**
 * What a real ERP captcha reads as: 6 or 7 lowercase letters (every sample seen; the
 * model's alphabet is a–z). Anything else is a misread not worth spending a login on.
 */
const PLAUSIBLE = /^[a-z]{6,7}$/;

/** Fresh captchas to try when the reading is implausible, before giving up. */
const READ_ATTEMPTS = 3;

/** The reader fetchSolvedCaptcha uses (lib/erp/solve.ts); tests swap it to simulate misreads. */
export const captchaReader = { read: solveCaptcha };

/**
 * Fetch a fresh ERP captcha and read it in-process with the CRNN model.
 * Server-side only. Coded errors: 'captcha_expired' | 'solve_failed';
 * ErpRateLimited and ERP network errors propagate as-is.
 */
export async function fetchSolvedCaptcha(): Promise<SolvedCaptcha> {
  let last = '';
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    const { captchaImage, sessionToken } = await startLoginSession();
    const preSession = unsealSession<CaptchaSession>(sessionToken);
    if (!preSession) throw coded('Captcha session expired.', 'captcha_expired');

    let solution: string;
    try {
      solution = (await captchaReader.read(captchaImage)).trim();
    } catch (e) {
      throw coded(e instanceof Error ? e.message : String(e), 'solve_failed');
    }
    if (PLAUSIBLE.test(solution)) return { captchaImage, sessionToken, solution, preSession };
    last = solution;
  }
  throw coded(`The captcha reader gave ${READ_ATTEMPTS} implausible readings in a row (last: "${last}").`, 'solve_failed');
}
