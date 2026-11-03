/**
 * Server-side ERP client for newerp.kluniversity.in.
 *
 * All ERP traffic MUST go through these helpers (the ERP sends no CORS
 * headers, and its captcha/session cookies must be managed server-side).
 * Never call the ERP directly from browser code.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import {
  extractCsrf,
  extractCaptchaSrc,
  detectLoginForm,
  parseLoginErrors,
  classifyLoginError,
  pickLoginMessage,
  parseTermOptions,
  parseAttendance,
  type LoginErrorCode,
  type TermList,
} from './parsers';

export const ERP_BASE = process.env.ERP_BASE ?? 'https://newerp.kluniversity.in';
const LOGIN_PATH = '/index.php?r=site%2Flogin';
const ATTENDANCE_PAGE_PATH = '/index.php?r=studentattendance%2Fstudentdailyattendance%2Fsearchgetinput';
const ATTENDANCE_PATH = '/index.php?r=studentattendance%2Fstudentdailyattendance%2Fcourselist';
const INTERNALS_PATH = '/index.php?r=studentinfo%2Fstudentendexamresult%2Fgetstudentinternalmarks';
const RESULTS_PATH = '/index.php?r=studentinfo%2Fstudentendexamresult%2Fsemendresult';
const CGPA_PATH = '/index.php?r=studentinfo%2Fstudentendexamresult%2Fsearchgetmycgpa';

export type CookieJar = Record<string, string>;

export function emptyJar(): CookieJar {
  return {};
}

function parseSetCookies(headers: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const line of raw) {
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq > 0) out.push([pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()]);
  }
  return out;
}

export function mergeCookies(jar: CookieJar, headers: Headers): CookieJar {
  const next = { ...jar };
  for (const [k, v] of parseSetCookies(headers)) {
    if (v === '' || v.toLowerCase() === 'deleted') delete next[k];
    else next[k] = v;
  }
  return next;
}

export function jarHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export class ErpRateLimited extends Error {
  constructor() {
    super('ERP is rate-limiting requests. Please try again in a minute.');
    this.name = 'ErpRateLimited';
  }
}

export function looksRateLimited(status: number, text: string): boolean {
  if (status === 429) return true;
  // Ignore matches inside scripts/styles — the ERP's own login page embeds
  // this message in its client-side JS, which is not an actual rate limit.
  const visible = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return /too many requests/i.test(visible);
}

interface ErpResponse {
  status: number;
  text: string;
  jar: CookieJar;
  finalUrl: string;
}

/**
 * Fetch within the ERP origin, following 301/302/303 redirects manually
 * (converting to GET) so cookies stay under our control.
 */
export async function erpFetch(
  path: string,
  init: RequestInit,
  jar: CookieJar,
  maxRedirects = 8,
): Promise<ErpResponse> {
  let url = new URL(path, ERP_BASE).toString();
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;
  let headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    Referer: new URL(LOGIN_PATH, ERP_BASE).toString(),
    ...(init.headers as Record<string, string> | undefined),
  };
  let currentJar = { ...jar };

  for (let i = 0; i <= maxRedirects; i++) {
    if (Object.keys(currentJar).length > 0) headers['Cookie'] = jarHeader(currentJar);
    const res = await fetch(url, {
      ...init,
      method,
      body,
      headers,
      redirect: 'manual',
    });
    currentJar = mergeCookies(currentJar, res.headers);

    if ([301, 302, 303].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('ERP redirect without location');
      const next = new URL(loc, url);
      if (next.origin !== new URL(ERP_BASE).origin) {
        throw new Error('ERP redirected off-origin; refusing to follow');
      }
      url = next.toString();
      method = 'GET';
      body = undefined;
      headers = { ...headers, Referer: url };
      delete headers['Content-Type'];
      delete headers['Content-Length'];
      await res.arrayBuffer().catch(() => null);
      continue;
    }

    const text = await res.text();
    if (looksRateLimited(res.status, text)) throw new ErpRateLimited();
    // An error page parses as "no rows"; never let it pass for real data. The
    // page's own heading (e.g. Yii's exception name) goes into the message.
    if (res.status >= 400) {
      // Yii answers XHR errors in plain text ("Name: message"), pages with an <h1>.
      const heading = (text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? text)
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\b\d{8,12}\b/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
      throw Object.assign(new Error(`ERP answered HTTP ${res.status}${heading ? ` (${heading})` : ''}`), { status: res.status });
    }
    return { status: res.status, text, jar: currentJar, finalUrl: url };
  }
  throw new Error('Too many redirects talking to the ERP');
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

// ---------------------------------------------------------------------------
// Session encryption (AES-256-GCM). Used for both the short-lived pre-login
// session token and the httpOnly login session cookie.
// ---------------------------------------------------------------------------

let devKey: Buffer | null = null;

function sessionKey(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (s) {
    const hex = s.replace(/[^0-9a-f]/gi, '');
    if (hex.length === 64) return Buffer.from(hex, 'hex');
    const b64 = Buffer.from(s.replace(/\s/g, ''), 'base64');
    if (b64.length === 32) return b64;
    throw new Error('SESSION_SECRET must decode to 32 bytes (64 hex chars or base64)');
  }
  if (!devKey) {
    devKey = randomBytes(32);
    console.warn(
      '[erp] SESSION_SECRET not set — using an ephemeral key. Sessions will not survive restarts. Set SESSION_SECRET in production.',
    );
  }
  return devKey;
}

/** Seal a JSON-serializable payload into an opaque token string. */
export function sealSession(payload: Record<string, unknown>): string {
  const key = sessionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

/** Unseal a token; returns null when invalid, tampered, or expired. */
export function unsealSession<T = Record<string, unknown>>(token: string): (T & { exp?: number }) | null {
  try {
    const key = sessionKey();
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const obj = JSON.parse(pt.toString('utf8')) as T & { exp?: number };
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Protocol flows
// ---------------------------------------------------------------------------

export interface CaptchaSession {
  jar: CookieJar;
  csrf: string;
  exp: number;
}

export async function startLoginSession(): Promise<{
  captchaImage: string;
  contentType: string;
  sessionToken: string;
}> {
  const loginUrl = new URL(LOGIN_PATH, ERP_BASE).toString();
  const page = await erpFetch(LOGIN_PATH, { method: 'GET' }, emptyJar());
  const csrf = extractCsrf(page.text);
  const captchaSrc = extractCaptchaSrc(page.text);
  if (!csrf || !captchaSrc) {
    throw new Error('Could not read the ERP login page (CSRF/captcha missing)');
  }
  const captchaUrl = new URL(captchaSrc, loginUrl).toString();
  // Fetch the image bytes directly with the same session cookies (the captcha
  // is bound to the PHP session, so it must be fetched in-session).
  const bin = await fetch(captchaUrl, {
    headers: {
      Referer: loginUrl,
      Cookie: jarHeader(page.jar),
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'image/*',
    },
    redirect: 'manual',
  });
  if (bin.status === 429) throw new ErpRateLimited();
  if (!bin.ok) throw new Error(`ERP captcha answered HTTP ${bin.status}`);
  const jar = mergeCookies(page.jar, bin.headers);
  const buf = Buffer.from(await bin.arrayBuffer());
  const contentType = bin.headers.get('content-type') ?? 'image/png';
  const sessionToken = sealSession({
    jar,
    csrf,
    exp: Date.now() + 5 * 60 * 1000,
  } satisfies CaptchaSession);
  return {
    captchaImage: `data:${contentType};base64,${buf.toString('base64')}`,
    contentType,
    sessionToken,
  };
}

export interface LoginResult {
  ok: boolean;
  jar?: CookieJar;
  csrf?: string;
  termOptions?: TermList;
  error?: string;
  code?: LoginErrorCode;
}

const LOGIN_MESSAGES: Record<LoginErrorCode, string> = {
  bad_captcha: 'The captcha was read wrong.',
  bad_credentials: 'The ERP rejected that University ID or password.',
  rate_limited: 'The ERP is rate-limiting logins. Try again in a minute.',
  unknown: 'The ERP did not accept the login.',
};

export async function performLogin(
  session: CaptchaSession,
  username: string,
  password: string,
  captchaText: string,
): Promise<LoginResult> {
  try {
    const res = await erpFetch(
      LOGIN_PATH,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: new URL(ERP_BASE).origin,
          Referer: new URL(LOGIN_PATH, ERP_BASE).toString(),
        },
        body: formBody({
          _csrf: session.csrf,
          'LoginForm[username]': username,
          'LoginForm[password]': password,
          'LoginForm[captcha]': captchaText.trim().toLowerCase(),
          'LoginForm[qr_code]': '',
          'LoginForm[rememberMe]': '1',
          'login-button': '',
        }),
      },
      session.jar,
    );

    // A failed login re-renders the login form with per-field errors; read
    // them straight away instead of spending another ERP request on a probe.
    const formErrors = detectLoginForm(res.text) ? parseLoginErrors(res.text) : [];
    if (formErrors.length > 0) {
      const code = classifyLoginError(formErrors);
      return { ok: false, code, error: pickLoginMessage(formErrors, code) ?? LOGIN_MESSAGES[code] };
    }

    // Verify auth by loading an authenticated page (the filter shell — the
    // courselist action needs a POSTed filter and can't serve as a probe).
    const probe = await erpFetch(ATTENDANCE_PAGE_PATH, { method: 'GET' }, res.jar);
    if (!detectLoginForm(probe.text) && /academicyear/i.test(probe.text)) {
      return {
        ok: true,
        jar: probe.jar,
        csrf: extractCsrf(probe.text) ?? session.csrf,
        termOptions: parseTermOptions(probe.text),
      };
    }
    const errs = parseLoginErrors(probe.text);
    const code = classifyLoginError(errs);
    return { ok: false, code, error: pickLoginMessage(errs, code) ?? LOGIN_MESSAGES[code] };
  } catch (e) {
    if (e instanceof ErpRateLimited) {
      return { ok: false, error: e.message, code: 'rate_limited' };
    }
    throw e;
  }
}

export interface AuthedSession {
  jar: CookieJar;
  csrf: string;
  exp: number;
  term?: { academicyear: string; semesterid: string; semester: string };
  termOptions?: { years: { id: string; label: string }[]; semesters: { id: string; label: string }[] };
}

function xhrHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: new URL(ERP_BASE).origin,
    Referer: new URL(ATTENDANCE_PATH, ERP_BASE).toString(),
    ...(extra ?? {}),
  };
}

async function postXhr(
  session: AuthedSession,
  path: string,
  fields: Record<string, string>,
): Promise<{ html: string; jar: CookieJar; csrf: string }> {
  const res = await erpFetch(path, { method: 'POST', headers: xhrHeaders(), body: formBody(fields) }, session.jar);
  if (detectLoginForm(res.text)) {
    const e = new Error('ERP session expired') as Error & { expired?: boolean };
    e.expired = true;
    throw e;
  }
  return { html: res.text, jar: res.jar, csrf: extractCsrf(res.text) ?? session.csrf };
}

export async function fetchAttendanceHtml(
  session: AuthedSession,
  term: { academicyear: string; semesterid: string; semester: string },
): Promise<{ html: string; jar: CookieJar; csrf: string }> {
  // The searchgetinput page is only the filter shell; the ERP's own JS posts
  // the filter to the courselist action and injects the returned table.
  const fields = {
    _csrf: session.csrf,
    'DynamicModel[academicyear]': term.academicyear,
    'DynamicModel[semesterid]': term.semesterid,
  };
  const is500 = (e: unknown) => (e as { status?: number })?.status === 500;
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let first: unknown;
  try {
    return await postXhr(session, ATTENDANCE_PATH, fields);
  } catch (e) {
    if (!is500(e)) throw e;
    first = e;
  }

  // The ERP answers 500 only for terms that have rows to render, so the data
  // is there. Retry the way the ERP's own page does it: open the filter page,
  // then post the filter from it (its token, its URL as referrer).
  const failures = [`direct: ${why(first)}`];
  const pageUrl = new URL(ATTENDANCE_PAGE_PATH, ERP_BASE).toString();
  const page = await erpFetch(ATTENDANCE_PAGE_PATH, { method: 'GET' }, session.jar);
  if (detectLoginForm(page.text)) throw Object.assign(new Error('ERP session expired'), { expired: true });
  const csrf = extractCsrf(page.text) ?? session.csrf;
  console.info(`[erp] attendance session cookies: ${Object.keys(page.jar).sort().join(', ')}`);
  // A plain form post (no XHR header), the way other working ERP clients send it.
  const navHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: pageUrl,
  };
  const variants: [string, string, Record<string, string>, Record<string, string>][] = [
    ['as a page', ATTENDANCE_PATH, navHeaders, { ...fields, _csrf: csrf }],
    ['from the filter page', ATTENDANCE_PATH, xhrHeaders({ Referer: pageUrl }), { ...fields, _csrf: csrf }],
    [
      'filter page XHR',
      ATTENDANCE_PAGE_PATH,
      xhrHeaders({ Referer: pageUrl, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
      { ...fields, _csrf: csrf, 'DynamicModel[semester]': term.semesterid },
    ],
  ];
  for (const [name, path, headers, body] of variants) {
    try {
      const res = await erpFetch(path, { method: 'POST', headers, body: formBody(body) }, page.jar);
      if (detectLoginForm(res.text)) throw Object.assign(new Error('ERP session expired'), { expired: true });
      // The filter page answers 200 with or without a grid; only a grid counts.
      if (path === ATTENDANCE_PAGE_PATH && parseAttendance(res.text).length === 0) {
        failures.push(`${name}: no attendance grid`);
        continue;
      }
      console.info(`[erp] attendance ${term.academicyear}:${term.semesterid} answered ${name}`);
      return { html: res.text, jar: res.jar, csrf };
    } catch (e) {
      if (typeof (e as { status?: unknown })?.status !== 'number') throw e;
      failures.push(`${name}: ${why(e)}`);
    }
  }
  throw Object.assign(new Error(`attendance failed (${failures.join('; ')})`), { status: 500 });
}

export async function fetchTimetableHtml(
  session: AuthedSession,
  term: { academicyear: string; semesterid: string; semester: string },
): Promise<{ html: string; jar: CookieJar; csrf: string }> {
  // The timetable filter is a GET form (data-pjax) targeting
  // individualstudenttimetableget with UniversityMasterAcademicTimetableView fields.
  const params = new URLSearchParams({
    r: 'timetables/universitymasteracademictimetableview/individualstudenttimetableget',
    'UniversityMasterAcademicTimetableView[academicyear]': term.academicyear,
    'UniversityMasterAcademicTimetableView[semesterid]': term.semesterid,
  });
  const res = await erpFetch(`/index.php?${params.toString()}`, { method: 'GET' }, session.jar);
  if (detectLoginForm(res.text)) {
    const e = new Error('ERP session expired') as Error & { expired?: boolean };
    e.expired = true;
    throw e;
  }
  return { html: res.text, jar: res.jar, csrf: extractCsrf(res.text) ?? session.csrf };
}

function termFields(session: AuthedSession, term: { academicyear: string; semesterid: string; semester: string }) {
  return {
    _csrf: session.csrf,
    'DynamicModel[academicyear]': term.academicyear,
    'DynamicModel[semester]': term.semesterid,
    'DynamicModel[semesterid]': term.semesterid,
  };
}

export async function fetchInternalsHtml(
  session: AuthedSession,
  term: { academicyear: string; semesterid: string; semester: string },
): Promise<{ html: string; jar: CookieJar; csrf: string }> {
  return postXhr(session, INTERNALS_PATH, termFields(session, term));
}

export async function fetchResultsHtml(
  session: AuthedSession,
  term: { academicyear: string; semesterid: string; semester: string },
): Promise<{ html: string; jar: CookieJar; csrf: string }> {
  return postXhr(session, RESULTS_PATH, termFields(session, term));
}

export async function fetchCgpaHtml(
  session: AuthedSession,
): Promise<{ html: string; jar: CookieJar; csrf: string }> {
  // The CGPA grid answers to GET (and tolerates POST); prefer GET.
  const res = await erpFetch(CGPA_PATH, { method: 'GET' }, session.jar);
  if (detectLoginForm(res.text)) {
    const e = new Error('ERP session expired') as Error & { expired?: boolean };
    e.expired = true;
    throw e;
  }
  return { html: res.text, jar: res.jar, csrf: extractCsrf(res.text) ?? session.csrf };
}

export function isSessionExpiredError(e: unknown): boolean {
  return (e as { expired?: boolean })?.expired === true;
}
