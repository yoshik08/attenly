/**
 * Parsers for the ERP pages Attenly reads on demand (not on every sync): internal
 * marks, mid-term papers, profile, bus seat, counselling diary, fee ledger, dues,
 * circulars and exam rooms.
 *
 * The ERP's pages are Yii2 GridViews. Every parser finds its columns by header
 * words, never by position, and returns empty data rather than throwing.
 * Client code imports only the types from here.
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { parseBookletMarks, parseResults } from './parsers';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const lower = (s: string) => clean(s).toLowerCase();

/** "1,61,000" / "16.4" / "-45000" → number; blank or "-" → null. */
export function numOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

interface Cell {
  text: string;
  /** Every link in the cell, in order. */
  links: { text: string; href: string }[];
}

interface Grid {
  headers: string[];
  rows: Cell[][];
}

/** Each GridView on the page (tables with a header row), in order. */
function grids(html: string): Grid[] {
  const $ = cheerio.load(html);
  const out: Grid[] = [];
  $('table').each((_, t) => {
    const table = $(t);
    const ths = table.find('thead th');
    const headerCells = ths.length ? ths : table.find('tr').first().find('th');
    if (!headerCells.length) return;
    const headers = headerCells.toArray().map((h) => clean($(h).text()));
    const rows: Cell[][] = [];
    const bodyRows = table.find('tbody tr').length ? table.find('tbody tr') : table.find('tr').slice(1);
    bodyRows.each((_, tr) => {
      const tds = $(tr).find('td');
      if (!tds.length || $(tr).find('.empty').length) return;
      rows.push(
        tds.toArray().map((td: Element) => ({
          text: clean($(td).text()),
          links: $(td)
            .find('a[href]')
            .toArray()
            .map((a) => ({ text: clean($(a).text()), href: ($(a).attr('href') ?? '').replace(/&amp;/g, '&') })),
        })),
      );
    });
    out.push({ headers, rows });
  });
  return out;
}

/** The first grid whose headers mention every word group (each group: any of its words). */
function gridWith(html: string, ...need: string[][]): Grid | null {
  return (
    grids(html).find((g) => {
      const hs = g.headers.map(lower);
      return need.every((words) => hs.some((h) => words.some((w) => h.includes(w))));
    }) ?? null
  );
}

/** Column index by header words: the first header containing all of `words`. */
function col(g: Grid, ...words: string[]): number {
  return g.headers.findIndex((h) => {
    const l = lower(h);
    return words.every((w) => l.includes(w));
  });
}

const at = (row: Cell[], i: number) => (i >= 0 && i < row.length ? row[i].text : '');

/* ------------------------------------------------------------------ */
/* Who: the name, roll number and department every page's top bar shows */
/* ------------------------------------------------------------------ */

export interface Identity {
  name: string;
  universityId: string;
  department: string;
}

export function parseIdentity(html: string): Identity {
  const $ = cheerio.load(html);
  // <li><div><b>NAME: </b></div><div>ARUMALLA YOSHIK</div></li>
  const pick = (label: string) => {
    let v = '';
    $('b').each((_, b) => {
      if (v || !clean($(b).text()).toLowerCase().startsWith(label)) return;
      v = clean($(b).parent().next('div').text());
    });
    return v;
  };
  const department = pick('department')
    // "1073 - KLBCH - Department of computer science and Engineering -1" → the readable part
    .replace(/^\s*\d+\s*-\s*[A-Z]+\s*-\s*/, '')
    .replace(/\s*-\s*\d+\s*$/, '')
    .replace(/^department of\s+/i, '')
    // The ERP's casing is inconsistent ("computer science and Engineering").
    .split(' ')
    .map((w, i) => (i > 0 && /^(and|of|the|in|for|&)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
  return { name: pick('name'), universityId: pick('roll'), department };
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export interface Profile extends Identity {
  admissionDate: string;
  regulation: string;
  program: string;
}

/** The profile card's label/value table. Personal details (birth date, contact, body) are left out on purpose. */
export function parseProfile(html: string): Profile {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length !== 2) return;
    const v = clean($(tds[1]).text());
    if (!v.startsWith(':')) return;
    fields[lower($(tds[0]).text())] = v.replace(/^:\s*/, '');
  });
  return {
    ...parseIdentity(html),
    admissionDate: fields['admission date'] ?? '',
    regulation: fields['regulation'] ?? '',
    program: fields['program'] ?? '',
  };
}

/* ------------------------------------------------------------------ */
/* Bus seat                                                            */
/* ------------------------------------------------------------------ */

export interface BusSeat {
  academicYear: string;
  semester: string;
  bus: string;
  route: string;
  stage: string;
  seat: string;
  shift: string;
  fee: number | null;
  feeType: string;
}

export function parseBusSeats(html: string): BusSeat[] {
  const g = gridWith(html, ['bus'], ['seat']);
  if (!g) return [];
  const c = {
    year: col(g, 'academic', 'year'),
    sem: g.headers.findIndex((h) => lower(h) === 'semester'),
    bus: col(g, 'bus name'),
    desc: col(g, 'bus desc'),
    seat: col(g, 'seat'),
    shift: col(g, 'shift'),
    stage: col(g, 'route'),
    fee: col(g, 'fee'),
    type: col(g, 'collection'),
  };
  return g.rows
    .map((r) => ({
      academicYear: at(r, c.year),
      semester: at(r, c.sem),
      bus: at(r, c.bus),
      route: at(r, c.desc),
      stage: at(r, c.stage),
      seat: at(r, c.seat),
      shift: at(r, c.shift),
      fee: numOrNull(at(r, c.fee)),
      feeType: at(r, c.type),
    }))
    .filter((b) => b.bus || b.seat);
}

/* ------------------------------------------------------------------ */
/* Counselling diary                                                   */
/* ------------------------------------------------------------------ */

export interface CounsellingNote {
  date: string;
  academicYear: string;
  semester: string;
  counsellor: string;
  category: string;
  /** "Student" or "Parent": who the counsellor spoke to. */
  with: string;
  problem: string;
  remarks: string;
}

export function parseCounselling(html: string): CounsellingNote[] {
  const g = gridWith(html, ['counsell'], ['remarks']);
  if (!g) return [];
  const c = {
    date: col(g, 'date'),
    year: col(g, 'academic', 'year'),
    sem: col(g, 'semester'),
    name: g.headers.findIndex((h) => /employee name|counsellor name|teacher name/i.test(clean(h))),
    category: col(g, 'category'),
    with: col(g, 'interaction'),
    problem: col(g, 'problem'),
    remarks: col(g, 'remarks'),
  };
  const dash = (s: string) => (s === '-' ? '' : s);
  return g.rows
    .map((r) => ({
      date: at(r, c.date),
      academicYear: at(r, c.year),
      semester: at(r, c.sem),
      counsellor: at(r, c.name),
      category: at(r, c.category),
      with: at(r, c.with),
      problem: dash(at(r, c.problem)),
      remarks: dash(at(r, c.remarks)),
    }))
    .filter((n) => n.remarks || n.problem)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/* ------------------------------------------------------------------ */
/* Fees: the semester ledger and the dues summary                      */
/* ------------------------------------------------------------------ */

export interface LedgerReceipt {
  date: string;
  receiptNo: string;
  amount: number | null;
}

export interface LedgerRow {
  academicYear: string;
  studyYear: string;
  semester: string;
  gross: number | null;
  concession: number | null;
  toPay: number | null;
  paid: number | null;
  /** Negative when more was paid than asked. */
  due: number | null;
  receipts: LedgerReceipt[];
}

/** "Order Date:2025-08-04::Receipt No:KL-2505322:…::Transaction Amount:95000, Order Date:…" */
export function parseReceiptList(s: string): LedgerReceipt[] {
  return s
    .split(/,(?=\s*Order Date)/i)
    .map((part) => {
      const date = /Order Date:\s*([\d-]+)/i.exec(part)?.[1] ?? '';
      const receiptNo = (/Receipt No:\s*(.*?)::/i.exec(part)?.[1] ?? '').trim();
      const amount = numOrNull(/Transaction Amount:\s*([\d.,-]+)/i.exec(part)?.[1]);
      return { date, receiptNo, amount };
    })
    .filter((r) => r.date || r.amount != null);
}

export function parseFeeLedger(html: string): LedgerRow[] {
  const g = gridWith(html, ['to pay'], ['paid'], ['concession']);
  if (!g) return [];
  const c = {
    year: col(g, 'academic', 'year'),
    study: col(g, 'year of study'),
    sem: g.headers.findIndex((h) => lower(h) === 'semester'),
    gross: col(g, 'without concession'),
    concession: g.headers.findIndex((h) => lower(h).includes('concession') && !lower(h).includes('without')),
    toPay: col(g, 'to pay'),
    paid: g.headers.findIndex((h) => lower(h) === 'paid'),
    due: g.headers.findIndex((h) => /^due( payment| amount)?$/.test(lower(h))),
    receipts: col(g, 'receipt'),
  };
  return g.rows
    .map((r) => ({
      academicYear: at(r, c.year),
      studyYear: at(r, c.study),
      semester: at(r, c.sem),
      gross: numOrNull(at(r, c.gross)),
      concession: numOrNull(at(r, c.concession)),
      toPay: numOrNull(at(r, c.toPay)),
      paid: numOrNull(at(r, c.paid)),
      due: numOrNull(at(r, c.due)),
      receipts: parseReceiptList(at(r, c.receipts)),
    }))
    .filter((r) => r.academicYear);
}

export interface DueLine {
  label: string;
  amount: number;
}

/** The "Consolidate Due List" row: only what is actually owed (> 0). */
export function parseDues(html: string): DueLine[] {
  const g = gridWith(html, ['sem fee due'], ['fine due']);
  if (!g || !g.rows[0]) return [];
  const out: DueLine[] = [];
  g.headers.forEach((h, i) => {
    if (!/due/i.test(h)) return;
    const n = numOrNull(at(g.rows[0], i));
    if (n != null && n > 0) out.push({ label: clean(h).replace(/\s*due$/i, ''), amount: n });
  });
  return out;
}

/** The ERP's link to "My SEM Fee Structure" from any page's menu (its id is per student). */
export function feeLedgerHref(html: string): string | null {
  const m = /href="(\/?index\.php\?r=feepayments%2Ffeereports%2Fstudent_fee_dues&(?:amp;)?id=[^"]+)"/.exec(html);
  return m ? m[1].replace(/&amp;/g, '&').replace(/^index/, '/index') : null;
}

/* ------------------------------------------------------------------ */
/* Circulars                                                           */
/* ------------------------------------------------------------------ */

export interface Circular {
  id: string;
  subject: string;
  note: string;
  date: string;
  hasDocument: boolean;
}

export function parseCirculars(html: string): { circulars: Circular[]; total: number | null } {
  const g = gridWith(html, ['circular'], ['subject']);
  const total = numOrNull(/of\s+([\d,]+)\s+items?/i.exec(html.replace(/<[^>]+>/g, ''))?.[1]);
  if (!g) return { circulars: [], total };
  const c = { id: col(g, 'circularid'), subject: col(g, 'subject'), note: col(g, 'note'), date: col(g, 'createon') };
  const circulars = g.rows
    .map((r) => ({
      id: at(r, c.id),
      subject: at(r, c.subject),
      note: at(r, c.note),
      date: at(r, c.date),
      hasDocument: r.some((cell) => cell.links.some((l) => /circular_documents/.test(l.href))),
    }))
    .filter((x) => x.id && x.subject);
  return { circulars, total };
}

/** The document link for one circular id on a circulars list page. */
export function circularDocumentHref(html: string, id: string): string | null {
  const g = gridWith(html, ['circular'], ['subject']);
  if (!g) return null;
  const idCol = col(g, 'circularid');
  for (const r of g.rows) {
    if (at(r, idCol) !== id) continue;
    for (const cell of r) for (const l of cell.links) if (/circular_documents/.test(l.href)) return l.href;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Exam rooms                                                          */
/* ------------------------------------------------------------------ */

export interface ExamSeat {
  date: string;
  examType: string;
  slot: string;
  courseCode: string;
  room: string;
}

export function parseSeating(html: string): ExamSeat[] {
  const g = gridWith(html, ['room'], ['exam date', 'date']);
  if (!g) return [];
  const c = { date: col(g, 'date'), type: col(g, 'exam type'), slot: col(g, 'slot'), code: col(g, 'course code'), room: col(g, 'room') };
  return g.rows
    .map((r) => ({ date: at(r, c.date), examType: at(r, c.type), slot: at(r, c.slot), courseCode: at(r, c.code), room: at(r, c.room) }))
    .filter((s) => s.room || s.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ */
/* Internal marks                                                      */
/* ------------------------------------------------------------------ */

export interface InternalComponentLink {
  name: string;
  href: string;
}

export interface InternalCourseLinks {
  code: string;
  title: string;
  components: InternalComponentLink[];
}

/** The internals list: one row per course, each evaluation component a link to its marks. */
export function parseInternalLinks(html: string): InternalCourseLinks[] {
  const g = gridWith(html, ['evaluation'], ['course']);
  if (!g) return [];
  const code = col(g, 'course code');
  const name = g.headers.findIndex((h) => /course\s*name|coursedesc/i.test(h));
  const evalCol = col(g, 'evaluation');
  return g.rows
    .map((r) => ({
      code: at(r, code),
      title: at(r, name),
      components: (r[evalCol]?.links ?? [])
        .filter((l) => /index_student_marks/.test(l.href))
        .map((l) => ({ name: l.text, href: l.href.replace(/^index/, '/index') })),
    }))
    .filter((c) => c.code);
}

export interface ComponentPart {
  /** "1.A", "2", "CO3". */
  label: string;
  /** Marks scored; null when the question wasn't written (or the cell is blank). 0 is a real 0. */
  marks: number | null;
  /** The ERP marks an unattempted question with a negative number. */
  notWritten: boolean;
}

export interface ComponentMarks {
  total: number | null;
  max: number | null;
  weight: number | null;
  weighted: number | null;
  /** Question-wise ("1 A", "2") or outcome-wise ("Co1") marks, as the ERP labels them. */
  parts: ComponentPart[];
  remarks: string;
}

/**
 * A question or outcome column: "1", "1 A", "1A", "1.A", "Co1", "CO 2". Returns the
 * label as Attenly shows it ("1.A", "CO2"), or null for any other column.
 */
export function partLabel(header: string): string | null {
  const h = clean(header);
  const co = /^co\s*(\d+)$/i.exec(h);
  if (co) return `CO${co[1]}`;
  const q = /^(\d+)\s*[.\-]?\s*([a-z])?$/i.exec(h);
  if (!q) return null;
  return q[2] ? `${q[1]}.${q[2].toUpperCase()}` : q[1];
}

/** A question's cell: a negative number means not written; anything else is the score. */
export function partMarks(cell: string): { marks: number | null; notWritten: boolean } {
  const n = numOrNull(cell);
  return n != null && n < 0 ? { marks: null, notWritten: true } : { marks: n, notWritten: false };
}

/** One component's marks page (summative "Qp Wise" or formative "Co wise"): a single row. */
export function parseComponentMarks(html: string): ComponentMarks | null {
  const g = gridWith(html, ['max marks'], ['weight']);
  if (!g || !g.rows[0]) return null;
  const r = g.rows[0];
  const parts: ComponentMarks['parts'] = [];
  g.headers.forEach((h, i) => {
    const label = partLabel(h);
    if (label) parts.push({ label, ...partMarks(at(r, i)) });
  });
  return {
    total: numOrNull(at(r, col(g, 'total marks'))),
    max: numOrNull(at(r, col(g, 'max marks'))),
    weight: numOrNull(at(r, g.headers.findIndex((h) => lower(h) === 'weight'))),
    weighted: numOrNull(at(r, col(g, 'weighted'))),
    parts,
    remarks: at(r, col(g, 'remarks')),
  };
}

export interface InternalComponent extends Partial<ComponentMarks> {
  name: string;
  /** False when the ERP has no marks for it yet. */
  marked: boolean;
}

export interface InternalCourse {
  code: string;
  title: string;
  components: InternalComponent[];
}

/* ------------------------------------------------------------------ */
/* Mid-term papers                                                     */
/* ------------------------------------------------------------------ */

export interface PaperRef {
  courseCode: string;
  courseName: string;
  academicYear: string;
  semester: string;
  exam: string;
  href: string | null;
}

/** The "In Sem Answer Scripts" list (the ERP calls the grid SEM END COURSE RESULT). */
export function parsePaperList(html: string): PaperRef[] {
  return parseResults(html).map((r) => ({
    courseCode: r.courseCode,
    courseName: r.courseName,
    academicYear: r.academicYear,
    semester: r.semester,
    exam: r.exam,
    href: r.bookletUrl,
  }));
}

export interface PaperQuestion {
  question: string;
  max: number | null;
  /** Marks scored; null when not written. 0 is a real 0. */
  got: number | null;
  /** The ERP marks an unattempted question with a negative number. */
  notWritten: boolean;
}

/** One booklet: question-wise maximum and obtained marks. Evaluator names are left out. */
export function parsePaperQuestions(html: string): PaperQuestion[] {
  const b = parseBookletMarks(html);
  const hs = b.headers.map(lower);
  const q = hs.findIndex((h) => h.includes('question'));
  const max = hs.findIndex((h) => h.includes('max'));
  const got = hs.findIndex((h) => h.includes('obtained'));
  if (q < 0 || got < 0) return [];
  return b.rows
    .map((r) => {
      const { marks, notWritten } = partMarks(r[got] ?? '');
      return { question: r[q] ?? '', max: numOrNull(r[max]), got: marks, notWritten };
    })
    .filter((x) => x.question)
    .sort((a, b) => a.question.localeCompare(b.question, 'en', { numeric: true }));
}

export interface Paper extends Omit<PaperRef, 'href'> {
  questions: PaperQuestion[];
  /** The ERP has the scanned script (opened through /api/erp/booklet). */
  hasScan: boolean;
}

/* ------------------------------------------------------------------ */
/* Terms on a search form                                              */
/* ------------------------------------------------------------------ */

export interface FormTerm {
  academicyear: string;
  yearLabel: string;
  semesterid: string;
  semester: string;
}

/** Year × semester pairs a search form offers (the student's own years), newest first. */
export function parseFormTerms(html: string): FormTerm[] {
  const $ = cheerio.load(html);
  const opts = (name: string) =>
    $(`select[name="DynamicModel[${name}]"] option`)
      .toArray()
      .map((o) => ({ id: ($(o).attr('value') ?? '').trim(), label: clean($(o).text()) }))
      .filter((o) => o.id);
  const years = opts('academicyear');
  const sems = opts('semester').length ? opts('semester') : opts('semesterid');
  const out: FormTerm[] = [];
  for (const y of years) for (const s of sems) out.push({ academicyear: y.id, yearLabel: y.label, semesterid: s.id, semester: s.label });
  const rank = (s: string) => (/odd/i.test(s) ? 1 : /even/i.test(s) ? 2 : 3);
  return out.sort((a, b) => b.yearLabel.localeCompare(a.yearLabel) || rank(b.semester) - rank(a.semester));
}

/* ------------------------------------------------------------------ */
/* Courses (the profile's Courses tab)                                 */
/* ------------------------------------------------------------------ */

export interface CourseClass {
  studyYear: string;
  academicYear: string;
  semester: string;
  code: string;
  title: string;
  /** L, T, P or S. */
  ltps: string;
  section: string;
  faculty: string;
}

/** One page of the Courses tab (a class per row: course × L/T/P/S), and the tab's total row count. */
export function parseCourseClasses(html: string): { classes: CourseClass[]; total: number | null } {
  const total = numOrNull(/of\s+([\d,]+)\s+items?/i.exec(html.replace(/<[^>]+>/g, ''))?.[1]);
  const g = gridWith(html, ['coursecode', 'course code'], ['faculty']);
  if (!g) return { classes: [], total };
  const c = {
    year: g.headers.findIndex((h) => lower(h) === 'year' || lower(h) === 'study year'),
    ay: col(g, 'academicyear') >= 0 ? col(g, 'academicyear') : col(g, 'academic', 'year'),
    sem: col(g, 'semester'),
    code: g.headers.findIndex((h) => /course\s*code/i.test(h)),
    title: g.headers.findIndex((h) => /course\s*(desc|name|title)/i.test(h)),
    ltps: col(g, 'ltps'),
    section: col(g, 'section'),
    faculty: col(g, 'faculty'),
  };
  const classes = g.rows
    .map((r) => ({
      studyYear: at(r, c.year),
      academicYear: at(r, c.ay),
      semester: at(r, c.sem),
      code: at(r, c.code),
      title: at(r, c.title),
      ltps: at(r, c.ltps).toUpperCase(),
      section: at(r, c.section),
      faculty: at(r, c.faculty),
    }))
    .filter((x) => x.code);
  return { classes, total };
}

/* ------------------------------------------------------------------ */
/* A booklet's scanned answer script                                   */
/* ------------------------------------------------------------------ */

/** The scan's address on a booklet page (pdf.js loads it from `var url = "…download_script_frompath…"`). */
export function paperScanHref(html: string): string | null {
  const m = /(?:var\s+url\s*=\s*|["'])(\/?index\.php\?r=studentinfo(?:\/|%2F)studentendexamresult(?:\/|%2F)download_script_frompath&(?:amp;)?id=[^"'\s]+)/.exec(html);
  if (!m) return null;
  return m[1].replace(/&amp;/g, '&').replace(/^index/, '/index');
}
