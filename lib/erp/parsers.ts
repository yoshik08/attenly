/**
 * Heuristic HTML parsers for the KL University ERP (newerp.kluniversity.in).
 *
 * The portal is a Yii2 PHP app serving server-rendered HTML (no JSON API).
 * Because the exact table markup is not publicly documented, these parsers
 * work in two stages:
 *   1. Try to map columns via header keywords (handles typical Yii2 GridView
 *      layouts like "Course Code", "L - Conducted", "L - Attended", ...).
 *   2. Fall back to positional assumptions (code/title first, then
 *      conducted/attended pairs in L,T,P,S order).
 *
 * Every parser is defensive: unknown markup yields empty results, never throws.
 * Unit tests in tests/parsers.test.ts cover representative fixture HTML.
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { ComponentKey, ComponentMap, SubjectAttendance } from '../math';
import { COMPONENT_ORDER } from '../math';

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function num(s: string): number {
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : 0;
}

const COMP_ALIASES: Record<ComponentKey, string[]> = {
  L: ['lecture', 'lec', ' l ', '(l)', 'theory'],
  T: ['tutorial', 'tut', ' t ', '(t)'],
  P: ['practical', 'prac', 'lab', ' p ', '(p)'],
  S: ['skilling', 'skill', ' s ', '(s)'],
};

function headerMentions(h: string, words: string[]): boolean {
  return words.some((w) => h.includes(w));
}

interface ColumnMap {
  code: number;
  title: number;
  pairs: Partial<Record<ComponentKey, { cond: number; att: number }>>;
}

/** Map table columns using header keywords. Returns null when headers are unusable. */
function mapColumns(headers: string[]): ColumnMap | null {
  const hs = headers.map(norm);
  const find = (pred: (h: string, i: number) => boolean): number => {
    const i = hs.findIndex(pred);
    return i;
  };

  const code = find((h) => /code/.test(h) || (/subject/.test(h) && !/name|title/.test(h)) || /course(?!\s*(title|name))/.test(h));
  const title = find((h, i) => i !== code && (/title/.test(h) || /name/.test(h) || (/course/.test(h) && !/code/.test(h))));

  const pairs: ColumnMap['pairs'] = {};
  let mappedAny = false;
  for (const k of COMPONENT_ORDER) {
    const aliases = COMP_ALIASES[k];
    const cond = find((h) => headerMentions(h, aliases) && /conduct|held|total|engaged/.test(h));
    const att = find((h) => headerMentions(h, aliases) && /attend|present/.test(h));
    if (cond >= 0 && att >= 0) {
      pairs[k] = { cond, att };
      mappedAny = true;
    }
  }
  if (!mappedAny) return null;
  return { code: code >= 0 ? code : 0, title: title >= 0 ? title : 1, pairs };
}

function emptyComponents(): ComponentMap {
  return {
    L: { conducted: 0, attended: 0 },
    T: { conducted: 0, attended: 0 },
    P: { conducted: 0, attended: 0 },
    S: { conducted: 0, attended: 0 },
  };
}

type Selection = ReturnType<cheerio.CheerioAPI>;

/** Parse the KL ERP "courselist" table: one row per (course, LTPS component).
 * Headers look like: # | Coursecode | Coursedesc | Ltps | … | Total Conducted | Total Attended | … */
function parseCourselistTable($t: Selection, $: cheerio.CheerioAPI): SubjectAttendance[] {
  const headerCells = $t.find('thead th').toArray();
  let headers = headerCells.map((th) => $(th).text());
  let skipFirst = headerCells.length > 0;
  if (headers.length === 0) {
    const firstRow = $t.find('tr').first();
    headers = firstRow.find('th, td').toArray().map((c) => $(c).text());
    skipFirst = false;
  }
  const hs = headers.map(norm);
  const find = (pred: (h: string) => boolean): number => hs.findIndex(pred);
  const codeI = find((h) => /course\s*code/.test(h));
  const titleI = find((h) => /course\s*(desc|title|name)/.test(h));
  const ltpsI = find((h) => /^ltps$/.test(h));
  const condI = find((h) => /total\s*conducted/.test(h));
  const attI = find((h) => /total\s*attended/.test(h));
  if (codeI < 0 || ltpsI < 0 || condI < 0 || attI < 0) return [];

  const rows = $t.find('tbody tr').length > 0 ? $t.find('tbody tr').toArray() : $t.find('tr').toArray();
  const byCode = new Map<string, SubjectAttendance>();
  rows.forEach((tr, ri) => {
    if (!skipFirst && ri === 0) return;
    const cells = $(tr).find('td').toArray().map((td) => $(td).text().trim());
    if (cells.length === 0) return;
    const get = (i: number): string => (i >= 0 && i < cells.length ? cells[i] : '');
    const code = get(codeI).split('\n')[0].trim();
    const comp = get(ltpsI).trim().toUpperCase();
    if (!code || !/^[LTPS]$/.test(comp)) return;
    let subj = byCode.get(code);
    if (!subj) {
      subj = {
        code,
        title: (titleI >= 0 ? get(titleI).split('\n')[0].trim() : '') || code,
        components: emptyComponents(),
      };
      byCode.set(code, subj);
    }
    subj.components[comp as ComponentKey] = { conducted: num(get(condI)), attended: num(get(attI)) };
  });
  return [...byCode.values()];
}

/** Parse the ERP attendance table into per-subject LTPS counts. */
export function parseAttendance(html: string): SubjectAttendance[] {
  try {
    const $ = cheerio.load(html);
    const tables = $('table').toArray();

    // Prefer the KL courselist layout (one row per course × LTPS component).
    for (const t of tables) {
      const $t = $(t);
      const htxt = $t.find('thead th').toArray().map((th) => norm($(th).text())).join(' | ')
        || $t.find('tr').first().find('th, td').toArray().map((c) => norm($(c).text())).join(' | ');
      if (/ltps/.test(htxt) && /course\s*code/.test(htxt)) {
        const parsed = parseCourselistTable($t, $);
        if (parsed.length > 0) return parsed;
      }
    }

    let best: { score: number; el: unknown } | null = null;

    for (const t of tables) {
      const $t = $(t);
      let headers: string[] = $t
        .find('thead th')
        .toArray()
        .map((th) => $(th).text());
      if (headers.length === 0) {
        headers = $t
          .find('tr')
          .first()
          .find('th, td')
          .toArray()
          .map((c) => $(c).text());
      }
      const h = headers.map(norm).join(' | ');
      let score = 0;
      if (/subject|course|code/.test(h)) score += 2;
      if (/conduct|held/.test(h)) score += 2;
      if (/attend|present/.test(h)) score += 2;
      if (/lecture|tutorial|practical|skilling/.test(h)) score += 3;
      if (score > (best?.score ?? 0)) best = { score, el: t };
    }
    if (!best || best.score < 4) return [];

    const $t = $(best.el as never);
    const headerCells = $t.find('thead th').toArray();
    let headerRowSkipped = headerCells.length > 0;
    let headers = headerCells.map((th) => $(th).text());
    if (headers.length === 0) {
      const firstRow = $t.find('tr').first();
      headers = firstRow.find('th, td').toArray().map((c) => $(c).text());
      headerRowSkipped = false;
    }

    const colMap = mapColumns(headers);
    const rows = $t.find('tbody tr').length > 0 ? $t.find('tbody tr').toArray() : $t.find('tr').toArray();
    const out: SubjectAttendance[] = [];

    rows.forEach((tr, ri) => {
      if (!headerRowSkipped && ri === 0) return; // first row was the header
      const cells = $(tr).find('td').toArray().map((td) => $(td).text().trim());
      if (cells.length === 0) return;

      const get = (i: number): string => (i >= 0 && i < cells.length ? cells[i] : '');
      let code = '';
      let title = '';
      const components = emptyComponents();

      if (colMap) {
        code = get(colMap.code).split('\n')[0].trim();
        title = get(colMap.title).split('\n')[0].trim();
        for (const k of COMPONENT_ORDER) {
          const p = colMap.pairs[k];
          if (!p) continue;
          components[k] = { conducted: num(get(p.cond)), attended: num(get(p.att)) };
        }
      } else {
        // Positional fallback: code, title, then (conducted, attended) pairs in L,T,P,S order.
        code = get(0).split('\n')[0].trim();
        title = get(1).split('\n')[0].trim();
        const numericIdx: number[] = [];
        for (let i = 2; i < cells.length; i++) {
          if (/^-?[\d,]+(\.\d+)?$/.test(cells[i].trim())) numericIdx.push(i);
        }
        COMPONENT_ORDER.forEach((k, ki) => {
          const ci = numericIdx[ki * 2];
          const ai = numericIdx[ki * 2 + 1];
          if (ci !== undefined && ai !== undefined) {
            components[k] = { conducted: num(get(ci)), attended: num(get(ai)) };
          }
        });
      }

      if (!code && !title) return;
      if (/^total$/i.test(code)) return; // skip summary rows
      out.push({ code: code || title, title: title || code, components });
    });

    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

export interface TimetablePeriod {
  period: string;
  start: string;
  end: string;
  subjectCode: string;
  subjectTitle: string;
  room: string;
  faculty: string;
  type: ComponentKey | null;
}

export interface TimetableDay {
  day: string;
  periods: TimetablePeriod[];
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_SHORT: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};
const DAY_SHORT_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Canonical 3-letter day ("Mon") for full or short English day names; null otherwise. */
function dayKey(s: string): string | null {
  const n = norm(s);
  if (DAY_SHORT[n]) return DAY_SHORT[n];
  if (DAY_SHORT_NAMES.includes(n)) return n[0].toUpperCase() + n.slice(1);
  return null;
}

/** Parse a KL timetable cell like "25CS1302E-L - S-9 -RoomNo-H-003". Null when not KL-shaped. */
function parseKlCell(cell: string): { code: string; type: ComponentKey | null; room: string; section: string } | null {
  const m = cell.match(/^([A-Z0-9]+)-([LTPS])\s*-\s*(.+)$/i);
  if (!m) return null;
  const rest = m[3].trim();
  const roomM = rest.match(/RoomNo-?\s*(.+)$/i);
  const room = roomM ? roomM[1].trim() : '';
  const section = roomM ? rest.slice(0, roomM.index).replace(/-\s*$/, '').trim() : rest;
  return { code: m[1].toUpperCase(), type: m[2].toUpperCase() as ComponentKey, room, section };
}

function parsePeriodLabel(label: string): { period: string; start: string; end: string } {
  const t = label.replace(/\s+/g, ' ').trim();
  const m = t.match(/P?\s*0?(\d{1,2})\s*(?:\(?\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*\)?)?/i);
  if (m) {
    return { period: `P${m[1]}`, start: m[2] ?? '', end: m[3] ?? '' };
  }
  return { period: t || 'P?', start: '', end: '' };
}

function inferType(subjectLine: string): ComponentKey | null {
  const t = norm(subjectLine);
  // Explicit "(L)" style markers win over loose aliases.
  const m = t.match(/\(([ltps])\)/);
  if (m) return m[1].toUpperCase() as ComponentKey;
  const spaced = ` ${t} `;
  for (const k of COMPONENT_ORDER) {
    if (COMP_ALIASES[k].some((a) => spaced.includes(a))) return k;
  }
  return null;
}

/** Parse a day/period timetable grid. Handles days-as-rows and days-as-columns. */
export function parseTimetable(html: string): TimetableDay[] {
  try {
    const $ = cheerio.load(html);
    const tables = $('table').toArray();

    for (const t of tables) {
      const $t = $(t);
      const rows = $t.find('tr').toArray();
      if (rows.length < 2) continue;
      // Preserve <br> structure as " | " separators so multi-line cells
      // (code / room / faculty) stay splittable after text extraction.
      const grid: string[][] = rows.map((tr) =>
        $(tr)
          .find('th, td')
          .toArray()
          .map((c) =>
            ($(c).html() ?? '')
              .replace(/<br\s*\/?>/gi, ' | ')
              .replace(/<\/(p|div|li)>/gi, ' | ')
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          ),
      );

      const firstRowDays = grid[0].filter((c) => dayKey(c) !== null).length;
      const firstColDays = grid.filter((r) => dayKey(r[0] ?? '') !== null).length;
      if (firstRowDays < 2 && firstColDays < 2) continue;

      const days: TimetableDay[] = [];
      if (firstColDays >= firstRowDays) {
        // Days as rows; first row holds period labels.
        const labels = grid[0].slice(1);
        for (let r = 1; r < grid.length; r++) {
          const dayName = dayKey(grid[r][0]) ?? grid[r][0];
          if (!dayName) continue;
          const periods: TimetablePeriod[] = [];
          for (let c = 1; c < grid[r].length; c++) {
            const cell = grid[r][c];
            if (!cell || cell === '-' || /break|lunch/i.test(cell)) continue;
            const { period, start, end } = parsePeriodLabel(labels[c - 1] ?? `P${c}`);
            const kl = parseKlCell(cell);
            const parts = cell.split("|").map((p) => p.trim()).filter(Boolean);
            const code = kl ? kl.code : (parts[0] ?? '').split(' ')[0];
            periods.push({
              period, start, end,
              subjectCode: code,
              subjectTitle: parts[0] ?? code,
              room: kl ? kl.room : (parts[1] ?? ''),
              faculty: parts[2] ?? '',
              type: kl ? kl.type : inferType(parts[0] ?? ""),
            });
          }
          days.push({ day: dayName, periods });
        }
      } else {
        // Days as columns; first column holds period labels.
        const dayNames = grid[0].slice(1).map((d) => dayKey(d) ?? d);
        const labels = grid.slice(1).map((r) => r[0]);
        dayNames.forEach((dayName, di) => {
          if (!dayName) return;
          const periods: TimetablePeriod[] = [];
          for (let r = 1; r < grid.length; r++) {
            const cell = grid[r][di + 1];
            if (!cell || cell === '-' || /break|lunch/i.test(cell)) continue;
            const { period, start, end } = parsePeriodLabel(labels[r - 1] ?? `P${r}`);
            const kl = parseKlCell(cell);
            const parts = cell.split("|").map((p) => p.trim()).filter(Boolean);
            const code = kl ? kl.code : (parts[0] ?? '').split(' ')[0];
            periods.push({
              period, start, end,
              subjectCode: code,
              subjectTitle: parts[0] ?? code,
              room: kl ? kl.room : (parts[1] ?? ''),
              faculty: parts[2] ?? '',
              type: kl ? kl.type : inferType(parts[0] ?? ""),
            });
          }
          days.push({ day: dayName, periods });
        });
      }
      if (days.length > 0) return days;
    }
    return [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Login-page helpers
// ---------------------------------------------------------------------------

/** Extract the Yii2 CSRF token from a page, if present. */
export function extractCsrf(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    const v = $('input[name="_csrf"]').attr('value') ?? $('meta[name="csrf-token"]').attr('content');
    return v || null;
  } catch {
    return null;
  }
}

/** Extract the captcha image src from the ERP login page, if present. */
export function extractCaptchaSrc(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    const src =
      $('#loginFormCaptcha-image').attr('src') ??
      $('img[id*="captcha" i]').first().attr('src') ??
      null;
    return src || null;
  } catch {
    return null;
  }
}

/** True when the HTML looks like the ERP login page (used for session-expiry detection). */
export function detectLoginForm(html: string): boolean {
  try {
    const $ = cheerio.load(html);
    return $('#login-form').length > 0 || $('input[name="LoginForm[username]"]').length > 0;
  } catch {
    return false;
  }
}

/** Scrape a human-readable login error from the login page, if any. */
export function parseLoginError(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    const err = $('.help-block-error').first().text().trim()
      || $('.alert-danger').first().text().trim()
      || $('.help-block').first().text().trim();
    return err || null;
  } catch {
    return null;
  }
}

/** Classify a scraped login error into a machine-readable code. */
export function classifyLoginError(err: string | null): 'bad_captcha' | 'bad_credentials' | 'unknown' {
  if (!err) return 'unknown';
  const e = norm(err);
  if (/captcha|verification/.test(e)) return 'bad_captcha';
  if (/password|username|credential|invalid|incorrect/.test(e)) return 'bad_credentials';
  return 'unknown';
}

export interface TermList {
  years: { id: string; label: string }[];
  semesters: { id: string; label: string }[];
}

/** Scrape available academic-year/semester options from an authenticated ERP page. */
export function parseTermOptions(html: string): TermList {
  try {
    const $ = cheerio.load(html);
    const years = $('select[name*="academicyear"] option, select[id*="academicyear"] option')
      .toArray()
      .map((o) => ({ id: ($(o).attr('value') || $(o).text()).trim(), label: $(o).text().trim() }))
      .filter((y) => y.id && !/select|choose/i.test(y.label));
    const semesters = $('select[name*="semesterid"] option, select[id*="semesterid"] option')
      .toArray()
      .map((o) => ({ id: ($(o).attr('value') || $(o).text()).trim(), label: $(o).text().trim() }))
      .filter((s) => s.id && !/select|choose/i.test(s.label));
    return { years, semesters };
  } catch {
    return { years: [], semesters: [] };
  }
}

/* ---------------------------------------------------------------------------
 * Internals / CGPA / results / booklet parsers (studentendexamresult module)
 * ------------------------------------------------------------------------- */

export interface InternalComponent {
  name: string;
  marks: string;
}

export interface InternalRow {
  courseCode: string;
  courseTitle: string;
  components: InternalComponent[];
}

function tableHeaders($: cheerio.CheerioAPI, table: cheerio.Cheerio<Element>): string[] {
  const ths = table.find('thead th');
  const src = ths.length ? ths : table.find('tr').first().find('th, td');
  return src.toArray().map((h) => $(h).text().replace(/\s+/g, ' ').trim());
}

/** Pick the data table: the one with the most body rows. */
function biggestTable($: cheerio.CheerioAPI): cheerio.Cheerio<Element> | null {
  let best: cheerio.Cheerio<Element> | null = null;
  let bestRows = 0;
  $('table').each((_, t) => {
    const rows = $(t).find('tbody tr').length || $(t).find('tr').length;
    if (rows > bestRows) {
      bestRows = rows;
      best = $(t);
    }
  });
  return best;
}

/**
 * Parse the Course Internals grid: one row per course, one column per
 * evaluation component (Mid-Term, Hackathon, MOOCs, …). Header-driven with a
 * positional fallback (sno, year, sem, code, name, then components).
 */
export function parseInternals(html: string): InternalRow[] {
  try {
    const $ = cheerio.load(html);
    const table = biggestTable($);
    if (!table) return [];
    const headers = tableHeaders($, table).map(norm);
    let codeIdx = headers.findIndex((h) => h.includes('course code') || h === 'coursecode');
    let nameIdx = headers.findIndex(
      (h) => h.includes('course') && (h.includes('name') || h.includes('title') || h.includes('desc')),
    );
    if (codeIdx < 0) codeIdx = 3;
    if (nameIdx < 0) nameIdx = 4;
    // Component columns: everything after the identity columns that isn't
    // itself an identity column (sno/year/semester/etc).
    const skip = new Set([codeIdx, nameIdx]);
    headers.forEach((h, i) => {
      if (/^(s\.?no|#|sno)$/.test(h) || h.includes('academic') || (h.includes('semester') && !h.includes('mark')) || h.includes('study year') || h === 'type' || h.includes('remarks') || h.includes('uniid')) {
        skip.add(i);
      }
    });
    const compIdx = headers.map((_, i) => i).filter((i) => !skip.has(i) && headers[i]);
    const out: InternalRow[] = [];
    table.find('tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length <= Math.max(codeIdx, nameIdx)) return;
      const code = $(tds[codeIdx]).text().replace(/\s+/g, ' ').trim();
      if (!code || !/[A-Z]{2,}\d/.test(code)) return;
      const title = $(tds[nameIdx]).text().replace(/\s+/g, ' ').trim();
      const components: InternalComponent[] = [];
      for (const i of compIdx) {
        if (i >= tds.length) continue;
        const marks = $(tds[i]).text().replace(/\s+/g, ' ').trim();
        components.push({ name: tableHeaders($, table)[i] || `Component ${i}`, marks });
      }
      out.push({ courseCode: code, courseTitle: title || code, components });
    });
    return out;
  } catch {
    return [];
  }
}

export interface CgpaRow {
  courseCode: string;
  courseName: string;
  grade: string;
  gradePoint: number;
  credits: number;
  status: string;
  academicYear: string;
  semester: string;
}

/**
 * Parse the My CGPA grid: every course the student has taken, with grade,
 * grade point, credits, academic year and semester. Follows the header-keyword
 * mapping first, then the positional layout observed in the wild
 * (code=3, name=4, grade=5, point=6, credits=7, status=8, year=9, sem=10).
 */
export function parseCgpa(html: string): CgpaRow[] {
  try {
    const $ = cheerio.load(html);
    const table = biggestTable($);
    if (!table) return [];
    const headers = tableHeaders($, table).map(norm);
    const find = (...words: string[]) => headers.findIndex((h) => words.every((w) => h.includes(w)));
    let codeIdx = find('course', 'code');
    let nameIdx = find('course', 'name');
    if (nameIdx < 0) nameIdx = find('course', 'title');
    let gradeIdx = headers.findIndex((h) => h === 'grade' || h.endsWith(' grade'));
    let pointIdx = find('grade', 'point');
    let credIdx = find('credit');
    let statusIdx = headers.findIndex((h) => h.includes('status') || h.includes('result') || h === 'p');
    let yearIdx = find('academic', 'year');
    let semIdx = headers.findIndex((h) => h.includes('semester') && !h.includes('year'));
    if (codeIdx < 0 || gradeIdx < 0) {
      // Positional fallback (matches the observed ERP layout).
      codeIdx = 3; nameIdx = 4; gradeIdx = 5; pointIdx = 6; credIdx = 7; statusIdx = 8; yearIdx = 9; semIdx = 10;
    }
    const out: CgpaRow[] = [];
    table.find('tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length <= Math.max(codeIdx, gradeIdx)) return;
      const cell = (i: number) => (i >= 0 && i < tds.length ? $(tds[i]).text().replace(/\s+/g, ' ').trim() : '');
      const code = cell(codeIdx);
      if (!code || !/[A-Z]{2,}\d/.test(code)) return;
      out.push({
        courseCode: code,
        courseName: cell(nameIdx) || code,
        grade: cell(gradeIdx),
        gradePoint: parseFloat(cell(pointIdx)) || 0,
        credits: parseFloat(cell(credIdx)) || 0,
        status: cell(statusIdx),
        academicYear: cell(yearIdx),
        semester: cell(semIdx),
      });
    });
    return out;
  } catch {
    return [];
  }
}

export interface ResultRow {
  courseCode: string;
  courseName: string;
  academicYear: string;
  semester: string;
  studyYear: string;
  type: string;
  exam: string;
  evalNo: string;
  /** URL (ERP-relative or absolute) backing the "Booklet" popup, if found. */
  bookletUrl: string | null;
  /** Direct ERP download URL for the full answer-script PDF, if found. */
  pdfUrl: string | null;
}

function cleanErpUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let u = raw.replace(/&amp;/g, '&').trim();
  if (!u || u === '#' || u.toLowerCase().startsWith('javascript:void')) return null;
  const m = u.match(/['"](\/index\.php[^'"]+)['"]/);
  if (m) u = m[1].replace(/&amp;/g, '&');
  if (/^javascript:/i.test(u)) return null;
  if (u.startsWith('index.php')) u = '/' + u;
  return u || null;
}

/**
 * Parse the Sem End Course Result grid (the "View Booklets" table). Extracts
 * the Booklet cell's link target so the popup and the PDF download can be
 * fetched later through the ERP proxy.
 */
export function parseResults(html: string): ResultRow[] {
  try {
    const $ = cheerio.load(html);
    const table = biggestTable($);
    if (!table) return [];
    const headers = tableHeaders($, table).map(norm);
    const find = (...words: string[]) => headers.findIndex((h) => words.every((w) => h.includes(w)));
    let codeIdx = find('course', 'code');
    let nameIdx = headers.findIndex((h) => h.includes('course') && h.includes('name'));
    let yearIdx = find('academic', 'year');
    let semIdx = headers.findIndex((h) => h === 'semester' || (h.includes('semester') && !h.includes('year')));
    let studyIdx = find('study', 'year');
    let typeIdx = headers.findIndex((h) => h === 'type');
    let examIdx = find('exam');
    let evalIdx = headers.findIndex((h) => h.includes('eval'));
    let bookletIdx = headers.findIndex((h) => h.includes('booklet'));
    if (codeIdx < 0) { codeIdx = 1; nameIdx = 2; yearIdx = 3; semIdx = 4; studyIdx = 5; typeIdx = 6; examIdx = 7; evalIdx = 8; bookletIdx = 9; }
    const out: ResultRow[] = [];
    table.find('tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length <= codeIdx) return;
      const cell = (i: number) => (i >= 0 && i < tds.length ? $(tds[i]).text().replace(/\s+/g, ' ').trim() : '');
      const code = cell(codeIdx);
      if (!code || !/[A-Z]{2,}\d/.test(code)) return;
      let bookletUrl: string | null = null;
      let pdfUrl: string | null = null;
      const linkCell = bookletIdx >= 0 && bookletIdx < tds.length ? $(tds[bookletIdx]) : null;
      const scope = linkCell ?? $(tr);
      scope.find('a').each((_, a) => {
        const href = cleanErpUrl($(a).attr('href'));
        const onclick = $(a).attr('onclick') ?? '';
        const fromOnclick = cleanErpUrl(onclick);
        for (const u of [href, fromOnclick]) {
          if (!u) continue;
          if (/download_script_frompath/i.test(u)) pdfUrl = pdfUrl ?? u;
          else bookletUrl = bookletUrl ?? u;
        }
      });
      // onclick directly on the cell (no anchor)
      if (!bookletUrl && !pdfUrl && linkCell) {
        const u = cleanErpUrl(linkCell.attr('onclick'));
        if (u) {
          if (/download_script_frompath/i.test(u)) pdfUrl = u;
          else bookletUrl = u;
        }
      }
      out.push({
        courseCode: code,
        courseName: cell(nameIdx) || code,
        academicYear: cell(yearIdx),
        semester: cell(semIdx),
        studyYear: cell(studyIdx),
        type: cell(typeIdx),
        exam: cell(examIdx),
        evalNo: cell(evalIdx),
        bookletUrl,
        pdfUrl,
      });
    });
    return out;
  } catch {
    return [];
  }
}

export interface BookletMarks {
  title: string;
  headers: string[];
  rows: string[][];
}

/**
 * Parse the QP-wise marks popup generically: first meaningful table becomes
 * headers + rows; the title is scraped from the modal/popup heading.
 */
export function parseBookletMarks(html: string): BookletMarks {
  try {
    const $ = cheerio.load(html);
    const title =
      $('.modal-title').first().text().replace(/\s+/g, ' ').trim() ||
      $('h1, h2, h3, h4').first().text().replace(/\s+/g, ' ').trim() ||
      'QP-wise marks';
    const table = biggestTable($);
    if (!table) return { title, headers: [], rows: [] };
    const headers = tableHeaders($, table);
    const rows: string[][] = [];
    table.find('tbody tr').each((_, tr) => {
      const cells = $(tr)
        .find('td')
        .toArray()
        .map((td) => $(td).text().replace(/\s+/g, ' ').trim());
      if (cells.some((c) => c)) rows.push(cells);
    });
    return { title, headers, rows };
  } catch {
    return { title: 'QP-wise marks', headers: [], rows: [] };
  }
}

/** Compute CGPA/SGPA from parsed CGPA rows. */
export function computeGpa(rows: CgpaRow[]): {
  cgpa: number | null;
  terms: { key: string; academicYear: string; semester: string; sgpa: number | null; credits: number }[];
} {
  let totP = 0;
  let totC = 0;
  const byTerm = new Map<string, { academicYear: string; semester: string; p: number; c: number }>();
  for (const r of rows) {
    if (r.credits <= 0 || r.gradePoint <= 0) continue;
    if (/fail|f\b/i.test(r.status) && r.grade.toUpperCase() === 'F') continue;
    totP += r.gradePoint * r.credits;
    totC += r.credits;
    const key = `${r.academicYear}::${r.semester}`;
    const t = byTerm.get(key) ?? { academicYear: r.academicYear, semester: r.semester, p: 0, c: 0 };
    t.p += r.gradePoint * r.credits;
    t.c += r.credits;
    byTerm.set(key, t);
  }
  const terms = [...byTerm.entries()].map(([key, t]) => ({
    key,
    academicYear: t.academicYear,
    semester: t.semester,
    sgpa: t.c > 0 ? Math.round((t.p / t.c) * 100) / 100 : null,
    credits: t.c,
  }));
  // Sort terms chronologically by academic year start.
  terms.sort((a, b) => a.academicYear.localeCompare(b.academicYear) || a.semester.localeCompare(b.semester));
  return { cgpa: totC > 0 ? Math.round((totP / totC) * 100) / 100 : null, terms };
}
