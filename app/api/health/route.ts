import { getDb, isMongoMisconfigured } from '@/lib/db/mongo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — is this deployment wired up? Reports whether MongoDB
 * answers (and how many Google users have an ERP account linked) and whether
 * a captcha solver is configured. Never returns anyone's data.
 */
export async function GET() {
  const started = Date.now();
  let db: 'ok' | 'unreachable' | 'not_configured' = 'ok';
  let linkedUsers: number | null = null;
  try {
    const d = await getDb();
    await d.command({ ping: 1 });
    linkedUsers = await d
      .collection('users')
      .countDocuments({ $or: [{ 'accounts.0': { $exists: true } }, { erpUid: { $exists: true } }, { universityId: { $exists: true } }] });
  } catch (e) {
    db = isMongoMisconfigured(e) ? 'not_configured' : 'unreachable';
    console.error('[api/health] db', e instanceof Error ? e.message : e);
  }
  return Response.json(
    { ok: db === 'ok', db, linkedUsers, solver: Boolean(process.env.SOLVER_URL), ms: Date.now() - started },
    { status: db === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
