import { clearSessionCookie } from '@/lib/erp/session';

export const dynamic = 'force-dynamic';

/** POST /api/erp/logout — clears the encrypted ERP session cookie. */
export async function POST() {
  await clearSessionCookie();
  return Response.json({ ok: true });
}
