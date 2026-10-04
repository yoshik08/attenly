import {
  fetchErpBinary,
  isSessionExpiredError,
  ErpRateLimited,
} from '@/lib/erp/client';
import { getAuthedSession } from '@/lib/erp/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/erp/file?u=<ERP-relative download URL>
 * Proxies a binary download (answer-script PDF) from the ERP through the
 * user's ERP session and streams it back so the browser can open it in a
 * new tab. The ERP URL must be same-origin; anything else is refused.
 */
export async function GET(req: Request) {
  const session = await getAuthedSession();
  if (!session) {
    return Response.json({ error: 'Not logged in.', code: 'session_expired' }, { status: 401 });
  }
  const u = new URL(req.url).searchParams.get('u') ?? '';
  if (!u) {
    return Response.json({ error: 'Missing file URL.' }, { status: 400 });
  }

  try {
    const { bytes, contentType } = await fetchErpBinary(session, u);
    const body = new Uint8Array(bytes);
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    if (isSessionExpiredError(e)) {
      return Response.json(
        { error: 'ERP session expired. Please log in again.', code: 'session_expired' },
        { status: 401 },
      );
    }
    if (e instanceof ErpRateLimited) {
      return Response.json({ error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    console.error('[api/erp/file]', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Could not fetch the file from the ERP.' }, { status: 502 });
  }
}
