/**
 * ERP data read on demand, one screen at a time: marks, mid-term papers, profile,
 * fees and circulars. None of it changes minute to minute, so it stays out of the
 * five-minute attendance sync; /api/erp/records fetches a set when a screen asks
 * and caches it (lib/db/records.ts), /api/local/records reads it for a browser
 * signed in without Google and keeps nothing.
 *
 * Everything here only reads: GET pages, and search forms posted back to their own
 * page with a year and semester. No database: the session comes from the caller.
 */
import { erpDocument, erpPage, erpSearch, erpStream, type AuthedSession } from './client';
import type { RecordSet } from '../record-sets';
import {
  circularDocumentHref,
  feeLedgerHref,
  parseBusSeats,
  parseCirculars,
  parseComponentMarks,
  parseCounselling,
  parseCourseClasses,
  paperScanHref,
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
  type CourseClass,
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
  courses: 'studentinfo/studentcoursemappingmasterinfoview/tab_index_personal',
} as const;

export { RECORD_MAX_AGE, RECORD_SETS, type RecordSet } from '../record-sets';

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
export interface CoursesData {
  /** Every class the student was mapped to: course × L/T/P/S, with section and faculty. */
  classes: CourseClass[];
}
export interface RecordData {
  marks: MarksData;
  papers: PapersData;
  profile: ProfileData;
  fees: FeesData;
  circulars: CircularsData;
  courses: CoursesData;
}

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
    const html = href ? (await erpPage(session, href)).html : '';
    const questions = parsePaperQuestions(html);
    // An unwritten question counts as 0, as in the ERP's own totals.
    const sum = (k: 'got' | 'max') =>
      questions.some((q) => q[k] != null || (k === 'got' && q.notWritten)) ? questions.reduce((n, q) => n + (q[k] ?? 0), 0) : null;
    return { ...ref, questions, got: sum('got'), max: sum('max'), hasScan: Boolean(paperScanHref(html)) };
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

/** The Courses tab, every page of it (the ERP serves at most 50 rows a page). */
async function readCourses(session: AuthedSession): Promise<CoursesData> {
  const route = `/index.php?r=${encodeURIComponent(ROUTES.courses)}&per-page=50`;
  const first = parseCourseClasses((await erpPage(session, route)).html);
  // Page size from what the ERP actually served (it caps per-page; 50 today).
  const per = first.classes.length || 50;
  const pages = Math.min(10, Math.ceil((first.total ?? per) / per));
  const rest = await pool(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2),
    4,
    async (n) => parseCourseClasses((await erpPage(session, `${route}&page=${n}`)).html).classes,
  );
  return { classes: [...first.classes, ...rest.flat()] };
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
    case 'courses':
      return (await readCourses(session)) as RecordData[S];
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

export interface PaperKey {
  courseCode: string;
  exam: string;
  academicYear: string;
  semester: string;
}

/**
 * One booklet's scanned answer script, streamed. The ERP's links change on every load,
 * so the booklet is found again on a fresh list by course, exam and term.
 */
export async function readPaperScan(session: AuthedSession, key: PaperKey) {
  const refs = parsePaperList((await erpPage(session, ROUTES.papers)).html);
  const ref = refs.find(
    (r) => r.courseCode === key.courseCode && r.exam === key.exam && r.academicYear === key.academicYear && r.semester === key.semester,
  );
  if (!ref?.href) return null;
  const scan = paperScanHref((await erpPage(session, ref.href)).html);
  if (!scan) return null;
  return erpStream(session, scan);
}
