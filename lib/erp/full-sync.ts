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
import { termCandidates, type Term } from '../terms';

/** The ERP's ids for the year and semester, plus their labels. */
export type SyncTerm = Term;

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

/** Academic years at KLU start in June/July. */
function fallbackTerm(now = new Date()): SyncTerm {
  const y = now.getFullYear();
  const start = now.getMonth() >= 5 ? y : y - 1;
  return { academicyear: `${start}-${start + 1}`, semesterid: '1', semester: 'Odd Sem' };
}

/**
 * The term to show when nobody picked one: the newest term (two most recent
 * academic years, even before odd) that has attendance on the ERP. Its
 * attendance comes back too, so it isn't fetched twice.
 *
 * An ERP error while probing never falls through to an emptier term: when no
 * candidate had rows and one of them failed, the error is thrown so the last
 * good data stays.
 */
async function detectTerm(
  session: AuthedSession,
): Promise<{ term: SyncTerm; attendance: SubjectAttendance[] | null }> {
  const candidates = session.termOptions ? termCandidates(session.termOptions) : [];
  if (candidates.length === 0) return { term: session.term ?? fallbackTerm(), attendance: null };
  let probeError: unknown = null;
  for (const term of candidates) {
    try {
      const { html } = await fetchAttendanceHtml(session, term);
      const rows = parseAttendance(html);
      if (rows.length > 0) return { term, attendance: rows };
    } catch (e) {
      if (isSessionExpiredError(e) || e instanceof ErpRateLimited) throw e;
      probeError = e;
    }
  }
  if (probeError) {
    const why = probeError instanceof Error ? probeError.message : String(probeError);
    throw coded(`The ERP's attendance pages failed (${why}).`, 'erp_unreachable');
  }
  return { term: candidates[0], attendance: [] };
}

/**
 * Pull every dataset for the term (the chosen one, or the newest with
 * attendance). Each fetch is independent: one failing (internals not
 * published yet, a slow page) doesn't sink the others, and the failures are
 * reported so callers can keep previously synced values.
 */
export async function pullAll(session: AuthedSession, termOverride?: SyncTerm): Promise<FullSyncData> {
  let term: SyncTerm;
  let detected: SubjectAttendance[] | null = null;
  if (termOverride) {
    term = termOverride;
  } else {
    const d = await detectTerm(session);
    term = d.term;
    detected = d.attendance;
  }

  let attendance: SubjectAttendance[] = detected ?? [];
  let timetable: TimetableDay[] = [];
  let internals: InternalRow[] = [];
  let results: ResultRow[] = [];
  let cgpaRows: CgpaRow[] = [];

  const names: Dataset[] = ['attendance', 'timetable', 'internals', 'results', 'cgpa'];
  const settled = await Promise.allSettled([
    detected
      ? Promise.resolve()
      : fetchAttendanceHtml(session, term).then(({ html }) => {
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
