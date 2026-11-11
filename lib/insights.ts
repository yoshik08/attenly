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

function cleanTitle(title: string, code: string): string {
  const t = (title || '').split('|')[0].replace(/\s+/g, ' ').trim();
  return t && t !== code ? t : code;
}

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

/** Reads after "Next class": "today at 14:30", "tomorrow at 09:50", "on Fri, period 3". */
export function whenLabel(n: NextClass): string {
  const day = n.inDays === 0 ? 'today' : n.inDays === 1 ? 'tomorrow' : `on ${n.day}`;
  return n.period.start ? `${day} at ${n.period.start}` : `${day}, ${n.period.period.replace(/^P/, 'period ')}`;
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

