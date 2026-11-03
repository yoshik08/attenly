/**
 * Server-side ERP sync: log in once, then pull attendance, timetable,
 * internals, results and CGPA for the current term and parse everything.
 *
 * Used by the link flow (/api/erp/link-and-sync), force/auto sync
 * (/api/erp/hard-sync) and the backend job (/api/cron/sync).
 */
import {
  performLogin,
  unsealSession,
  fetchAttendanceHtml,
  fetchTimetableHtml,
  fetchInternalsHtml,
  fetchResultsHtml,
  fetchCgpaHtml,
  isSessionExpiredError,
  ErpRateLimited,
  type AuthedSession,
  type CaptchaSession,
  type LoginResult,
} from './client';
import {
  parseAttendance,
  parseTimetable,
  parseInternals,
  parseResults,
  parseCgpa,
  computeGpa,
  type InternalRow,
  type ResultRow,
  type CgpaRow,
  type TimetableDay,
} from './parsers';
import { fetchSolvedCaptcha } from './autocaptcha';
import { coded } from './errors';
import type { SubjectAttendance } from '../math';

export interface SyncTerm {
  academicyear: string;
  semesterid: string;
  semester: string;
}

export type Dataset = 'attendance' | 'timetable' | 'internals' | 'results' | 'cgpa';

export interface FullSyncData {
  term: SyncTerm;
  attendance: SubjectAttendance[];
  timetable: TimetableDay[];
  internals: InternalRow[];
  results: ResultRow[];
  cgpaRows: CgpaRow[];
  cgpa: number | null;
  sgpaTerms: { key: string; academicYear: string; semester: string; sgpa: number | null; credits: number }[];
  syncedAt: string;
  /** Datasets whose ERP fetch failed this run (their arrays are empty, not real). */
  failed: Dataset[];
}

/** How many fresh captchas a headless login tries before giving up. */
const CAPTCHA_ATTEMPTS = 3;

function sessionFrom(res: LoginResult, fallbackCsrf: string): AuthedSession {
  return {
    jar: res.jar ?? {},
    csrf: res.csrf ?? fallbackCsrf,
    exp: Date.now() + 7 * 24 * 3600 * 1000,
    term: firstTerm(res.termOptions),
    termOptions: res.termOptions
      ? { years: res.termOptions.years ?? [], semesters: res.termOptions.semesters ?? [] }
      : undefined,
  };
}

/** Interactive login: the captcha text came from the person (or was auto-filled and confirmed). */
export async function interactiveLogin(
  universityId: string,
  password: string,
  captchaText: string,
  sessionToken: string,
): Promise<AuthedSession> {
  const pre = unsealSession<CaptchaSession>(sessionToken);
  if (!pre) throw coded('That captcha expired. Load a new one.', 'captcha_expired');
  const res = await performLogin(pre, universityId.trim(), password, captchaText);
  if (!res.ok || !res.jar) throw coded(res.error ?? 'The ERP did not accept the login.', res.code ?? 'unknown');
  return sessionFrom(res, pre.csrf);
}

/** Headless login for background syncs: solves the captcha via SOLVER_URL, retrying misreads. */
export async function autoLogin(universityId: string, password: string): Promise<AuthedSession> {
  let lastError = '';
  for (let attempt = 0; attempt < CAPTCHA_ATTEMPTS; attempt++) {
    const { preSession, solution } = await fetchSolvedCaptcha();
    const res = await performLogin(preSession, universityId.trim(), password, solution);
    if (res.ok && res.jar) return sessionFrom(res, preSession.csrf);
    lastError = res.error ?? 'The ERP did not accept the login.';
    if (res.code !== 'bad_captcha') throw coded(lastError, res.code ?? 'unknown');
  }
  throw coded(`The captcha solver misread ${CAPTCHA_ATTEMPTS} captchas in a row.`, 'bad_captcha');
}

function firstTerm(
  termOptions?: { years?: { id: string; label: string }[]; semesters?: { id: string; label: string }[] },
): SyncTerm | undefined {
  const y = termOptions?.years?.[0];
  const s = termOptions?.semesters?.[0];
  if (!y || !s) return undefined;
  return { academicyear: y.id, semesterid: s.id, semester: s.label };
}

/** Academic years at KLU start in June/July. */
function fallbackTerm(now = new Date()): SyncTerm {
  const y = now.getFullYear();
  const start = now.getMonth() >= 5 ? y : y - 1;
  return { academicyear: `${start}-${start + 1}`, semesterid: '1', semester: 'Odd Sem' };
}

/**
 * Pull every dataset for the term. Each fetch is independent: one failing
 * (internals not published yet, a slow page) doesn't sink the others, and
 * the failures are reported so callers can keep previously synced values.
 */
export async function pullAll(session: AuthedSession, termOverride?: SyncTerm): Promise<FullSyncData> {
  const term: SyncTerm = termOverride ?? session.term ?? fallbackTerm();

  let attendance: SubjectAttendance[] = [];
  let timetable: TimetableDay[] = [];
  let internals: InternalRow[] = [];
  let results: ResultRow[] = [];
  let cgpaRows: CgpaRow[] = [];

  const names: Dataset[] = ['attendance', 'timetable', 'internals', 'results', 'cgpa'];
  const settled = await Promise.allSettled([
    fetchAttendanceHtml(session, term).then(({ html }) => {
      attendance = parseAttendance(html);
    }),
    fetchTimetableHtml(session, term).then(({ html }) => {
      timetable = parseTimetable(html);
    }),
    fetchInternalsHtml(session, term).then(({ html }) => {
      internals = parseInternals(html);
    }),
    fetchResultsHtml(session, term).then(({ html }) => {
      results = parseResults(html);
    }),
    fetchCgpaHtml(session).then(({ html }) => {
      cgpaRows = parseCgpa(html);
    }),
  ]);

  const failed: Dataset[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') return;
    const reason = s.reason as Error & { expired?: boolean };
    if (isSessionExpiredError(reason) || reason instanceof ErpRateLimited) throw reason;
    failed.push(names[i]);
    console.warn(`[full-sync] ${names[i]} pull failed:`, reason instanceof Error ? reason.message : reason);
  });

  const { cgpa, terms } = computeGpa(cgpaRows);
  return {
    term,
    attendance,
    timetable,
    internals,
    results,
    cgpaRows,
    cgpa,
    sgpaTerms: terms,
    syncedAt: new Date().toISOString(),
    failed,
  };
}

export { isSessionExpiredError, ErpRateLimited, coded };
