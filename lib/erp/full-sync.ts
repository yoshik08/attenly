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
  fetchFeeOrdersHtml,
  fetchRegisterHtml,
  isSessionExpiredError,
  isAttendanceDown,
  ErpRateLimited,
  ErpTimeout,
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
  parseFeeOrders,
  parseRegister,
  parseRegisterLinks,
  computeGpa,
  type InternalRow,
  type ResultRow,
  type CgpaRow,
  type TimetableDay,
  type FeeOrder,
  type ClassRecord,
} from './parsers';
import { fetchSolvedCaptcha } from './autocaptcha';
import { coded } from './errors';
import type { SubjectAttendance } from '../math';
import { termCandidates, type Term } from '../terms';

/** The ERP's ids for the year and semester, plus their labels. */
export type SyncTerm = Term;

export type Dataset = 'attendance' | 'timetable' | 'internals' | 'results' | 'cgpa' | 'fees' | 'registers';

export interface FullSyncData {
  term: SyncTerm;
  attendance: SubjectAttendance[];
  timetable: TimetableDay[];
  internals: InternalRow[];
  results: ResultRow[];
  cgpaRows: CgpaRow[];
  cgpa: number | null;
  sgpaTerms: { key: string; academicYear: string; semester: string; sgpa: number | null; credits: number }[];
  /** Every online fee order, newest first as the ERP prints them. */
  feeOrders: FeeOrder[];
  /** One record per conducted class, from the courses' attendance registers. */
  classes: ClassRecord[];
  syncedAt: string;
  /** Datasets whose ERP fetch failed this run (their arrays are empty, not real). */
  failed: Dataset[];
  /** Why a failed dataset is missing, when the reason is worth showing (the ERP's attendance register is down). */
  issues: Partial<Record<Dataset, string>>;
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
export async function autoLogin(
  universityId: string,
  password: string,
  opts: { solverBudgetMs?: number } = {},
): Promise<AuthedSession> {
  // A manual sync has seconds, not a minute: one attempt, then say what happened.
  const attempts = opts.solverBudgetMs ? 1 : CAPTCHA_ATTEMPTS;
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { preSession, solution } = await fetchSolvedCaptcha(opts.solverBudgetMs);
    const res = await performLogin(preSession, universityId.trim(), password, solution);
    if (res.ok && res.jar) return sessionFrom(res, preSession.csrf);
    lastError = res.error ?? 'The ERP did not accept the login.';
    if (res.code !== 'bad_captcha') throw coded(lastError, res.code ?? 'unknown');
  }
  throw coded(`The captcha solver misread ${attempts} captchas in a row.`, 'bad_captcha');
}

/** Academic years at KLU start in June/July. */
function fallbackTerm(now = new Date()): SyncTerm {
  const y = now.getFullYear();
  const start = now.getMonth() >= 5 ? y : y - 1;
  return { academicyear: `${start}-${start + 1}`, semesterid: '1', semester: 'Odd Sem' };
}

/**
 * The term to show when nobody picked one: the newest term (two most recent
 * academic years, even before odd) that has courses on the ERP. Its
 * attendance comes back too, so it isn't fetched twice. A term whose
 * attendance register crashes in the ERP's database counts as having courses
 * (the crash happens per registered course); its attendance is reported down.
 *
 * Any other ERP error while probing never falls through to an emptier term:
 * when no candidate had courses and one of them failed, the error is thrown
 * so the last good data stays.
 */
async function detectTerm(
  session: AuthedSession,
): Promise<{ term: SyncTerm; attendance: SubjectAttendance[] | null; attendanceDown?: Error; html?: string }> {
  const candidates = session.termOptions ? termCandidates(session.termOptions) : [];
  if (candidates.length === 0) return { term: session.term ?? fallbackTerm(), attendance: null };
  let probeError: unknown = null;
  // One log line per sync: which terms were tried and what each returned (term ids, counts, no personal data).
  const tried: string[] = [];
  const report = (chosen: string) =>
    console.info(
      `[full-sync] term ${chosen}; tried ${tried.join(', ')}; options years=${session.termOptions?.years.map((y) => `${y.id}:${y.label}`).join('|')} sems=${session.termOptions?.semesters.map((s) => `${s.id}:${s.label}`).join('|')}`,
    );
  for (const term of candidates) {
    const name = `${term.semester} ${term.yearLabel ?? term.academicyear} (${term.academicyear}:${term.semesterid})`;
    try {
      const { html } = await fetchAttendanceHtml(session, term);
      const rows = parseAttendance(html);
      tried.push(`${name}=${rows.length} rows`);
      if (rows.length > 0) {
        report(name);
        // The same page carries each course's register link, used for History.
        return { term, attendance: rows, html };
      }
    } catch (e) {
      if (isSessionExpiredError(e) || e instanceof ErpRateLimited) throw e;
      if (isAttendanceDown(e)) {
        tried.push(`${name}=courses, attendance register down`);
        report(name);
        return { term, attendance: null, attendanceDown: e as Error };
      }
      tried.push(`${name}=${e instanceof Error ? e.message : 'error'}`);
      probeError = e;
    }
  }
  report('none with attendance');
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
export async function pullAll(
  session: AuthedSession,
  termOverride?: SyncTerm,
  opts: { registers?: boolean } = {},
): Promise<FullSyncData> {
  let term: SyncTerm;
  let detected: SubjectAttendance[] | null = null;
  let detectedDown: Error | undefined;
  let attendanceHtml = '';
  if (termOverride) {
    term = termOverride;
  } else {
    const d = await detectTerm(session);
    term = d.term;
    detected = d.attendance;
    detectedDown = d.attendanceDown;
    attendanceHtml = d.html ?? '';
  }

  let attendance: SubjectAttendance[] = detected ?? [];
  let timetable: TimetableDay[] = [];
  let internals: InternalRow[] = [];
  let results: ResultRow[] = [];
  let cgpaRows: CgpaRow[] = [];
  let feeOrders: FeeOrder[] = [];

  const names: Dataset[] = ['attendance', 'timetable', 'internals', 'results', 'cgpa', 'fees'];
  const settled = await Promise.allSettled([
    detectedDown
      ? Promise.reject(detectedDown)
      : detected
        ? Promise.resolve()
        : fetchAttendanceHtml(session, term).then(({ html }) => {
            attendanceHtml = html;
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
    fetchFeeOrdersHtml(session).then(({ html }) => {
      feeOrders = parseFeeOrders(html);
    }),
  ]);

  const failed: Dataset[] = [];
  const issues: FullSyncData['issues'] = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') return;
    const reason = s.reason as Error & { expired?: boolean };
    if (isSessionExpiredError(reason) || reason instanceof ErpRateLimited) throw reason;
    failed.push(names[i]);
    if (isAttendanceDown(reason)) issues[names[i]] = reason.message;
    else console.warn(`[full-sync] ${names[i]} pull failed:`, reason instanceof Error ? reason.message : reason);
  });

  // History: one request per course register, from the links the attendance
  // page carries. Not on a manual sync — that one has five seconds.
  let classes: ClassRecord[] = [];
  const links = attendanceHtml ? parseRegisterLinks(attendanceHtml) : [];
  if (!opts.registers || failed.includes('attendance') || issues.attendance || links.length === 0) {
    failed.push('registers');
  } else {
    const registers = await Promise.allSettled(links.map((l) => fetchRegisterHtml(session, l.href)));
    let read = 0;
    registers.forEach((r, i) => {
      if (r.status !== 'fulfilled') {
        const reason = r.reason as Error & { expired?: boolean };
        if (isSessionExpiredError(reason) || reason instanceof ErpRateLimited) throw reason;
        return;
      }
      read++;
      classes = classes.concat(parseRegister(r.value.html, links[i].code, links[i].component));
    });
    if (read === 0) failed.push('registers');
    else console.info(`[full-sync] registers: ${read}/${links.length} read, ${classes.length} classes`);
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
    feeOrders,
    classes,
    syncedAt: new Date().toISOString(),
    failed,
    issues,
  };
}

export { isSessionExpiredError, ErpRateLimited, ErpTimeout, coded };
export type { AuthedSession };
