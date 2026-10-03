/** Server-side helpers for the encrypted ERP session cookie. */
import { cookies } from 'next/headers';
import { sealSession, unsealSession, type AuthedSession } from './client';

export const SESSION_COOKIE = 'erp_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export async function getAuthedSession(): Promise<AuthedSession | null> {
  const v = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!v) return null;
  return unsealSession<AuthedSession>(v);
}

/** Re-seal the session cookie with a fresh jar/csrf and renewed expiry. */
export async function refreshSessionCookie(session: AuthedSession): Promise<void> {
  const token = sealSession({ ...session, exp: Date.now() + SESSION_TTL_MS });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
