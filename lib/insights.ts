/**
 * Pure derivations for the UI: per-course summaries, the single most urgent
 * verdict, a course's next class, and what changed since the last look.
 */
import {
  COMPONENT_LABELS,
  COMPONENT_ORDER,
  componentBudget,
  countOf,
  courseTcbr,
  effectiveConducted,
  policyBand,
  weightedPct,
  type Band,
  type Budget,
  type ComponentKey,
  type SubjectAttendance,
  type TcbrSettings,
  type Thresholds,
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
  /** Against the cruise line (85). */
  cruise: Budget | null;
  /** Against the floor (75). */
  floor: Budget | null;
}

export interface CourseSummary {
  code: string;
  title: string;
  pct: number | null;
  band: Band;
  components: ComponentSummary[];
  /** One plain sentence: what to do next for this course. */
  verdict: string;
  /** Lower = needs attention sooner. */
  urgency: number;
}

function cleanTitle(title: string, code: string): string {
  const t = (title || '').split('|')[0].replace(/\s+/g, ' ').trim();
  return t && t !== code ? t : code;
}

/** The single best move toward `target`: fewest classes of one type. */
function bestCatchUp(comps: ComponentSummary[], pick: (c: ComponentSummary) => Budget | null) {
  let best: { k: ComponentKey; n: number } | null = null;
  for (const c of comps) {
    const b = pick(c);
    if (!b || !Number.isFinite(b.needed) || b.needed <= 0) continue;
    if (!best || b.needed < best.n) best = { k: c.k, n: b.needed };
  }
  return best;
}

/** The type you can skip most of, and how many. */
function bestSpare(comps: ComponentSummary[]) {
  let best: { k: ComponentKey; n: number } | null = null;
  for (const c of comps) {
    const n = c.cruise?.spare ?? 0;
    if (!best || n > best.n) best = { k: c.k, n };
  }
  return best;
}

export function summarize(
  subj: SubjectAttendance,
  settings: { thresholds: Thresholds; weights: Weights; tcbr: TcbrSettings },
): CourseSummary {
  const { thresholds, weights } = settings;
  const tcbr = courseTcbr(subj.code, settings.tcbr);
  const pct = weightedPct(subj, weights, tcbr);
  const band = policyBand(pct, thresholds);
  const components: ComponentSummary[] = [];
  for (const k of COMPONENT_ORDER) {
    const c = subj.components[k];
    if (!c || c.conducted <= 0) continue;
    const effective = effectiveConducted(subj, k, tcbr);
    components.push({
      k,
      label: COMPONENT_LABELS[k],
      conducted: c.conducted,
      attended: c.attended,
      effective,
      cruise: componentBudget(subj, weights, thresholds.safeAt, k, tcbr),
      floor: componentBudget(subj, weights, thresholds.condonationFrom, k, tcbr),
    });
  }

  let verdict: string;
  let urgency: number;
  const title = cleanTitle(subj.title, subj.code);
  if (pct == null) {
    verdict = 'No classes counted yet.';
    urgency = 1000;
  } else if (band === 'cruising') {
    const s = bestSpare(components);
    if (!s || s.n <= 0) {
      verdict = `Right on the ${thresholds.safeAt}% line. Skipping any class drops you below it.`;
      urgency = 300;
    } else {
      const others = components
        .filter((c) => c.k !== s.k && (c.cruise?.spare ?? 0) > 0)
        .map((c) => countOf(c.cruise!.spare, c.k));
      verdict = `${countOf(s.n, s.k)} to spare${others.length ? `, or ${others.join(', or ')}` : ''}.`;
      urgency = 300 + Math.min(s.n, 99);
    }
  } else {
    const up = bestCatchUp(components, (c) => c.cruise);
    const floorUp = bestCatchUp(components, (c) => c.floor);
    if (band === 'thin-ice') {
      verdict = up
        ? `Attend the next ${countOf(up.n, up.k)} to reach ${thresholds.safeAt}%.`
        : `${thresholds.safeAt}% is out of reach this term; stay above ${thresholds.condonationFrom}%.`;
      urgency = 200 - (thresholds.safeAt - pct);
    } else {
      verdict = floorUp
        ? `Attend the next ${countOf(floorUp.n, floorUp.k)} to climb back above ${thresholds.condonationFrom}%.`
        : `Below ${thresholds.condonationFrom}% with no way back on one class type. Talk to your faculty advisor.`;
      urgency = 100 - (thresholds.condonationFrom - pct);
    }
  }
  return { code: subj.code, title, pct, band, components, verdict, urgency };
}

export interface Plate {
  code: string | null;
  sentence: string;
  tone: Band;
}

/** The one sentence the attendance screen leads with. */
export function plateFor(courses: CourseSummary[], thresholds: Thresholds): Plate | null {
  const counted = courses.filter((c) => c.pct != null);
  if (counted.length === 0) return null;
  const worst = [...counted].sort((a, b) => a.urgency - b.urgency)[0];
  if (worst.band === 'in-the-red') {
    return { code: worst.code, tone: worst.band, sentence: `${worst.title} is at ${worst.pct}%, below the ${thresholds.condonationFrom}% floor. ${worst.verdict}` };
  }
  if (worst.band === 'thin-ice') {
    return { code: worst.code, tone: worst.band, sentence: `${worst.title} is on thin ice at ${worst.pct}%. ${worst.verdict}` };
  }
  const allAbove = `Every course is at or above ${thresholds.safeAt}%.`;
  const s = bestSpare(worst.components);
  if (!s || s.n <= 0) {
    return { code: worst.code, tone: worst.band, sentence: `${allAbove} ${worst.title} has no class to spare.` };
  }
  return { code: worst.code, tone: worst.band, sentence: `${allAbove} Tightest is ${worst.title}: ${countOf(s.n, s.k)} to spare.` };
}

/* ------------------------------------------------------------------ */
/* Timetable                                                           */
/* ------------------------------------------------------------------ */

export const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Minutes since midnight for "9:00" / "09:00" / "14:30"; null when unknown. */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  // KLU timetables often print afternoon periods on a 12-hour clock (1:00 = 13:00).
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
