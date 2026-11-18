/**
 * Signing in without Google (the /api/local/* routes). The browser keeps everything
 * (components/local.ts) and this server keeps nothing: no user, no snapshot, no ERP
 * session, nothing in the database. Nothing here imports it.
 *
 * What the server hands the browser is sealed with SESSION_SECRET (AES-256-GCM, the
 * same seal as the captcha tokens in lib/erp/client.ts). The browser holds its login
 * without being able to read it back, and only this server can open it when the
 * browser asks for a sync. The sealed ERP session rides along so a sync usually skips
 * the captcha and the login.
 */
import { ErpRateLimited, isSessionExpiredError, sealSession, unsealSession, type AuthedSession } from './erp/client';
import { autoLogin } from './erp/full-sync';
import { coded } from './erp/errors';

import { LOCAL_ERP_HEADER } from './local-snapshot';

/** A sealed ERP session is tried for this long before logging in again (the ERP's PHP session lasts hours). */
const ERP_TTL_MS = 6 * 3600_000;

const UID = /^[A-Za-z0-9]{1,32}$/;

interface SealedLogin {
  t: 'login';
  u: string;
  p: string;
}

interface SealedErp {
  t: 'erp';
  u: string;
  jar: AuthedSession['jar'];
  csrf: string;
  term?: AuthedSession['term'];
  termOptions?: AuthedSession['termOptions'];
  exp: number;
}

/** The University ID and password, sealed for the browser to keep. It never expires; signing out drops it. */
export function sealLogin(universityId: string, password: string): string {
  return sealSession({ t: 'login', u: universityId, p: password } satisfies SealedLogin);
}

/** Opens a sealed login, or null when it is not one (tampered, another kind of token, another server's key). */
export function openLogin(token: unknown): { universityId: string; password: string } | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const v = unsealSession<SealedLogin>(token);
  if (!v || v.t !== 'login' || typeof v.u !== 'string' || !UID.test(v.u) || typeof v.p !== 'string' || !v.p) return null;
  return { universityId: v.u, password: v.p };
}

/** A logged-in ERP session, sealed for the browser and bound to its University ID. */
export function sealErp(universityId: string, s: AuthedSession): string {
  return sealSession({
    t: 'erp',
    u: universityId,
    jar: s.jar,
    csrf: s.csrf,
    ...(s.term ? { term: s.term } : {}),
    ...(s.termOptions ? { termOptions: s.termOptions } : {}),
    exp: Date.now() + ERP_TTL_MS,
  } satisfies SealedErp);
}

/** Opens a sealed ERP session for this University ID, or null when it is missing, expired or someone else's. */
export function openErp(token: unknown, universityId: string): AuthedSession | null {
  if (typeof token !== 'string' || !token || token.length > 16_384) return null;
  const v = unsealSession<SealedErp>(token);
  if (!v || v.t !== 'erp' || v.u !== universityId || !v.jar || typeof v.jar !== 'object' || Object.keys(v.jar).length === 0 || !v.csrf) return null;
  return {
    jar: v.jar,
    csrf: v.csrf,
    exp: v.exp,
    ...(v.term ? { term: v.term } : {}),
    ...(v.termOptions ? { termOptions: v.termOptions } : {}),
  };
}

/**
 * A local request's fields: JSON from fetch(), or a form when the browser opens a
 * document in a new tab (a form post keeps the sealed login out of the address bar).
 */
export async function localBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = (await req.json()) as unknown;
      return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      return Object.fromEntries([...(await req.formData()).entries()].filter(([, v]) => typeof v === 'string'));
    }
  } catch {
    /* unreadable body: treated as empty */
  }
  return {};
}

/** The answer when the browser's sealed login can't be opened: sign in again. */
export function signedOut(): Response {
  return Response.json(
    { ok: false, code: 'needs_password', error: 'This device’s saved login can’t be read anymore. Enter your ERP password again.' },
    { status: 401 },
  );
}

/**
 * Runs `fn` with a logged-in ERP session for the browser's sealed login: the sealed
 * session it sent when that still works, else a fresh login with the captcha read
 * in-process. Gives back the session to hand to the browser (LOCAL_ERP_HEADER).
 * Throws a coded 'needs_password' when the login can't be opened.
 */
export async function withLocalErp<T>(
  body: Record<string, unknown>,
  fn: (session: AuthedSession) => Promise<T>,
): Promise<{ value: T; erp: string; universityId: string }> {
  const login = openLogin(body.key);
  if (!login) throw coded('This device’s saved login can’t be read anymore.', 'needs_password');
  const { universityId, password } = login;
  let session = openErp(body.erp, universityId) ?? (await autoLogin(universityId, password));
  let value: T;
  try {
    value = await fn(session);
  } catch (e) {
    if (!isSessionExpiredError(e)) throw e;
    // The ERP dropped the session it was given: log in once and try again.
    session = await autoLogin(universityId, password);
    value = await fn(session);
  }
  return { value, erp: sealErp(universityId, session), universityId };
}

/**
 * The JSON answer for a local request that failed: a login that can't be opened or a
 * password the ERP now rejects (the browser asks for it again), a rate limit, or `fallback`.
 */
export function localFailure(e: unknown, fallback: string): Response {
  const code = (e as { code?: string })?.code;
  if (code === 'needs_password') return signedOut();
  if (code === 'bad_credentials') {
    return Response.json({ ok: false, code, error: 'The ERP rejected the saved password. Enter your current ERP password.' }, { status: 409 });
  }
  if (e instanceof ErpRateLimited || code === 'rate_limited') {
    return Response.json({ ok: false, code: 'rate_limited', error: 'The ERP is rate-limiting logins. Try again in a minute.' }, { status: 429 });
  }
  return Response.json({ ok: false, code: 'erp_failed', error: fallback }, { status: 502 });
}

/** The plain-text answer for a document opened in its own tab that failed. */
export function localDocFailure(e: unknown, fallback: string): Response {
  const code = (e as { code?: string })?.code;
  if (code === 'needs_password' || code === 'bad_credentials') {
    return new Response('Attenly can’t sign into the ERP with this device’s saved login. Open Attenly and enter your ERP password again.', { status: 401 });
  }
  if (e instanceof ErpRateLimited || code === 'rate_limited') return new Response('The ERP is rate-limiting logins. Try again in a minute.', { status: 429 });
  return new Response(fallback, { status: 502 });
}

/** A JSON answer that also hands back the sealed ERP session. */
export function localJson(body: unknown, erp: string | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (erp) headers.set(LOCAL_ERP_HEADER, erp);
  return Response.json(body, { ...init, headers });
}
