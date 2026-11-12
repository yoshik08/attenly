/**
 * Pure derivations for the UI: per-course summaries, a course's next class,
 * and what changed since the last look.
 */
import {
  COMPONENT_LABELS,
  COMPONENT_ORDER,
  componentBudget,
  countOf,
  courseTcbr,
  effectiveConducted,
  emptyPlan,
  sandboxPct,
  statusOf,
  weightedPct,
  type Budget,
  type ComponentKey,
  type Status,
  type SubjectAttendance,
  type Target,
  type TcbrSettings,
  type Weights,
} from './math';
import type { TimetableDay, TimetablePeriod } from './erp/parsers';

export interface ComponentSummary {
  k: ComponentKey;
  label: string;
  conducted: number;
  attended: number;
  /** Conducted minus pre-registration classes (what the % uses). */
  effective: number;
  /** Against the global target. */
  budget: Budget | null;
}

export interface CourseSummary {
  code: string;
  title: string;
  pct: number | null;
  /** The college's band for this figure (fixed cut-offs). */
  status: Status | null;
  components: ComponentSummary[];
  /** One plain sentence: what to do next for this course. */
  verdict: string;
  /** Lower = needs attention sooner. */
  urgency: number;
}

export interface SummarySettings {
  target: Target;
  weights: Weights;
  tcbr: TcbrSettings;
}

/** Short words that stay lower case inside a title. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'via', 'with']);
/** Letters that stay capitals when a shouted title is calmed down. */
const ACRONYMS = new Set([
  'AI', 'ML', 'DL', 'NLP', 'IOT', 'IT', 'UI', 'UX', 'OOP', 'OOPS', 'DBMS', 'RDBMS', 'OS', 'CN', 'API', 'APIS', 'AR', 'VR', 'XR',
  'CSE', 'ECE', 'EEE', 'ECM', 'SQL', 'NOSQL', 'GIS', 'AWS', 'GPU', 'CPU', 'DSA', 'HTML', 'CSS', 'JS', 'PHP', 'IDE', 'SDLC',
  'VLSI', 'PCB', 'DSP', 'MEMS', 'CAD', 'CAM', 'R&D', 'KL', 'KLU', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
]);

/** One piece of a word ("DEVELOPMENT", "II", "(IOT)"). */
function titlePart(part: string, first: boolean): string {
  const bare = part.replace(/^[^A-Za-z0-9&+#]+|[^A-Za-z0-9&+#]+$/g, '');
  if (!bare) return part;
  const upper = bare.toUpperCase();
  if (ACRONYMS.has(upper) || /\d/.test(bare) || /[+#]/.test(bare)) return part.replace(bare, upper === 'IOT' ? 'IoT' : upper);
  if (!first && SMALL_WORDS.has(bare.toLowerCase())) return part.toLowerCase();
  return part.toLowerCase().replace(/^([^a-z]*)([a-z])/, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

/** A word, hyphenated or slashed parts each on their own ("DEVELOPMENT-II" → "Development-II"). */
function titleWord(word: string, first: boolean): string {
  return word
    .split(/([-/])/)
    .map((part, i) => (part === '-' || part === '/' ? part : titlePart(part, first && i === 0)))
    .join('');
}

/**
 * The ERP shouts most course names ("GENERATIVE AI AND AI PLATFORMS"). A title
 * with no lower-case letters is set in title case, keeping acronyms and roman
 * numerals; a title that already has mixed case is left as written.
 */
export function courseTitle(title: string | null | undefined, code: string): string {
  const t = (title || '').split('|')[0].replace(/\s+/g, ' ').trim();
  if (!t || t === code) return code;
  if (/[a-z]/.test(t) || !/[A-Z]{3}/.test(t)) return t;
  return t
    .split(' ')
    .map((w, i) => titleWord(w, i === 0))
    .join(' ');
}

const cleanTitle = courseTitle;

/** The single best move toward the target: fewest classes of one type. */
function bestCatchUp(comps: ComponentSummary[], key: 'needed' | 'spare') {
  let best: { k: ComponentKey; n: number } | null = null;
  for (const c of comps) {
    const n = c.budget?.[key] ?? 0;
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!best || n < best.n) best = { k: c.k, n };
  }
  return best;
}

/** The type you can skip most of, and how many. */
function bestSpare(comps: ComponentSummary[]) {
  let best: { k: ComponentKey; n: number } | null = null;
  for (const c of comps) {
    const n = c.budget?.spare ?? 0;
    if (!best || n > best.n) best = { k: c.k, n };
  }
  return best;
}

export function summarize(subj: SubjectAttendance, settings: SummarySettings): CourseSummary {
  const { target, weights } = settings;
  const tcbr = courseTcbr(subj.code, settings.tcbr);
  const pct = weightedPct(subj, weights, tcbr);
  const status = statusOf(pct);
  const components: ComponentSummary[] = [];
  for (const k of COMPONENT_ORDER) {
    const c = subj.components[k];
    if (!c || c.conducted <= 0) continue;
    components.push({
      k,
      label: COMPONENT_LABELS[k],
      conducted: c.conducted,
      attended: c.attended,
      effective: effectiveConducted(subj, k, tcbr),
      budget: componentBudget(subj, weights, target, k, tcbr),
    });
  }

  let verdict: string;
  let urgency: number;
  if (pct == null || status == null) {
    verdict = 'No classes counted yet.';
    urgency = 1000;
  } else if (pct >= target) {
    const spare = bestSpare(components);
    if (pct === target) {
      verdict = `Right on the ${target}% line. Skipping any class drops you below it.`;
      urgency = 300;
    } else if (!spare || spare.n <= 0) {
      verdict = `Holding ${target}%: there is no room to skip a class yet.`;
      urgency = 320;
    } else {
      verdict = `${countOf(spare.n, spare.k)} to spare.`;
      urgency = 400 + (100 - pct) * 2;
    }
  } else {
    const up = bestCatchUp(components, 'needed');
    // Below the condonation line the message names the band, not the target.
    const line = pct < 75 ? 75 : target;
    if (up) {
      verdict =
        line === target
          ? `Attend the next ${countOf(up.n, up.k)} to reach ${target}%.`
          : `Attend the next ${countOf(up.n, up.k)} to climb back above ${line}%.`;
    } else {
      verdict = `${target}% is out of reach this term; stay above ${line}%.`;
    }
    urgency = pct < 75 ? 100 - (75 - pct) : 200 - (target - pct);
  }

  return {
    code: subj.code,
    title: cleanTitle(subj.title, subj.code),
    pct,
    status,
    components,
    verdict,
    urgency,
  };
}

/* ------------------------------------------------------------------ */
/* The timetable: days, periods and the next class                     */
/* ------------------------------------------------------------------ */

export const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "9:50" → 590. KLU prints afternoon periods on a 12-hour clock (1:00 = 13:00). */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h >= 1 && h <= 6) h += 12;
  return h * 60 + min;
}

export function periodOrder(p: TimetablePeriod): number {
  const n = parseInt(p.period.replace(/\D/g, ''), 10);
  return Number.isNaN(n) ? 999 : n;
}

export function sortPeriods(periods: TimetablePeriod[]): TimetablePeriod[] {
  return [...periods].sort(
    (a, b) => periodOrder(a) - periodOrder(b) || (minutesOf(a.start) ?? 0) - (minutesOf(b.start) ?? 0),
  );
}

export interface NextClass {
  period: TimetablePeriod;
  day: string;
  /** 0 = today, 1 = tomorrow, … */
  inDays: number;
}

/** The next scheduled class of a course, from `now`. Today's classes count only if their start time is known and ahead. */
export function nextClassOf(code: string, timetable: TimetableDay[], now = new Date()): NextClass | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 7; offset++) {
    const day = WEEK[(now.getDay() + offset) % 7];
    const periods = sortPeriods(timetable.find((d) => d.day === day)?.periods ?? []).filter((p) => p.subjectCode === code);
    for (const p of periods) {
      if (offset === 0) {
        const start = minutesOf(p.start);
        if (start == null || start <= nowMin) continue;
      }
      return { period: p, day, inDays: offset };
    }
  }
  return null;
}

/** Reads after "Next class": "today at 2:30 pm", "tomorrow at 9:50 am", "on Fri, period 3". */
export function whenLabel(n: NextClass): string {
  const day = n.inDays === 0 ? 'today' : n.inDays === 1 ? 'tomorrow' : `on ${n.day}`;
  return n.period.start ? `${day} at ${clockOf(n.period.start)}` : `${day}, ${n.period.period.replace(/^P/, 'period ')}`;
}

/** "9:50" → "9:50 am", "1:40" → "1:40 pm". KLU prints afternoons on a 12-hour clock without am/pm. */
export function clockOf(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const m = minutesOf(hhmm);
  if (m == null) return hhmm;
  const h24 = Math.floor(m / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** The first day (from today) that still has classes ahead, with those classes in order. */
export interface Agenda {
  /** 0 = today, 1 = tomorrow, … */
  inDays: number;
  day: string;
  date: Date;
  periods: TimetablePeriod[];
}

/** When the ERP prints no clock times, today's classes count as still ahead until this time. */
export const UNTIMED_DAY_ENDS = 17 * 60;

export function agendaOf(timetable: TimetableDay[], now = new Date()): Agenda | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 7; offset++) {
    const day = WEEK[(now.getDay() + offset) % 7];
    let periods = sortPeriods(timetable.find((d) => d.day === day)?.periods ?? []);
    if (offset === 0) {
      periods = periods.filter((p) => {
        const start = minutesOf(p.start);
        // No time printed (the ERP often gives only "Period 1"): assume the day runs until late afternoon.
        if (start == null) return nowMin < UNTIMED_DAY_ENDS;
        return start > nowMin;
      });
    }
    if (periods.length > 0) {
      return { inDays: offset, day, date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset), periods };
    }
  }
  return null;
}

/** What missing one class of a course would do, with every other class attended. */
export interface SkipCall {
  now: number | null;
  /** The course's figure if this class is missed. */
  after: number | null;
  /** Missing it keeps the course at or above the target. */
  skippable: boolean;
  /** Under the target already: classes of this type to attend in a row to reach it (Infinity: out of reach). */
  needed: number | null;
}

export function skipCall(subj: SubjectAttendance, settings: SummarySettings, k: ComponentKey): SkipCall {
  const tcbr = courseTcbr(subj.code, settings.tcbr);
  const now = weightedPct(subj, settings.weights, tcbr);
  const plan = emptyPlan();
  plan[k].skip = 1;
  const after = sandboxPct(subj, settings.weights, plan, tcbr);
  const skippable = after != null && after >= settings.target;
  let needed: number | null = null;
  if (now != null && now < settings.target) {
    needed = componentBudget(subj, settings.weights, settings.target, k, tcbr)?.needed ?? null;
  }
  return { now, after, skippable, needed };
}

/* ------------------------------------------------------------------ */
/* What changed since the last look                                    */
/* ------------------------------------------------------------------ */

/** code -> component -> [attended, conducted] */
export type SeenCounts = Record<string, Partial<Record<ComponentKey, [number, number]>>>;

export function countsOf(subjects: SubjectAttendance[]): SeenCounts {
  const out: SeenCounts = {};
  for (const s of subjects) {
    const row: Partial<Record<ComponentKey, [number, number]>> = {};
    for (const k of COMPONENT_ORDER) {
      const c = s.components[k];
      if (c && c.conducted > 0) row[k] = [c.attended, c.conducted];
    }
    out[s.code] = row;
  }
  return out;
}

export interface CourseDelta {
  k: ComponentKey;
  attended: number;
  missed: number;
}

/** Classes added since `seen` for one course (empty when nothing changed or nothing was seen). */
export function deltaOf(subj: SubjectAttendance, seen: SeenCounts | null): CourseDelta[] {
  const before = seen?.[subj.code];
  if (!seen || !before) return [];
  const out: CourseDelta[] = [];
  for (const k of COMPONENT_ORDER) {
    const c = subj.components[k];
    if (!c) continue;
    const [att0, cond0] = before[k] ?? [0, 0];
    const dCond = c.conducted - cond0;
    const dAtt = c.attended - att0;
    if (dCond <= 0 && dAtt <= 0) continue;
    out.push({ k, attended: Math.max(0, dAtt), missed: Math.max(0, dCond - Math.max(0, dAtt)) });
  }
  return out;
}

