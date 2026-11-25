/**
 * Course feedback on the ERP (Feedback → Submit): one form per faculty per course
 * component, five-point questions. "Force submit" answers every pending form with the
 * same option (Good) and posts it, then reads the pending list again to see which
 * forms the ERP took.
 *
 * Unlike everything else in lib/erp this WRITES to the ERP, and only when the student
 * presses the button. The session comes from the caller; nothing here touches the DB.
 */
import * as cheerio from 'cheerio';
import { erpPage, erpPostForm, isSessionExpiredError, ErpRateLimited, type AuthedSession } from './client';

export const FEEDBACK_ROUTE = 'feedback/feedbackstudentresultinfo/createstudentfeedback';
/** The answer every question gets. */
export const FEEDBACK_ANSWER = 'Good';

/** One faculty's form waiting on the "Submit" page. */
export interface PendingFeedback {
  code: string;
  title: string;
  /** L, T, P, S … */
  component: string;
  section: string;
  /** "2026-2027" */
  year: string;
  /** "Even Sem" */
  semester: string;
  faculty: string;
  href: string;
}

export interface FeedbackForm {
  action: string;
  /** Every field the browser would send, in order, with the answers left blank. */
  fields: [string, string][];
  questions: { text: string; field: string; options: { label: string; value: string }[] }[];
}

export interface FeedbackResult {
  code: string;
  title: string;
  component: string;
  section: string;
  faculty: string;
  questions: { text: string; answer: string }[];
  /**
   * submitted: posted now and found among the term's filed answers; already: filed before
   * this run (left alone); failed: the ERP refused, errored, or never recorded it.
   */
  status: 'submitted' | 'already' | 'failed';
  error?: string;
  /** Set when the answers shown are every answer on file for this course and faculty, not just this form's. */
  shared?: boolean;
}

export interface FeedbackRun {
  /** "2026-2027 · Even Sem", from the Submit page. */
  term: string;
  results: FeedbackResult[];
  answer: string;
  /** Set when a rate limit or a lapsed session stopped the run part-way. */
  stopped?: string;
}

const text = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** The pending forms on the ERP's Submit page (createstudentfeedback). */
export function parsePendingFeedback(html: string): PendingFeedback[] {
  const $ = cheerio.load(html);
  const out: PendingFeedback[] = [];
  $('table').each((_, t) => {
    const heads = $(t)
      .find('thead th')
      .toArray()
      .map((th) => text($(th).text()).toLowerCase());
    const at = (...words: string[]) => heads.findIndex((h) => words.every((w) => h.includes(w)));
    const iCode = at('course', 'code');
    const iClick = heads.length - 1;
    if (iCode < 0 || !$(t).find('a[href*="studentfeedback"]').length) return;
    const iTitle = at('course', 'desc');
    const iComp = at('component');
    const iSec = at('main', 'section');
    const iYear = at('academic', 'year');
    const iSem = at('semester');
    $(t)
      .find('tbody tr')
      .each((__, tr) => {
        const cells = $(tr).find('td').toArray();
        const cell = (i: number) => (i >= 0 && cells[i] ? text($(cells[i]).text()) : '');
        $(cells[iClick] ?? [])
          .find('a[href*="studentfeedback"]')
          .each((___, a) => {
            const href = $(a).attr('href');
            if (!href) return;
            out.push({
              code: cell(iCode),
              title: cell(iTitle),
              component: cell(iComp),
              section: cell(iSec),
              year: cell(iYear),
              semester: cell(iSem),
              faculty: text($(a).text()),
              href,
            });
          });
      });
  });
  return out;
}

/** One faculty's form: its fields in order and its questions with their options. */
export function parseFeedbackForm(html: string): FeedbackForm | null {
  const $ = cheerio.load(html);
  const form = $('form[action*="savestudentfeedback"]').first();
  if (!form.length) return null;
  const action = form.attr('action');
  if (!action) return null;
  const fields: [string, string][] = [];
  const groups = new Map<string, { label: string; value: string }[]>();
  form.find('input, select, textarea').each((_, el) => {
    const $el = $(el);
    const name = $el.attr('name');
    if (!name) return;
    const type = ($el.attr('type') ?? '').toLowerCase();
    if (type === 'radio') {
      const list = groups.get(name) ?? [];
      list.push({ label: text($el.parent('label').text()), value: $el.attr('value') ?? '' });
      groups.set(name, list);
      return;
    }
    if (type === 'checkbox' || type === 'submit' || type === 'button') return;
    fields.push([name, $el.attr('value') ?? '']);
  });

  // Each question's wording sits as loose text just before its questionnaire id field.
  const wording = new Map<string, string>();
  const re = /<\/div>\s*([^<]+?)\s*<div class="form-group field-feedbackstudentresultinfo-(\d+)-fsri_student_questionaire_info_id/g;
  for (const m of html.matchAll(re)) wording.set(m[2], text(cheerio.load(`<p>${m[1]}</p>`)('p').text()).replace(/^\d+\s*/, ''));

  const questions = [...groups].map(([field, options]) => {
    const idx = /\[(\d+)\]/.exec(field)?.[1] ?? '';
    return { text: wording.get(idx) ?? `Question ${Number(idx) + 1}`, field, options };
  });
  return questions.length ? { action, fields, questions } : null;
}

/** The fields to post with every question answered `answer` (by label; the ERP's third option otherwise). */
export function answeredFields(form: FeedbackForm, answer = FEEDBACK_ANSWER): { fields: [string, string][]; picked: { text: string; answer: string }[] } {
  const fields = [...form.fields];
  const picked: { text: string; answer: string }[] = [];
  for (const q of form.questions) {
    const want = answer.toLowerCase();
    const opt = q.options.find((o) => o.label.toLowerCase() === want) ?? q.options[2] ?? q.options[0];
    // A browser sends the blank hidden twin first, then the checked radio; PHP keeps the last.
    const at = fields.findIndex(([k]) => k === q.field);
    fields.splice(at < 0 ? fields.length : at + 1, 0, [q.field, opt.value]);
    picked.push({ text: q.text, answer: opt.label });
  }
  return { fields, picked };
}


/** One answer the ERP has on file (Feedback → the results list). */
export interface FiledAnswer {
  code: string;
  faculty: string;
  question: string;
  /** The option's number: 1 Excellent … 5 Unsatisfactory. */
  option: string;
}

const RESULTS_ROUTE = 'feedback/feedbackstudentresultinfo/indexindi';

/** Rows of the results list, and how many rows the list says it has in all. */
export function parseFiledAnswers(html: string): { rows: FiledAnswer[]; total: number | null } {
  const $ = cheerio.load(html);
  const rows: FiledAnswer[] = [];
  $('table').each((_, t) => {
    const heads = $(t)
      .find('thead tr')
      .first()
      .find('th')
      .toArray()
      .map((th) => text($(th).text()).toLowerCase());
    const at = (w: string) => heads.findIndex((h) => h.includes(w));
    const iQ = at('question');
    const iA = at('answer');
    const iC = at('course code');
    const iF = at('faculty');
    if (iQ < 0 || iA < 0 || iC < 0 || iF < 0) return;
    $(t)
      .find('tbody tr[data-key]')
      .each((__, tr) => {
        const c = $(tr).find('td').toArray().map((td) => text($(td).text()));
        rows.push({ code: c[iC] ?? '', faculty: c[iF] ?? '', question: c[iQ] ?? '', option: c[iA] ?? '' });
      });
  });
  const m = /Showing\s*<b>[^<]*<\/b>\s*of\s*<b>([\d,]+)<\/b>/i.exec(html);
  return { rows, total: m ? Number(m[1].replace(/,/g, '')) : null };
}

/** Every answer on file for one term (the results list filtered to it, all pages). */
async function filedAnswers(s: AuthedSession, year: string, semester: string): Promise<FiledAnswer[]> {
  const out: FiledAnswer[] = [];
  for (let page = 1; page <= 20; page++) {
    const q = new URLSearchParams({
      r: RESULTS_ROUTE,
      'FeedbackStudentResultInfoSearch[academicYear]': year,
      'FeedbackStudentResultInfoSearch[semester]': semester,
      'per-page': '50',
      page: String(page),
    });
    const res = await erpPage(s, `/index.php?${q.toString()}`);
    s.jar = res.jar;
    const { rows, total } = parseFiledAnswers(res.html);
    out.push(...rows);
    if (!rows.length || total == null || out.length >= total) break;
  }
  return out;
}

const norm = (s: string) => text(s).toLowerCase();
const pair = (code: string, faculty: string) => `${norm(code)}|${norm(faculty)}`;

/** What the ERP answers, instead of the form, for a form that was filed before. */
export const ALREADY_FILED = /feedback is already taken/i;

/** Validation errors the ERP printed back on the form, if it re-rendered it. */
function formErrors(html: string): string[] {
  const $ = cheerio.load(html);
  const errs = $('.has-error .help-block, .error-summary li')
    .toArray()
    .map((e) => text($(e).text()))
    .filter(Boolean);
  return [...new Set(errs)];
}

const OPTION_LABELS = ['', 'Excellent', 'Very good', 'Good', 'Satisfactory', 'Unsatisfactory'];

/** Forms opened and posted at once. Each is two requests; four keeps a run near 15 s without bursting the ERP. */
const PARALLEL = 4;

type Working = FeedbackResult & { form: FeedbackForm | null; posted: boolean };

/**
 * Answers every pending form with `answer` and posts it, a few at a time. The Submit
 * page keeps listing forms after they are filed; the ERP then answers "Feedback is
 * already taken…" instead of the form, and such forms are reported as already filed
 * with the answers it has on file. Afterwards the term's answers are read back and a
 * posted form counts as submitted only once each of its questions is there.
 *
 * A rate limit or a lapsed session stops the run: what was posted stays posted and the
 * run comes back with `stopped` set.
 */
export async function submitAllFeedback(session: AuthedSession, answer = FEEDBACK_ANSWER): Promise<FeedbackRun> {
  const s: AuthedSession = { ...session };
  const listPage = await erpPage(s, FEEDBACK_ROUTE);
  s.jar = listPage.jar;
  const pending = parsePendingFeedback(listPage.html);
  const year = pending[0]?.year ?? '';
  const semester = pending[0]?.semester ?? '';
  const term = [year, semester].filter(Boolean).join(' · ');
  if (!pending.length) return { term, results: [], answer };

  const results: Working[] = new Array(pending.length);
  let stopped: string | undefined;

  const one = async (p: PendingFeedback): Promise<Working> => {
    const base = { code: p.code, title: p.title, component: p.component, section: p.section, faculty: p.faculty };
    const fail = (error: string): Working => ({ ...base, questions: [], status: 'failed', error, form: null, posted: false });
    if (stopped) return fail('Not attempted: the run stopped first.');
    try {
      const page = await erpPage(s, p.href);
      if (ALREADY_FILED.test(page.html.slice(0, 2000))) return { ...base, questions: [], status: 'already', form: null, posted: false };
      const form = parseFeedbackForm(page.html);
      if (!form) return fail('The ERP did not show a feedback form for this faculty.');
      const { fields, picked } = answeredFields(form, answer);
      const res = await erpPostForm(s, form.action, fields, p.href);
      const errs = formErrors(res.html);
      if (errs.length) return { ...base, questions: picked, status: 'failed', error: errs.join(' '), form, posted: false };
      return { ...base, questions: picked, status: 'submitted', form, posted: true };
    } catch (e) {
      if (e instanceof ErpRateLimited || isSessionExpiredError(e)) {
        stopped ??= e instanceof ErpRateLimited ? 'The ERP started rate-limiting Attenly.' : 'The ERP ended the session part-way.';
        return fail(stopped);
      }
      return fail(e instanceof Error ? e.message : String(e));
    }
  };

  // A small pool; the session's cookie stays the same PHP session throughout.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, pending.length) }, async () => {
      while (next < pending.length) {
        const i = next++;
        results[i] = await one(pending[i]);
      }
    }),
  );

  // Read the term's answers back: confirms what was posted, and shows what earlier runs filed.
  try {
    const filed = await filedAnswers(s, year, semester);
    const by = new Map<string, FiledAnswer[]>();
    for (const r of filed) by.set(pair(r.code, r.faculty), [...(by.get(pair(r.code, r.faculty)) ?? []), r]);
    for (const r of results) {
      const rows = by.get(pair(r.code, r.faculty)) ?? [];
      if (r.status === 'already') {
        // One faculty can hold several forms of a course (L, P, S); the ERP's list doesn't
        // say which form an answer came from, so each shows the course-and-faculty answers.
        const seen = new Set<string>();
        r.questions = rows
          .filter((x) => !seen.has(norm(x.question)) && seen.add(norm(x.question)))
          .reverse()
          .map((x) => ({ text: x.question, answer: OPTION_LABELS[Number(x.option)] || x.option }));
        if (results.filter((o) => pair(o.code, o.faculty) === pair(r.code, r.faculty)).length > 1) r.shared = true;
      } else if (r.posted && r.form) {
        const have = new Set(rows.map((x) => norm(x.question)));
        const missing = r.form.questions.filter((q) => !have.has(norm(q.text)));
        if (missing.length) {
          r.status = 'failed';
          r.error = `Attenly posted this form but the ERP has no record of ${missing.length} of its answers.`;
        }
      }
    }
  } catch (e) {
    if (results.some((r) => r.posted)) {
      stopped ??= `Posted, but Attenly couldn’t read the ERP back to confirm (${e instanceof Error ? e.message : e}).`;
    }
  }

  return {
    term,
    answer,
    ...(stopped ? { stopped } : {}),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    results: results.map(({ form, posted, ...r }) => r),
  };
}
