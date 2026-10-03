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

/** Parse the ERP attendance table into per-subject LTPS counts. */
export function parseAttendance(html: string): SubjectAttendance[] {
  try {
    const $ = cheerio.load(html);
    const tables = $('table').toArray();
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

      const firstRowDays = grid[0].filter((c) => DAY_NAMES.includes(norm(c))).length;
      const firstColDays = grid.filter((r) => DAY_NAMES.includes(norm(r[0] ?? ''))).length;
      if (firstRowDays < 2 && firstColDays < 2) continue;

      const days: TimetableDay[] = [];
      if (firstColDays >= firstRowDays) {
        // Days as rows; first row holds period labels.
        const labels = grid[0].slice(1);
        for (let r = 1; r < grid.length; r++) {
          const dayName = DAY_SHORT[norm(grid[r][0])] ?? grid[r][0];
          if (!dayName) continue;
          const periods: TimetablePeriod[] = [];
          for (let c = 1; c < grid[r].length; c++) {
            const cell = grid[r][c];
            if (!cell || /break|lunch/i.test(cell)) continue;
            const { period, start, end } = parsePeriodLabel(labels[c - 1] ?? `P${c}`);
            const parts = cell.split("|").map((p) => p.trim()).filter(Boolean);
            const code = (parts[0] ?? '').split(' ')[0];
            periods.push({
              period, start, end,
              subjectCode: code,
              subjectTitle: parts[0] ?? code,
              room: parts[1] ?? '',
              faculty: parts[2] ?? '',
              type: inferType(parts[0] ?? ""),
            });
          }
          days.push({ day: dayName, periods });
        }
      } else {
        // Days as columns; first column holds period labels.
        const dayNames = grid[0].slice(1).map((d) => DAY_SHORT[norm(d)] ?? d);
        const labels = grid.slice(1).map((r) => r[0]);
        dayNames.forEach((dayName, di) => {
          if (!dayName) return;
          const periods: TimetablePeriod[] = [];
          for (let r = 1; r < grid.length; r++) {
            const cell = grid[r][di + 1];
            if (!cell || /break|lunch/i.test(cell)) continue;
            const { period, start, end } = parsePeriodLabel(labels[r - 1] ?? `P${r}`);
            const parts = cell.split("|").map((p) => p.trim()).filter(Boolean);
            const code = (parts[0] ?? '').split(' ')[0];
            periods.push({
              period, start, end,
              subjectCode: code,
              subjectTitle: parts[0] ?? code,
              room: parts[1] ?? '',
              faculty: parts[2] ?? '',
              type: inferType(parts[0] ?? ""),
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
