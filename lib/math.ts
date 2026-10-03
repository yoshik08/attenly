/**
 * Attendance math for Skipwise.
 * All percentages are weighted across LTPS (Lecture / Tutorial / Practical / Skilling)
 * components using configurable per-component weights.
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

export interface Thresholds {
  /** e.g. 85 — at or above this the student is "Safe" */
  safeAt: number;
  /** e.g. 75 — at or above this (but below safeAt) is the condonation zone */
  condonationFrom: number;
}

export const COMPONENT_ORDER: ComponentKey[] = ['L', 'T', 'P', 'S'];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  L: 'Lecture',
  T: 'Tutorial',
  P: 'Practical',
  S: 'Skilling',
};

export const DEFAULT_WEIGHTS: Weights = { L: 100, T: 25, P: 50, S: 25 };
export const DEFAULT_THRESHOLDS: Thresholds = { safeAt: 85, condonationFrom: 75 };

interface WeightedParts {
  attW: number;
  condW: number;
  /** total number of conducted class sessions (unweighted) */
  count: number;
}

export function weightedParts(subj: SubjectAttendance, weights: Weights): WeightedParts {
  let attW = 0;
  let condW = 0;
  let count = 0;
  for (const k of COMPONENT_ORDER) {
    const c = subj.components[k] ?? { conducted: 0, attended: 0 };
    const w = weights[k] ?? 0;
    attW += c.attended * w;
    condW += c.conducted * w;
    count += c.conducted;
  }
  return { attW, condW, count };
}

/** Weighted attendance %, or null when no classes have been conducted yet. */
export function weightedPct(subj: SubjectAttendance, weights: Weights): number | null {
  const { attW, condW } = weightedParts(subj, weights);
  if (condW <= 0) return null;
  return (attW / condW) * 100;
}

/**
 * Impact of a single class of the given component type:
 * `gain` = percentage points added if the student attends it,
 * `loss` = percentage points lost if the student misses it.
 */
export function classImpact(
  subj: SubjectAttendance,
  weights: Weights,
  type: ComponentKey,
): { gain: number; loss: number } {
  const cur = weightedPct(subj, weights);
  const w = weights[type] ?? 0;
  const { attW, condW } = weightedParts(subj, weights);
  if (cur == null || condW <= 0 || w <= 0) return { gain: 0, loss: 0 };
  const ifAttended = ((attW + w) / (condW + w)) * 100;
  const ifMissed = (attW / (condW + w)) * 100;
  return { gain: ifAttended - cur, loss: cur - ifMissed };
}

/**
 * Maximum number of additional classes the student can miss before the
 * weighted % would drop strictly below `linePct`.
 * Missed classes are assumed to carry the subject's average weight per session.
 */
export function maxSkippable(
  subj: SubjectAttendance,
  weights: Weights,
  linePct: number,
): number {
  const { attW, condW, count } = weightedParts(subj, weights);
  if (count <= 0) return 0;
  const avgW = condW / count;
  if (avgW <= 0) return 0;
  const line = linePct / 100;
  if (line <= 0) return Number.MAX_SAFE_INTEGER;
  // attW / (condW + n*avgW) >= line  =>  n <= (attW/line - condW)/avgW
  const n = Math.floor((attW / line - condW) / avgW);
  return Math.max(0, n);
}

/** "Can skip N classes" guidance: how many misses keep you safe, and how many keep you out of condonation trouble. */
export function skipGuidance(
  subj: SubjectAttendance,
  weights: Weights,
  t: Thresholds,
): { keepSafe: number; stayAboveCondonation: number } {
  return {
    keepSafe: maxSkippable(subj, weights, t.safeAt),
    stayAboveCondonation: maxSkippable(subj, weights, t.condonationFrom),
  };
}

export type Band = 'safe' | 'condonation' | 'below';

export function policyBand(pct: number | null, t: Thresholds): Band {
  if (pct == null) return 'safe';
  if (pct >= t.safeAt) return 'safe';
  if (pct >= t.condonationFrom) return 'condonation';
  return 'below';
}

export function bandLabel(band: Band, t: Thresholds): string {
  switch (band) {
    case 'safe':
      return 'Safe';
    case 'condonation':
      return 'Condonation zone';
    case 'below':
      return `Under ${t.condonationFrom}% — condonation needed`;
  }
}

/** Format a percentage for display, e.g. 78.6%. Null -> em dash. */
export function fmtPct(pct: number | null, digits = 1): string {
  if (pct == null) return '—';
  return `${pct.toFixed(digits)}%`;
}

/** Format a delta for badges, e.g. +8.2% / -2.4%. */
export function fmtDelta(delta: number, digits = 1): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${Math.abs(delta).toFixed(digits)}%`;
}
