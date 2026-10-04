import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { interactiveLogin, pullAll } from '@/lib/erp/full-sync';
import { saveFullSnapshot } from '@/lib/db/snapshots';
import { upsertUserCreds } from '@/lib/db/users';
import { sealSession, ErpRateLimited } from '@/lib/erp/client';
import { refreshSessionCookie } from '@/lib/erp/session';
import { isMongoMisconfigured } from '@/lib/db/mongo';

export const dynamic = 'force-dynamic';

/**
 * POST /api/erp/link-and-sync
 * Body: { universityId, password, captchaText, sessionToken }
 *
 * One-shot interactive link: logs into the ERP, pulls attendance + timetable
 * + internals + results + CGPA, seals the password into the user row, and
 * stores the full snapshot. Returns the parsed data so the UI can render
 * immediately without a second round-trip.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const universityId = typeof body.universityId === 'string' ? body.universityId.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const captchaText = typeof body.captchaText === 'string' ? body.captchaText : '';
  const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : '';
  if (!universityId || !password || !captchaText || !sessionToken) {
    return Response.json({ error: 'Missing login fields.' }, { status: 400 });
  }

  try {
    const authed = await interactiveLogin(universityId, password, captchaText, sessionToken);
    // Keep the ERP session cookie fresh for the file/booklet proxies.
    await refreshSessionCookie(authed);
    const data = await pullAll(authed);

    const gsession = await getServerSession(authOptions);
    const googleId = (gsession?.user as { id?: string } | undefined)?.id;

    try {
      await saveFullSnapshot({ universityId, googleId, term: data.term, data, password });
      if (googleId) {
        await upsertUserCreds({
          googleId,
          email: gsession?.user?.email ?? '',
          name: gsession?.user?.name ?? undefined,
          universityId,
          creds: sealSession({ pw: password }),
        });
      }
    } catch (e) {
      if (isMongoMisconfigured(e)) {
        console.warn('[api/erp/link-and-sync] MongoDB not configured — skipping snapshot.');
      } else {
        throw e;
      }
    }

    return Response.json({ ok: true, data });
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return Response.json({ error: e.message, code: 'rate_limited' }, { status: 429 });
    }
    const code = (e as { code?: string }).code;
    console.error('[api/erp/link-and-sync]', e instanceof Error ? e.message : e);
    return Response.json(
      { error: e instanceof Error ? e.message : 'Link failed.', code: code ?? 'unknown' },
      { status: code === 'captcha_expired' || code === 'bad_captcha' ? 422 : 502 },
    );
  }
}
