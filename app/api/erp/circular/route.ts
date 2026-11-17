import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser } from '@/lib/db/users';
import { readCircularDocument, withErpSession } from '@/lib/erp/records';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/erp/circular?id=<circular id>&account=<university id>
 *
 * A circular's document, read from the ERP and passed through. The browser only
 * ever names the circular's number; the ERP's link never leaves the server.
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!/^\d{1,9}$/.test(id)) return new Response('Say which circular to open.', { status: 400 });

  const user = await getUser(me.googleId).catch(() => null);
  const account = user ? findAccount(user, url.searchParams.get('account')) : null;
  if (!account) return new Response('That account isn’t linked.', { status: 404 });

  try {
    const doc = await withErpSession(account, (s) => readCircularDocument(s, id));
    if (!doc) return new Response('That circular has no document on the ERP.', { status: 404 });
    const type = doc.contentType.split(';')[0].trim().toLowerCase();
    // Only documents pass through: an HTML answer from the ERP must never render on this origin.
    if (!/^(application\/pdf|image\/(png|jpe?g|gif|webp))$/.test(type)) {
      return new Response('The ERP didn’t hand over a readable document for that circular.', { status: 502 });
    }
    const filename = (doc.filename ?? `circular-${id}${type === 'application/pdf' ? '.pdf' : ''}`).replace(/[^\w.\- ]+/g, '_');
    return new Response(new Uint8Array(doc.bytes), {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    console.error('[api/erp/circular]', e instanceof Error ? e.message : e);
    return new Response('The ERP didn’t hand over that circular. Try again in a moment.', { status: 502 });
  }
}
