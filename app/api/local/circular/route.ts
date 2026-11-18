import { readCircularDocument } from '@/lib/erp/records';
import { circularResponse } from '@/lib/erp/serve';
import { localBody, localDocFailure, withLocalErp } from '@/lib/local';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/local/circular (a form, opened in a new tab)
 * Fields: key, erp, id
 *
 * A circular's document for a browser signed in without Google, passed through as
 * /api/erp/circular does. A form post, so the sealed login stays out of the address bar.
 */
export async function POST(req: Request) {
  const body = await localBody(req);
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^\d{1,9}$/.test(id)) return new Response('Say which circular to open.', { status: 400 });
  try {
    const { value: doc } = await withLocalErp(body, (s) => readCircularDocument(s, id));
    return circularResponse(doc, id);
  } catch (e) {
    console.error('[api/local/circular]', e instanceof Error ? e.message : e);
    return localDocFailure(e, 'The ERP didn’t hand over that circular. Try again in a moment.');
  }
}
