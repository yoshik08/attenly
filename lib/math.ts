/**
 * Aurora Ink attendance engine.
 *
 * Weighted LTPS (Lecture / Tutorial / Practical / Skilling) math that mirrors
 * the KL University NewERP style of percentage calculation:
 *
 *   overall % = Math.ceil( Σ(attended_i × w_i) / Σ(conducted_i × w_i) × 100 )
 *
 * Component weights: L = 100, T = 100, P = 50, S = 25.
 * The university's hard detention floor is 75%.
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

/** Per-component TCBR overrides (classes held before registration). */
export type TcbrMap = Partial<Record<ComponentKey, number>>;

export interface Thresholds {
  /** e.g. 85 — at or above this you're cruising */
  safeAt: number;
  /** e.g. 75 — at or above this (but below safeAt) you're on thin ice */
  condonationFrom: number;
}

export interface TcbrSettings {
  enabled: boolean;
  /** course code -> TCBR count, applied to every component's conducted total */
  perCourse: Record<string, number>;
}

export const COMPONENT_ORDER: ComponentKey[] = ['L', 'T', 'P', 'S'];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  L: 'Lecture',
  T: 'Tutorial',
  P: 'Practical',
  S: 'Skilling',
};

export const COMPONENT_SHORT: Record<ComponentKey, string> = {
  L: 'Lec',
  T: 'Tut',
  P: 'Lab',
  S: 'Skill',
};

export const DEFAULT_WEIGHTS: Weights = { L: 100, T: 100, P: 50, S: 25 };
export const DEFAULT_THRESHOLDS: Thresholds = { safeAt: 85, condonationFrom: 75 };
export const DEFAULT_TCBR: TcbrSettings = { enabled: false, perCourse: {} };
/** The university's hard detention floor. */
export const DETENTION_FLOOR = 75;

interface WeightedSums {
  attW: number;
  condW: number;
  /** total number of conducted sessions (unweighted) */
  count: number;
}

function tcbrOf(tcbr: TcbrMap | undefined, k: ComponentKey): number {
  return Math.max(0, Math.floor(tcbr?.[k] ?? 0));
}

export function weightedSums(
  subj: SubjectAttendance,
  weights: Weights,
  tcbr?: TcbrMap,
): WeightedSums {
  let attW = 0;
  let condW = 0;
  let count = 0;
  for (const k of COMPONENT_ORDER) {
    const c = subj.components[k] ?? { conducted: 0, attended: 0 };
    const w = weights[k] ?? 0;
    const effConducted = c.conducted - tcbrOf(tcbr, k);
    if (effConducted <= 0) continue; // TCBR'd out — component is N/A
    attW += c.attended * w;
    condW += effConducted * w;
    count += effConducted;
  }
  return { attW, condW, count };
}

/** Weighted attendance %, ceiled like the ERP. Null when nothing counts yet. */
export function weightedPct(
  subj: SubjectAttendance,
  weights: Weights,
  tcbr?: TcbrMap,
): number | null {
  const { attW, condW } = weightedSums(subj, weights, tcbr);
  if (condW <= 0) return null;
  return Math.ceil((attW / condW) * 100);
}

/** Per-component effective %, mirroring the ERP's TCBR adjustment. Null = N/A. */
export function tcbrPct(c: ComponentCounts, tcbr: number): number | null {
  const denom = c.conducted - tcbr;
  if (denom <= 0) return null;
  return Math.ceil((c.attended / denom) * 100);
}

/** Resolve the TCBR map for a course from settings (undefined = feature off). */
export function courseTcbr(code: string, tcbr: TcbrSettings): TcbrMap | undefined {
  if (!tcbr.enabled) return undefined;
  const v = Math.max(0, Math.floor(tcbr.perCourse[code] ?? 0));
  if (v <= 0) return undefined;
  return { L: v, T: v, P: v, S: v };
}

/* ------------------------------------------------------------------ */
/* What-if lab (sandbox simulation)                                    */
/* ------------------------------------------------------------------ */

/** Per-component plan: how many upcoming classes you attend vs. bunk. */
export type SandboxPlan = Record<ComponentKey, { attend: number; skip: number }>;

export function emptyPlan(): SandboxPlan {
  return {
    L: { attend: 0, skip: 0 },
    T: { attend: 0, skip: 0 },
    P: { attend: 0, skip: 0 },
    S: { attend: 0, skip: 0 },
  };
}

/**
 * Projected % after applying a what-if plan.
 * Attending a class: conducted + 1 AND attended + 1.
 * Bunking a class: conducted + 1 only.
 */
export function sandboxPct(
  subj: SubjectAttendance,
  weights: Weights,
  plan: SandboxPlan,
  tcbr?: TcbrMap,
): number | null {
  let attW = 0;
  let condW = 0;
  for (const k of COMPONENT_ORDER) {
    const c = subj.components[k] ?? { conducted: 0, attended: 0 };
    const w = weights[k] ?? 0;
    const effConducted = c.conducted - tcbrOf(tcbr, k);
    if (effConducted <= 0) continue;
    const p = plan[k] ?? { attend: 0, skip: 0 };
    const attend = Math.max(0, p.attend);
    const skip = Math.max(0, p.skip);
    attW += (c.attended + attend) * w;
    condW += (effConducted + attend + skip) * w;
  }
  if (condW <= 0) return null;
  return Math.ceil((attW / condW) * 100);
}

/**
 * Impact of a single upcoming class of the given component:
 * `gain` = points added by showing up, `loss` = points lost by bunking.
 */
export function classImpact(
  subj: SubjectAttendance,
  weights: Weights,
  type: ComponentKey,
  tcbr?: TcbrMap,
): { gain: number; loss: number } {
  const cur = weightedPct(subj, weights, tcbr);
  const w = weights[type] ?? 0;
  const { attW, condW } = weightedSums(subj, weights, tcbr);
  if (cur == null || condW <= 0 || w <= 0) return { gain: 0, loss: 0 };
  const ifAttended = Math.ceil(((attW + w) / (condW + w)) * 100);
  const ifMissed = Math.ceil((attW / (condW + w)) * 100);
  return { gain: ifAttended - cur, loss: cur - ifMissed };
}

/* ------------------------------------------------------------------ */
/* Bunk balance (per-component skip margin) & catch-up (needed)        */
/* ------------------------------------------------------------------ */

interface SplitSums {
  /** other components' weighted conducted / attended */
  otherCondW: number;
  otherAttW: number;
  /** this component's raw conducted / attended */
  compCond: number;
  compAtt: number;
  weight: number;
}

function splitSums(
  subj: SubjectAttendance,
  weights: Weights,
  k: ComponentKey,
  tcbr?: TcbrMap,
): SplitSums {
  let otherCondW = 0;
  let otherAttW = 0;
  let compCond = 0;
  let compAtt = 0;
  for (const key of COMPONENT_ORDER) {
    const c = subj.components[key] ?? { conducted: 0, attended: 0 };
    const w = weights[key] ?? 0;
    const eff = c.conducted - tcbrOf(tcbr, key);
    if (key === k) {
      if (eff > 0) {
        compCond = eff;
        compAtt = c.attended;
      }
    } else {
      if (eff <= 0) continue;
      otherCondW += eff * w;
      otherAttW += c.attended * w;
    }
  }
  return { otherCondW, otherAttW, compCond, compAtt, weight: weights[k] ?? 0 };
}

/**
 * How many of component `k` you can bunk in a row while staying >= `target`.
 *   floor((100×(O_a + A_a×W) − T×(O_d + C_d×W)) / (T×W)), min 0.
 * Returns Infinity when the target is <= 0 (unlimited runway).
 */
export function skipMargin(
  subj: SubjectAttendance,
  weights: Weights,
  target: number,
  k: ComponentKey,
  tcbr?: TcbrMap,
): number {
  if (target <= 0) return Number.POSITIVE_INFINITY;
  const { otherCondW, otherAttW, compCond, compAtt, weight: W } = splitSums(subj, weights, k, tcbr);
  if (W <= 0) return 0;
  const num = 100 * (otherAttW + compAtt * W) - target * (otherCondW + compCond * W);
  const m = Math.floor(num / (target * W));
  return Math.max(0, m);
}

/**
 * How many of component `k` you must attend in a row to reach `target`.
 *   ceil((T×(O_d + C_d×W) − 100×(O_a + A_a×W)) / (W×(100−T))), min 0.
 * Returns Infinity when the target is unreachable from here.
 */
export function neededToReach(
  subj: SubjectAttendance,
  weights: Weights,
  target: number,
  k: ComponentKey,
  tcbr?: TcbrMap,
): number {
  if (target <= 0) return 0;
  const { otherCondW, otherAttW, compCond, compAtt, weight: W } = splitSums(subj, weights, k, tcbr);
  if (W <= 0) return Number.POSITIVE_INFINITY;
  const denom = W * (100 - target);
  const num = target * (otherCondW + compCond * W) - 100 * (otherAttW + compAtt * W);
  if (num <= 0) return 0;
  if (denom <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(num / denom);
}

/**
 * Overall bunk balance: max extra bunks (at the course's average weight)
 * before the weighted % would drop strictly below `linePct`.
 */
export function maxSkippable(
  subj: SubjectAttendance,
  weights: Weights,
  linePct: number,
  tcbr?: TcbrMap,
): number {
  const { attW, condW, count } = weightedSums(subj, weights, tcbr);
  if (count <= 0) return 0;
  const avgW = condW / count;
  if (avgW <= 0) return 0;
  const line = linePct / 100;
  if (line <= 0) return Number.MAX_SAFE_INTEGER;
  const n = Math.floor((attW / line - condW) / avgW);
  return Math.max(0, n);
}

/** Bunk-balance guidance at both red lines. */
export function skipGuidance(
  subj: SubjectAttendance,
  weights: Weights,
  t: Thresholds,
  tcbr?: TcbrMap,
): { keepCruising: number; stayAboveFloor: number } {
  return {
    keepCruising: maxSkippable(subj, weights, t.safeAt, tcbr),
    stayAboveFloor: maxSkippable(subj, weights, t.condonationFrom, tcbr),
  };
}

/* ------------------------------------------------------------------ */
/* Bands, labels, formatting                                           */
/* ------------------------------------------------------------------ */

export type Band = 'cruising' | 'thin-ice' | 'in-the-red';

export function policyBand(pct: number | null, t: Thresholds): Band {
  if (pct == null) return 'cruising';
  if (pct >= t.safeAt) return 'cruising';
  if (pct >= t.condonationFrom) return 'thin-ice';
  return 'in-the-red';
}

export function bandLabel(band: Band): string {
  switch (band) {
    case 'cruising':
      return 'Cruising';
    case 'thin-ice':
      return 'Thin ice';
    case 'in-the-red':
      return 'In the red';
  }
}

/** Format a ceiled percentage, e.g. 79%. Null -> em dash. */
export function fmtPct(pct: number | null): string {
  if (pct == null) return '—';
  return `${Math.round(pct)}%`;
}

/** Format a delta, e.g. +2 / −3 (percentage points). */
export function fmtDelta(delta: number): string {
  const r = Math.round(delta);
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${Math.abs(r)}`;
}

/** Friendly bunk-balance phrasing, e.g. "3 bunks of runway" / "no runway". */
export function fmtRunway(n: number): string {
  if (!Number.isFinite(n)) return 'unlimited runway';
  if (n <= 0) return 'no runway';
  return `${n} bunk${n === 1 ? '' : 's'} of runway`;
}
