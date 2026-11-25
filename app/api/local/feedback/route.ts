import { submitAllFeedback } from '@/lib/erp/feedback';
import { localBody, localFailure, localJson, withLocalErp } from '@/lib/local';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/local/feedback
 * Body: { key, erp? }
 *
 * "Force submit" for a browser signed in without Google: answers every pending course
 * feedback form on the ERP with Good and posts it (lib/erp/feedback.ts). Writes to the
 * ERP; only ever called from the button.
 */
export async function POST(req: Request) {
  const body = await localBody(req);
  try {
    const { value, erp } = await withLocalErp(body, (s) => submitAllFeedback(s));
    return localJson({ ok: true, run: value, at: new Date().toISOString() }, erp);
  } catch (e) {
    console.error('[api/local/feedback]', e instanceof Error ? e.message : e);
    return localFailure(e, 'The ERP didn’t answer, so no feedback was submitted. Try again in a moment.');
  }
}
