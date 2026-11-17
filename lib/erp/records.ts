/**
 * ERP data read on demand, one screen at a time: marks, mid-term papers, profile,
 * fees and circulars. None of it changes minute to minute, so it stays out of the
 * five-minute attendance sync; /api/erp/records fetches a set when a screen asks
 * and caches it (lib/db/records.ts).
 *
 * Everything here only reads: GET pages, and search forms posted back to their own
 * page with a year and semester.
 */
import { clearErpSession, loadErpSession, saveErpSession } from '../db/erp-session';
import { resolvePassword, type ErpAccount } from '../db/users';
import { erpDocument, erpPage, erpSearch, isSessionExpiredError, type AuthedSession } from './client';
import { autoLogin } from './full-sync';
import { coded } from './errors';
import {
  circularDocumentHref,
  feeLedgerHref,
  parseBusSeats,
  parseCirculars,
  parseComponentMarks,
  parseCounselling,
  parseDues,
  parseFeeLedger,
  parseFormTerms,
  parseInternalLinks,
  parsePaperList,
  parsePaperQuestions,
  parseProfile,
  parseSeating,
  type BusSeat,
  type Circular,
  type CounsellingNote,
  type DueLine,
  type ExamSeat,
  type FormTerm,
  type InternalCourse,
  type LedgerRow,
  type Paper,
  type Profile,
} from './records-parse';

const ROUTES = {
  internals: 'studentinfo/studentendexamresult/getstudentinternalmarks',
  seating: 'examsection/exam-invigilator-student-room-allotment-info/stud_my_seating_plan',
  papers: 'studentinfo/studentendexamresult/view_my_answer_scripts',
  profile: 'studentinfo/studentprofileinfo/viewprofileindi',
  bus: 'transport/transport-bus-occupancy-info/student-bus-seat-info',
  counselling: 'studentinfo/studentcouncellingdairy/counselling_diary_stuview',
  dues: 'nodues/noduesstudentdocumentsinfo/my_dues_fines_student',
  circulars: 'registraroffice/registrarofficecircularsvisibilitylistinfo/tab_index_personal',
} as const;

export type RecordSet = 'marks' | 'papers' | 'profile' | 'fees' | 'circulars';

export interface MarksData {
  /** The year × semester pairs the ERP offers this student, newest first. */
  terms: FormTerm[];
  term: FormTerm | null;
  courses: InternalCourse[];
  seating: ExamSeat[];
}
export interface PapersData {
  papers: Paper[];
}
export interface ProfileData {
  profile: Profile;
  bus: BusSeat[];
  counselling: CounsellingNote[];
}
export interface FeesData {
  ledger: LedgerRow[];
  dues: DueLine[];
}
export interface CircularsData {
  circulars: Circular[];
  total: number | null;
}
export interface RecordData {
  marks: MarksData;
  papers: PapersData;
  profile: ProfileData;
  fees: FeesData;
  circulars: CircularsData;
}

/** How long a cached set is served without asking the ERP again. */
export const RECORD_MAX_AGE: Record<RecordSet, number> = {
  marks: 20 * 60_000,
  papers: 6 * 3600_000,
  profile: 6 * 3600_000,
  fees: 60 * 60_000,
  circulars: 30 * 60_000,
};

/** Runs `fn` over `items`, at most `n` at a time, keeping order. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * A logged-in ERP session for `account`: the saved one when it still works, else
 * one fresh login with the stored password. Saves whatever session it ends with.
 */
export async function withErpSession<T>(account: ErpAccount, fn: (session: AuthedSession) => Promise<T>): Promise<T> {
  const creds = resolvePassword(account);
  let session = await loadErpSession(account.universityId);
  if (!session) {
    if (!creds) throw coded('Enter your ERP password once to read this from the ERP.', 'needs_password');
    session = await autoLogin(account.universityId, creds.password);
  }
  let result: T;
  try {
    result = await fn(session);
  } catch (e) {
    if (!isSessionExpiredError(e) || !creds) throw e;
    await clearErpSession(account.universityId);
    session = await autoLogin(account.universityId, creds.password);
    result = await fn(session);
  }
  await saveErpSession(account.universityId, session).catch(() => undefined);
  return result;
}

const sameTerm = (t: FormTerm, ay?: string, sem?: string) => Boolean(ay && sem && t.academicyear === ay && t.semesterid === sem);

async function readMarks(session: AuthedSession, want: { ay?: string; sem?: string }): Promise<MarksData> {
  const [form, seatingPage] = await Promise.all([erpPage(session, ROUTES.internals), erpPage(session, ROUTES.seating)]);
  const terms = parseFormTerms(form.html);
  const term = terms.find((t) => sameTerm(t, want.ay, want.sem)) ?? terms.find((t) => !/term\s*3|summer/i.test(t.semester)) ?? terms[0] ?? null;
  const seating = parseSeating(seatingPage.html);
  if (!term) return { terms, term: null, courses: [], seating };
  const list = await erpSearch(
    session,
    ROUTES.internals,
    { 'DynamicModel[academicyear]': term.academicyear, 'DynamicModel[semester]': term.semesterid, 'DynamicModel[semesterid]': term.semesterid },
    form.html,
  );
  const links = parseInternalLinks(list.html);
  const flat = links.flatMap((c, ci) => c.components.map((comp) => ({ ci, comp })));
  const marks = await pool(flat, 6, async ({ comp }) => parseComponentMarks((await erpPage(session, comp.href)).html));
  const courses: InternalCourse[] = links.map((c) => ({ code: c.code, title: c.title, components: [] }));
  flat.forEach(({ ci, comp }, i) => {
    const m = marks[i];
    courses[ci].components.push(m ? { name: comp.name, marked: m.total != null || m.weighted != null, ...m } : { name: comp.name, marked: false });
  });
  return { terms, term, courses, seating };
}

async function readPapers(session: AuthedSession): Promise<PapersData> {
  const refs = parsePaperList((await erpPage(session, ROUTES.papers)).html);
  const papers = await pool(refs, 6, async ({ href, ...ref }) => {
    const questions = href ? parsePaperQuestions((await erpPage(session, href)).html) : [];
    const sum = (k: 'got' | 'max') => (questions.some((q) => q[k] != null) ? questions.reduce((n, q) => n + (q[k] ?? 0), 0) : null);
    return { ...ref, questions, got: sum('got'), max: sum('max') };
  });
  return { papers };
}

async function readProfile(session: AuthedSession): Promise<ProfileData> {
  const [profile, bus, counselling] = await Promise.all([
    erpPage(session, ROUTES.profile),
    erpPage(session, ROUTES.bus),
    erpPage(session, ROUTES.counselling),
  ]);
  return { profile: parseProfile(profile.html), bus: parseBusSeats(bus.html), counselling: parseCounselling(counselling.html) };
}

async function readFees(session: AuthedSession): Promise<FeesData> {
  // The ledger's link carries a per-student id; every page's menu has it.
  const dues = await erpPage(session, ROUTES.dues);
  const href = feeLedgerHref(dues.html);
  if (!href) return { ledger: [], dues: parseDues(dues.html) };
  const ledger = await erpPage(session, href);
  return { ledger: parseFeeLedger(ledger.html), dues: parseDues(ledger.html) };
}

async function readCirculars(session: AuthedSession): Promise<CircularsData> {
  return parseCirculars((await erpPage(session, ROUTES.circulars)).html);
}

export async function readRecord<S extends RecordSet>(
  session: AuthedSession,
  set: S,
  opts: { ay?: string; sem?: string } = {},
): Promise<RecordData[S]> {
  switch (set) {
    case 'marks':
      return (await readMarks(session, opts)) as RecordData[S];
    case 'papers':
      return (await readPapers(session)) as RecordData[S];
    case 'profile':
      return (await readProfile(session)) as RecordData[S];
    case 'fees':
      return (await readFees(session)) as RecordData[S];
    default:
      return (await readCirculars(session)) as RecordData[S];
  }
}

/** One circular's document, looked up by its id on the current list (the ERP's links change per load). */
export async function readCircularDocument(session: AuthedSession, id: string) {
  const href = circularDocumentHref((await erpPage(session, ROUTES.circulars)).html, id);
  if (!href) return null;
  return erpDocument(session, href);
}
