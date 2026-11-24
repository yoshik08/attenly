/**
 * Server-side ERP sync: log in once, then pull attendance, timetable, CGPA,
 * fee orders and the course registers for the current term and parse everything.
 *
 * Used by the link flow (/api/erp/link-and-sync), force/auto sync
 * (/api/erp/hard-sync) and the backend job (/api/cron/sync).
 */
import {
  performLogin,
  unsealSession,
  fetchAttendanceHtml,
  fetchTimetableHtml,
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
    loggedInAt: Date.now(),
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

/**
 * Headless login for syncs: reads the captcha in-process (lib/erp/solve.ts). When the
 * ERP says the captcha was wrong, it tries again with a fresh one, up to
 * CAPTCHA_ATTEMPTS; any other rejection (a wrong password) fails at once.
 */
export async function autoLogin(universityId: string, password: string): Promise<AuthedSession> {
  const attempts = CAPTCHA_ATTEMPTS;
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { preSession, solution } = await fetchSolvedCaptcha();
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

/** The ERP ids of a term, for comparing two terms. */
const termId = (t: { academicyear: string; semesterid: string }) => `${t.academicyear}:${t.semesterid}`;

/** Whether the ERP's own lists (when the session has them) still carry this term's year and semester ids. */
function termListed(session: AuthedSession, term: SyncTerm): boolean {
  const options = session.termOptions;
  if (!options || options.years.length === 0) return true;
  const year = options.years.find((y) => y.id === term.academicyear);
  if (!year || (term.yearLabel && year.label !== term.yearLabel)) return false;
  return options.semesters.length === 0 || options.semesters.some((s) => s.id === term.semesterid);
}

type Detected = { term: SyncTerm; attendance: SubjectAttendance[] | null; attendanceDown?: Error; html?: string };

/**
 * The term to show when nobody picked one: the newest term (two most recent
 * academic years, even before odd) that has courses on the ERP. Its
 * attendance comes back too, so it isn't fetched twice. A term whose
 * attendance register crashes in the ERP's database counts as having courses
 * (the crash happens per registered course); its attendance is reported down.
 *
 * The candidates are asked at once, not one after another: the ERP lists
 * academic years nobody has courses in yet, and walking them in turn cost a
 * round trip each on every sync. `upTo` stops the list at a term known to have
 * courses (the one shown now), so only it and the terms newer than it are asked.
 *
 * Any other ERP error while probing never falls through to an emptier term:
 * when no candidate had courses and one of them failed, the error is thrown
 * so the last good data stays.
 */
async function detectTerm(session: AuthedSession, upTo?: SyncTerm): Promise<Detected> {
  let candidates = session.termOptions ? termCandidates(session.termOptions) : [];
  if (candidates.length === 0) return { term: session.term ?? fallbackTerm(), attendance: null };
  if (upTo) {
    const at = candidates.findIndex((c) => termId(c) === termId(upTo));
    if (at >= 0) candidates = candidates.slice(0, at + 1);
  }
  const answers = await Promise.allSettled(candidates.map((term) => fetchAttendanceHtml(session, term)));
  let probeError: unknown = null;
  // One log line per sync: which terms were tried and what each returned (term ids, counts, no personal data).
  const tried: string[] = [];
  const report = (chosen: string) =>
    console.info(
      `[full-sync] term ${chosen}; tried ${tried.join(', ')}; options years=${session.termOptions?.years.map((y) => `${y.id}:${y.label}`).join('|')} sems=${session.termOptions?.semesters.map((s) => `${s.id}:${s.label}`).join('|')}`,
    );
  for (let i = 0; i < candidates.length; i++) {
    const term = candidates[i];
    const answer = answers[i];
    const name = `${term.semester} ${term.yearLabel ?? term.academicyear} (${termId(term)})`;
    if (answer.status === 'fulfilled') {
      const rows = parseAttendance(answer.value.html);
      tried.push(`${name}=${rows.length} rows`);
      if (rows.length > 0) {
        report(name);
        // The same page carries each course's register link, used for History.
        return { term, attendance: rows, html: answer.value.html };
      }
      continue;
    }
    const e = answer.reason;
    if (isSessionExpiredError(e) || e instanceof ErpRateLimited) throw e;
    if (isAttendanceDown(e)) {
      tried.push(`${name}=courses, attendance register down`);
      report(name);
      return { term, attendance: null, attendanceDown: e as Error };
    }
    tried.push(`${name}=${e instanceof Error ? e.message : 'error'}`);
    probeError = e;
  }
  report('none with attendance');
  if (probeError) {
    const why = probeError instanceof Error ? probeError.message : String(probeError);
    throw coded(`The ERP's attendance pages failed (${why}).`, 'erp_unreachable');
  }
  return { term: candidates[0], attendance: [] };
}

export interface PullOptions {
  /** Read every course's attendance register too (History). */
  registers?: boolean;
  /**
   * The term shown now, when it had courses. Its pages are pulled straight away while
   * the newer terms are checked alongside; only when one of those turns out to have
   * courses is everything pulled again for it.
   */
  hint?: SyncTerm;
  /**
   * The hinted term held a class in the last few days (termIsRunning), so no newer term
   * has started: it is pulled without asking about the newer ones at all.
   */
  hintRunning?: boolean;
  /** Registers still unanswered at this time (epoch ms) are left out and reported failed. */
  registersBy?: number;
}

/**
 * Pull every dataset for the term (the chosen one, or the newest with
 * attendance). Each fetch is independent: one failing (internals not
 * published yet, a slow page) doesn't sink the others, and the failures are
 * reported so callers can keep previously synced values. The course registers
 * start the moment the attendance page (which links them) is in, so a full pull
 * is about two ERP round trips, not one per step.
 */
export async function pullAll(session: AuthedSession, termOverride?: SyncTerm, opts: PullOptions = {}): Promise<FullSyncData> {
  if (termOverride) return pullTerm(session, termOverride, null, opts);
  // The hint is the term the last sync showed, by the ERP's ids. Trusted only while the ERP
  // still lists that year id with the same label: the ids are internal and could be
  // renumbered, and pulling a stale id straight away would show another year's (empty) term.
  if (opts.hint && !termListed(session, opts.hint)) opts = { ...opts, hint: undefined, hintRunning: false };
  if (opts.hint && opts.hintRunning) return pullTerm(session, opts.hint, null, opts);
  if (opts.hint) {
    const probe = detectTerm(session, opts.hint);
    // Awaited below; this only keeps an early throw elsewhere from leaving it unhandled.
    probe.catch(() => undefined);
    // Nothing on the hinted term's attendance until the probe answers: the probe reads it.
    const attendance = probe.then((d) => (termId(d.term) === termId(opts.hint!) ? d : null));
    const data = await pullTerm(session, opts.hint, attendance, opts);
    const d = await probe;
    if (termId(d.term) === termId(opts.hint)) return data;
    // A newer term has courses now (a new semester began): pull that one instead.
    return pullTerm(session, d.term, Promise.resolve(d), opts);
  }
  const d = await detectTerm(session);
  return pullTerm(session, d.term, Promise.resolve(d), opts);
}

/**
 * One term's datasets. `detected` is the term probe's answer when it already read (or
 * is reading) this term's attendance; null, or a probe that settled on another term,
 * means the attendance is fetched here.
 */
async function pullTerm(
  session: AuthedSession,
  term: SyncTerm,
  detected: Promise<Detected | null> | null,
  opts: PullOptions,
): Promise<FullSyncData> {
  let attendance: SubjectAttendance[] = [];
  let timetable: TimetableDay[] = [];
  // Internal marks and results are read on demand (Marks, lib/erp/records.ts), never on a
  // sync: nothing shows the sync's copy, the real ERP's results page answers with a broken
  // redirect, and every request a sync skips keeps it further from the ERP's rate limit.
  const internals: InternalRow[] = [];
  const results: ResultRow[] = [];
  let cgpaRows: CgpaRow[] = [];
  let feeOrders: FeeOrder[] = [];

  // The attendance page, either the probe's copy or a fetch of its own.
  const attendanceHtml: Promise<string> = (async () => {
    const d = detected ? await detected : null;
    if (d && d.attendanceDown) throw d.attendanceDown;
    if (d && d.attendance) {
      attendance = d.attendance;
      return d.html ?? '';
    }
    const { html } = await fetchAttendanceHtml(session, term);
    attendance = parseAttendance(html);
    return html;
  })();

  // History: one request per course register, from the links the attendance page
  // carries, started as soon as that page is in.
  const registers: Promise<{ classes: ClassRecord[]; complete: boolean } | null> = opts.registers
    ? attendanceHtml.then(
        (html) => readRegisters(session, html, opts.registersBy),
        () => null,
      )
    : Promise.resolve(null);

  const names: Dataset[] = ['attendance', 'timetable', 'cgpa', 'fees'];
  const settled = await Promise.allSettled([
    attendanceHtml,
    fetchTimetableHtml(session, term).then(({ html }) => {
      timetable = parseTimetable(html);
    }),
    fetchCgpaHtml(session).then(({ html }) => {
      cgpaRows = parseCgpa(html);
    }),
    fetchFeeOrdersHtml(session).then(({ html }) => {
      feeOrders = parseFeeOrders(html);
    }),
  ]);
  const read = await registers.catch((e) => {
    if (isSessionExpiredError(e) || e instanceof ErpRateLimited) throw e;
    return null;
  });

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

  // A partial set of registers is reported failed, so a caller with a complete older
  // copy keeps that one; with no older copy the partial one is still shown.
  const classes = read?.classes ?? [];
  if (!read || !read.complete || failed.includes('attendance')) failed.push('registers');

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

/** Every course register the attendance page links, read at once; null when there are none to read. */
async function readRegisters(
  session: AuthedSession,
  attendanceHtml: string,
  by?: number,
): Promise<{ classes: ClassRecord[]; complete: boolean } | null> {
  const links = attendanceHtml ? parseRegisterLinks(attendanceHtml) : [];
  if (links.length === 0) return null;
  const late = Symbol('late');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff =
    by != null
      ? new Promise<typeof late>((resolve) => {
          timer = setTimeout(() => resolve(late), Math.max(0, by - Date.now()));
        })
      : null;
  const pages = await Promise.allSettled(
    links.map((l) => {
      const page = fetchRegisterHtml(session, l.href);
      return cutoff ? Promise.race([page, cutoff]) : page;
    }),
  );
  if (timer) clearTimeout(timer);
  let classes: ClassRecord[] = [];
  let ok = 0;
  pages.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      const reason = r.reason as Error & { expired?: boolean };
      if (isSessionExpiredError(reason) || reason instanceof ErpRateLimited) throw reason;
      return;
    }
    if (r.value === late) return;
    ok++;
    classes = classes.concat(parseRegister(r.value.html, links[i].code, links[i].component));
  });
  console.info(`[full-sync] registers: ${ok}/${links.length} read, ${classes.length} classes`);
  if (ok === 0) return null;
  return { classes, complete: ok === links.length };
}

export { isSessionExpiredError, ErpRateLimited, ErpTimeout, coded };
export type { AuthedSession };
