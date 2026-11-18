import { readPaperScan } from '@/lib/erp/records';
import { paperKeyFrom, scanResponse } from '@/lib/erp/serve';
import { localBody, localDocFailure, withLocalErp } from '@/lib/local';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/local/booklet (a form, opened in a new tab)
 * Fields: key, erp, code, exam, ay, sem
 *
 * One booklet's scanned answer script for a browser signed in without Google, streamed
 * from the ERP exactly as /api/erp/booklet does. A form post, not a link, so the sealed
 * login never sits in an address bar or a server log.
 */
export async function POST(req: Request) {
  const body = await localBody(req);
  const key = paperKeyFrom((n) => (typeof body[n] === 'string' ? (body[n] as string) : null));
  if (!key) return new Response('Say which paper to open.', { status: 400 });
  try {
    const { value: scan } = await withLocalErp(body, (s) => readPaperScan(s, key));
    return await scanResponse(scan, key);
  } catch (e) {
    console.error('[api/local/booklet]', e instanceof Error ? e.message : e);
    return localDocFailure(e, 'The ERP didn’t hand over that scan. Try again in a moment.');
  }
}
