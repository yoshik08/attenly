import { getGoogleUser, unauthorized } from '@/lib/auth';
import { getUser, setLastInstructionDay } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, not "2026-13-45". */
function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * PATCH /api/prefs — the small per-user preferences that are not tied to one
 * ERP account.
 * Body: { lastInstructionDay: 'YYYY-MM-DD' | null }
 *
 * The last instruction day ends the Forecast window. It is stored on the user
 * so it survives reloads, sign-outs and other devices.
 */
export async function PATCH(req: Request) {
  const me = await getGoogleUser();
  if (!me) return unauthorized();

  const body = (await req.json().catch(() => null)) as { lastInstructionDay?: unknown } | null;
  if (!body || !('lastInstructionDay' in body)) {
    return Response.json({ ok: false, error: 'Nothing to change.' }, { status: 400 });
  }
  const day = body.lastInstructionDay;
  if (day !== null && !isDay(day)) {
    return Response.json({ ok: false, error: 'Pick a real date.' }, { status: 400 });
  }

  try {
    const user = await getUser(me.googleId);
    if (!user) return Response.json({ ok: false, error: 'No account yet.' }, { status: 404 });
    const saved = await setLastInstructionDay(me.googleId, day as string | null);
    if (!saved) return Response.json({ ok: false, error: 'No account yet.' }, { status: 404 });
    return Response.json({ ok: true, lastInstructionDay: day });
  } catch (e) {
    console.error('[api/prefs]', e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: 'Attenly can’t reach its database right now.' }, { status: 503 });
  }
}
