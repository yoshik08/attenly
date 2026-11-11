/**
 * Attendance engine — weighted LTPS (Lecture / Tutorial / Practical /
 * Skilling), the way the KL University ERP computes it:
 *
 *   course % = ceil( Σ(attended_k × w_k) / Σ(conducted_k × w_k) × 100 )
 *
 * Weights L 100, T 100, P 50, S 25. The college's bands (85 safe, 75
 * condonation, 65 medical, below that detained) are fixed; one global target
 * (75 or 85) picks the line every budget is measured against. Every budget
 * below is derived by stepping the same rounded figure the app displays, so
 * "2 to spare" always agrees with the percentage.
 */

export type ComponentKey = 'L' | 'T' | 'P' | 'S';

export interface ComponentCounts {
  conducted: number;
  attended: number;
}

export type ComponentMap = Record<ComponentKey, ComponentCounts>;

export interface SubjectAttendance {
  code: string;
  title: string;
  components: ComponentMap;
}

export type Weights = Record<ComponentKey, number>;

/** Classes held before registration, per component (the ERP's TCBR). */
export type TcbrMap = Partial<Record<ComponentKey, number>>;

export interface TcbrSettings {
  enabled: boolean;
  /** course code -> classes held before you registered */
  perCourse: Record<string, number>;
}

export const COMPONENT_ORDER: ComponentKey[] = ['L', 'T', 'P', 'S'];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  L: 'Lecture',
  T: 'Tutorial',
  P: 'Practical',
  S: 'Skilling',
};

export const COMPONENT_PLURAL: Record<ComponentKey, string> = {
  L: 'lectures',
  T: 'tutorials',
  P: 'practicals',
  S: 'skilling sessions',
};

export const COMPONENT_SINGULAR: Record<ComponentKey, string> = {
  L: 'lecture',
  T: 'tutorial',
  P: 'practical',
  S: 'skilling session',
};

export const DEFAULT_WEIGHTS: Weights = { L: 100, T: 100, P: 50, S: 25 };
/**
 * The one global target attendance. Everything that says how many classes you
 * can miss, must attend, or would land on aims at this figure: badges, rings,
 * verdicts, the calculator, Plan the day and Forecast. The bands themselves are
 * the college's (STATUS_AT) and do not move.
 */
export type Target = 75 | 85;
export const TARGETS: Target[] = [75, 85];
export const DEFAULT_TARGET: Target = 85;
export const DEFAULT_TCBR: TcbrSettings = { enabled: false, perCourse: {} };

/** Budgets stop counting here; anything beyond reads as "plenty". */
export const BUDGET_CAP = 999;

/**
 * ceil(num / den × 100) without floating-point drift: 7/100 is 7%, not 8%.
 * The small epsilon absorbs representation error from fractional weights.
 */
export function ceilPct(num: number, den: number): number {
  const v = Math.ceil((num * 100) / den - 1e-9);
  return v === 0 ? 0 : v; // never -0
}

function tcbrOf(tcbr: TcbrMap | undefined, k: ComponentKey): number {
  return Math.max(0, Math.floor(tcbr?.[k] ?? 0));
}

/** Effective conducted count for a component (TCBR removed); ≤ 0 means not applicable. */
export function effectiveConducted(subj: SubjectAttendance, k: ComponentKey, tcbr?: TcbrMap): number {
  return (subj.components[k]?.conducted ?? 0) - tcbrOf(tcbr, k);
}

/** Per-component plan: upcoming classes you attend vs. skip. */
export type SandboxPlan = Record<ComponentKey, { attend: number; skip: number }>;

export function emptyPlan(): SandboxPlan {
  return { L: { attend: 0, skip: 0 }, T: { attend: 0, skip: 0 }, P: { attend: 0, skip: 0 }, S: { attend: 0, skip: 0 } };
}

export function weightedSums(
  subj: SubjectAttendance,
  weights: Weights,
  tcbr?: TcbrMap,
  plan?: SandboxPlan,
): { attW: number; condW: number } {
  let attW = 0;
  let condW = 0;
  for (const k of COMPONENT_ORDER) {
    const c = subj.components[k] ?? { conducted: 0, attended: 0 };
    const w = weights[k] ?? 0;
    const eff = c.conducted - tcbrOf(tcbr, k);
    if (eff <= 0) continue; // TCBR'd out or never held: not applicable
    const attend = Math.max(0, plan?.[k].attend ?? 0);
    const skip = Math.max(0, plan?.[k].skip ?? 0);
    attW += (c.attended + attend) * w;
    condW += (eff + attend + skip) * w;
  }
  return { attW, condW };
}

/** Weighted course %, rounded up like the ERP. Null when nothing counts yet. */
export function weightedPct(subj: SubjectAttendance, weights: Weights, tcbr?: TcbrMap): number | null {
  const { attW, condW } = weightedSums(subj, weights, tcbr);
  return condW > 0 ? ceilPct(attW, condW) : null;
}

/** Projected % after a what-if plan (attending adds to both counts, skipping only to conducted). */
export function sandboxPct(subj: SubjectAttendance, weights: Weights, plan: SandboxPlan, tcbr?: TcbrMap): number | null {
  const { attW, condW } = weightedSums(subj, weights, tcbr, plan);
  return condW > 0 ? ceilPct(attW, condW) : null;
}

/** Overall weighted % across courses. */
export function overallPct(
  subjects: SubjectAttendance[],
  weights: Weights,
  tcbrFor: (code: string) => TcbrMap | undefined,
): number | null {
  let attW = 0;
  let condW = 0;
  for (const s of subjects) {
    const p = weightedSums(s, weights, tcbrFor(s.code));
    attW += p.attW;
    condW += p.condW;
  }
  return condW > 0 ? ceilPct(attW, condW) : null;
}

/** Resolve a course's TCBR from settings (undefined when off or zero). */
export function courseTcbr(code: string, tcbr: TcbrSettings): TcbrMap | undefined {
  if (!tcbr.enabled) return undefined;
  const v = Math.max(0, Math.floor(tcbr.perCourse[code] ?? 0));
  if (v <= 0) return undefined;
  return { L: v, T: v, P: v, S: v };
}

export interface Budget {
  /** Classes of this type you can miss in a row and still show ≥ target. */
  spare: number;
  /** Classes of this type you must attend in a row to show ≥ target (Infinity: not reachable). */
  needed: number;
}

/**
 * Skip/attend budget for one component, with every other component held
 * where it is. Null when the component doesn't apply to the course.
 */
export function componentBudget(
  subj: SubjectAttendance,
  weights: Weights,
  target: number,
  k: ComponentKey,
  tcbr?: TcbrMap,
): Budget | null {
  if (effectiveConducted(subj, k, tcbr) <= 0) return null;
  const current = weightedPct(subj, weights, tcbr);
  if (current == null) return null;
  const w = weights[k] ?? 0;
  if (w <= 0) {
    return { spare: current >= target ? Number.POSITIVE_INFINITY : 0, needed: current >= target ? 0 : Number.POSITIVE_INFINITY };
  }
  const plan = emptyPlan();
  if (current >= target) {
    let spare = 0;
    while (spare < BUDGET_CAP) {
      plan[k].skip = spare + 1;
      const p = sandboxPct(subj, weights, plan, tcbr);
      if (p == null || p < target) break;
      spare++;
    }
    return { spare, needed: 0 };
  }
  for (let n = 1; n <= BUDGET_CAP; n++) {
    plan[k].attend = n;
    const p = sandboxPct(subj, weights, plan, tcbr);
    if (p != null && p >= target) return { spare: 0, needed: n };
  }
  return { spare: 0, needed: Number.POSITIVE_INFINITY };
}

/* ------------------------------------------------------------------ */
/* Plain attended / total maths (the calculator)                        */
/* ------------------------------------------------------------------ */

export interface SimpleResult {
  /** The figure the ERP would show (rounded up). */
  shown: number;
  /** Before rounding, two decimals. */
  exact: number;
  spare: number;
  needed: number;
}

/** attended / total with the ERP's rounding, plus the skip and catch-up budget against `target`. */
export function simpleAttendance(attended: number, total: number, target: number): SimpleResult | null {
  if (!Number.isFinite(attended) || !Number.isFinite(total)) return null;
  if (total <= 0 || attended < 0 || attended > total) return null;
  const a = Math.floor(attended);
  const t = Math.floor(total);
  if (a !== attended || t !== total) return null;
  const shown = ceilPct(a, t);
  const exact = Math.round((a / t) * 10000) / 100;
  let spare = 0;
  let needed = 0;
  if (shown >= target) {
    while (spare < BUDGET_CAP * 10 && ceilPct(a, t + spare + 1) >= target) spare++;
  } else {
    needed = Number.POSITIVE_INFINITY;
    for (let n = 1; n <= BUDGET_CAP * 10; n++) {
      if (ceilPct(a + n, t + n) >= target) {
        needed = n;
        break;
      }
    }
  }
  return { shown, exact, spare, needed };
}

/* ------------------------------------------------------------------ */
/* Bands and formatting                                                */
/* ------------------------------------------------------------------ */

export type Status = 'safe' | 'condonation' | 'medical' | 'detained';

/**
 * The college's examination-eligibility bands. They are policy, not
 * preference, so they are fixed: the single global target in Settings only
 * decides which line the budgets, plans and forecasts aim at.
 */
export const STATUS_AT = { safe: 85, condonation: 75, medical: 65 } as const;

export function statusOf(pct: number | null): Status | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= STATUS_AT.safe) return 'safe';
  if (pct >= STATUS_AT.condonation) return 'condonation';
  if (pct >= STATUS_AT.medical) return 'medical';
  return 'detained';
}

export const STATUS_LABEL: Record<Status, string> = {
  safe: 'SAFE',
  condonation: 'CONDONATION',
  medical: 'MEDICAL CERT + CONDONATION',
  detained: 'DETAINED',
};

/** Format a percentage; null renders as an em dash. */
export function fmtPct(pct: number | null): string {
  return pct == null ? '—' : `${Math.round(pct)}%`;
}

/** "1 lecture" / "3 lectures". */
export function countOf(n: number, k: ComponentKey): string {
  return `${n} ${n === 1 ? COMPONENT_SINGULAR[k] : COMPONENT_PLURAL[k]}`;
}
