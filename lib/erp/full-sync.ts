/**
 * Server-side full ERP sync: login once, pull attendance + timetable +
 * internals + results + CGPA, parse everything, and persist a snapshot.
 *
 * Used by the interactive link flow (/api/erp/link-and-sync) and by the
 * 10-minute backend sync (/api/cron/sync). The password only ever lives in
 * memory here; persistence goes through sealSession into the `creds` blob.
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
} from './parsers';
import { fetchSolvedCaptcha } from './autocaptcha';
import type { SubjectAttendance } from '../math';
import type { TimetableDay } from './parsers';

export interface SyncTerm {
  academicyear: string;
  semesterid: string;
  semester: string;
}

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
}

/** Interactive login: the user typed the captcha themselves. */
export async function interactiveLogin(
  universityId: string,
  password: string,
  captchaText: string,
  sessionToken: string,
): Promise<AuthedSession> {
  const pre = unsealSession<CaptchaSession>(sessionToken);
  if (!pre) throw coded('Captcha expired. Please try again.', 'captcha_expired');
  const res = await performLogin(pre, universityId.trim(), password, captchaText);
  if (!res.ok || !res.jar) throw coded(res.error ?? 'Login failed.', res.code ?? 'unknown');
  return {
    jar: res.jar,
    csrf: res.csrf ?? pre.csrf,
    exp: Date.now() + 7 * 24 * 3600 * 1000,
    term: firstTerm(res.termOptions),
  };
}

/** Headless login for the backend sync: solves the captcha via SOLVER_URL. */
export async function autoLogin(universityId: string, password: string): Promise<AuthedSession> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { preSession, solution } = await fetchSolvedCaptcha();
    const res = await performLogin(preSession, universityId.trim(), password, solution);
    if (res.ok && res.jar) {
      return {
        jar: res.jar,
        csrf: res.csrf ?? preSession.csrf,
        exp: Date.now() + 7 * 24 * 3600 * 1000,
        term: firstTerm(res.termOptions),
      };
    }
    lastError = res.error ?? 'Login failed.';
    if (res.code !== 'bad_captcha') throw coded(lastError, res.code ?? 'unknown');
  }
  throw coded(`Auto-login failed: ${lastError}`, 'bad_captcha');
}

function firstTerm(
  termOptions?: { years?: { id: string; label: string }[]; semesters?: { id: string; label: string }[] },
): SyncTerm | undefined {
  const y = termOptions?.years?.[0];
  const s = termOptions?.semesters?.[0];
  if (!y || !s) return undefined;
  return { academicyear: y.id, semesterid: s.id, semester: s.label };
}

function coded(message: string, code: string): Error {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/**
 * Pull every dataset for the term. Each fetch is independent — a failure in
 * one (e.g. internals not yet published) doesn't kill the others.
 */
export async function pullAll(session: AuthedSession, termOverride?: SyncTerm): Promise<FullSyncData> {
  const term: SyncTerm =
    termOverride ??
    session.term ?? {
      academicyear: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
      semesterid: '1',
      semester: 'Odd Sem',
    };

  let attendance: SubjectAttendance[] = [];
  let timetable: TimetableDay[] = [];
  let internals: InternalRow[] = [];
  let results: ResultRow[] = [];
  let cgpaRows: CgpaRow[] = [];

  const jobs: Promise<void>[] = [
    (async () => {
      const { html } = await fetchAttendanceHtml(session, term);
      attendance = parseAttendance(html);
    })(),
    (async () => {
      const { html } = await fetchTimetableHtml(session, term);
      timetable = parseTimetable(html);
    })(),
    (async () => {
      const { html } = await fetchInternalsHtml(session, term);
      internals = parseInternals(html);
    })(),
    (async () => {
      const { html } = await fetchResultsHtml(session, term);
      results = parseResults(html);
    })(),
    (async () => {
      const { html } = await fetchCgpaHtml(session);
      cgpaRows = parseCgpa(html);
    })(),
  ];

  const settled = await Promise.allSettled(jobs);
  const failures = settled
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.status === 'rejected')
    .map(({ s, i }) => ({ job: ['attendance', 'timetable', 'internals', 'results', 'cgpa'][i], reason: (s as PromiseRejectedResult).reason }));
  for (const f of failures) {
    const r = f.reason as Error & { expired?: boolean };
    if (isSessionExpiredError(r) || r?.expired) throw r;
    if (r instanceof ErpRateLimited) throw r;
    console.warn(`[full-sync] ${f.job} pull failed (non-fatal):`, r instanceof Error ? r.message : r);
  }

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
  };
}

export { isSessionExpiredError, ErpRateLimited };
