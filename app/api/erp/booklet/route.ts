import { getGoogleUser, unauthorized } from '@/lib/auth';
import { findAccount, getUser } from '@/lib/db/users';
import { readPaperScan, withErpSession } from '@/lib/erp/records';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

/**
 * GET /api/erp/booklet?account=<id>&code=<course>&exam=<exam>&ay=<2026-2027>&sem=<Odd Sem>
 *
 * The scanned answer script of one evaluated paper, streamed from the ERP (scans run to
 * several MB). The browser names the paper; the ERP's links never leave the server. The
 * ERP labels these files text/html, so only bytes that start like a PDF pass through.
 */
export async function GET(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();
  const url = new URL(req.url);
  const key = {
    courseCode: url.searchParams.get('code') ?? '',
    exam: url.searchParams.get('exam') ?? '',
    academicYear: url.searchParams.get('ay') ?? '',
    semester: url.searchParams.get('sem') ?? '',
  };
  if (!/^[A-Z0-9]{4,16}$/i.test(key.courseCode) || !key.exam || key.exam.length > 120 || !key.academicYear || !key.semester) {
    return new Response('Say which paper to open.', { status: 400 });
  }

  const user = await getUser(me.googleId).catch(() => null);
  const account = user ? findAccount(user, url.searchParams.get('account')) : null;
  if (!account) return new Response('That account isn’t linked.', { status: 404 });

  try {
    const scan = await withErpSession(account, (s) => readPaperScan(s, key));
    if (!scan) return new Response('The ERP has no scan for that paper.', { status: 404 });

    // Check the first bytes before committing to a response.
    const reader = scan.body.getReader();
    const first = await reader.read();
    const head = first.value ?? new Uint8Array();
    if (first.done || !PDF_MAGIC.every((b, i) => head[i] === b)) {
      await reader.cancel().catch(() => undefined);
      return new Response('The ERP didn’t hand over a readable scan for that paper.', { status: 502 });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel() {
        void reader.cancel();
      },
    });
    const name = `${key.courseCode}-${key.exam.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.pdf`;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${name}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        ...(scan.length ? { 'Content-Length': String(scan.length) } : {}),
      },
    });
  } catch (e) {
    console.error('[api/erp/booklet]', e instanceof Error ? e.message : e);
    return new Response('The ERP didn’t hand over that scan. Try again in a moment.', { status: 502 });
  }
}
