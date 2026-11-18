import { coded, pullAll } from '@/lib/erp/full-sync';
import { localBody, localJson, openLogin, signedOut, withLocalErp } from '@/lib/local';
import { sameTerm, snapshotFromPull, termIdsOf } from '@/lib/local-snapshot';
import { classifySyncError, CORE_DATASETS, SYNC_MESSAGES, SYNC_STATUS } from '@/lib/sync-codes';
import { termCandidates, termFromIds } from '@/lib/terms';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/local/sync
 * Body: { key, erp?, term?, reuse? }
 *
 * The Sync button of a browser signed in without Google. Opens its sealed login, reuses
 * its sealed ERP session when the ERP still honours it (otherwise logs in, reading the
 * captcha in-process) and pulls everything, registers included. Saves nothing: the
 * browser gets this pull's snapshot and the datasets that failed, and keeps the older
 * values of those itself (lib/local-snapshot.ts).
 *
 *   term   the year and semester picked in Settings (ERP ids), or absent for automatic
 *   reuse  the term the browser shows now, when it had attendance: reused instead of
 *          probing for the newest term while it still is the newest
 */
export async function POST(req: Request) {
  const body = await localBody(req);
  if (!openLogin(body.key)) return signedOut();
  const picked = termIdsOf(body.term);
  const reuse = termIdsOf(body.reuse);

  try {
    const { value, erp, universityId } = await withLocalErp(body, async (s) => {
      const newest = s.termOptions ? termCandidates(s.termOptions)[0] : undefined;
      const term = picked ? termFromIds(picked, s.termOptions) : newest && sameTerm(newest, reuse) ? newest : undefined;
      return { data: await pullAll(s, term, { registers: true }), termOptions: s.termOptions };
    });
    const { data, termOptions } = value;
    if (CORE_DATASETS.every((d) => data.failed.includes(d))) throw coded(SYNC_MESSAGES.erp_unreachable, 'erp_unreachable');
    return localJson({ ok: true, code: 'synced', snapshot: snapshotFromPull(universityId, data, termOptions), failed: data.failed }, erp);
  } catch (e) {
    const code = (e as { code?: string }).code === 'needs_password' ? 'needs_password' : classifySyncError(e);
    if (code === 'needs_password') return signedOut();
    console.error(`[api/local/sync] ${code}:`, e instanceof Error ? e.message : e);
    return Response.json({ ok: false, code, error: SYNC_MESSAGES[code] }, { status: SYNC_STATUS[code] ?? 502 });
  }
}
