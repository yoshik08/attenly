/**
 * SGPA per semester and CGPA overall, from the ERP's grade list (snapshot.cgpaRows).
 *
 * - A semester is (Reg Academic Year, Reg Sem): never a year alone, never a code prefix.
 *   Each gets its own SGPA = Σ(grade point × credits) / Σ credits over its courses only.
 * - Grade points: the ERP's printed Grade Point when present, else O 10, A+ 9, A 8, B+ 7,
 *   B 6, C 5, P 4, F 0.
 * - 0-credit courses add nothing to either sum (whatever point is printed for them).
 * - F: 0 points, credits still count. Absent / not yet declared: left out until declared.
 * - A row with no semester counts in no SGPA; it is returned as unclassified.
 * - Rounded to 2 decimals, half up. A semester with no counted credits has no SGPA (null).
 */
import { compareTerms } from './terms';

export interface GradeRow {
  courseCode: string;
  courseName: string;
  grade: string;
  /** The ERP's printed grade point (0 when it printed none). */
  gradePoint: number;
  credits: number;
  academicYear: string;
  semester: string;
}

export const GRADE_POINTS: Record<string, number> = { O: 10, 'A+': 9, A: 8, 'B+': 7, B: 6, C: 5, P: 4, F: 0 };

/** Grades that mean "no result yet" rather than a result. */
const NOT_DECLARED = /^(ab|absent|i|incomplete|w|withheld|r|nr|not declared|-)?$/i;

/** The point a row earns, or null when it has no declared result. */
export function gradePointOf(row: Pick<GradeRow, 'grade' | 'gradePoint'>): number | null {
  const g = row.grade.trim().toUpperCase();
  if (NOT_DECLARED.test(g)) return null;
  if (g === 'F') return 0;
  if (Number.isFinite(row.gradePoint) && row.gradePoint > 0) return row.gradePoint;
  return g in GRADE_POINTS ? GRADE_POINTS[g] : null;
}

/** points / credits to 2 decimals, half up, without float drift (8.125 → 8.13). */
export function roundGpa(points: number, credits: number): number {
  // Grade points are whole and credits come in halves at worst, so ×4 makes both integers.
  const p = Math.round(points * 4);
  const c = Math.round(credits * 4);
  return Math.floor((p * 200 + c) / (2 * c)) / 100;
}

export interface GpaResult {
  /** null when nothing in the set carries credits. */
  gpa: number | null;
  /** Credits that count (declared, non-zero). */
  credits: number;
  points: number;
  /** Courses that count toward the figure. */
  counted: number;
}

/** One set of courses → its GPA. Used per semester (SGPA) and over everything (CGPA). */
export function computeSGPA(rows: GradeRow[]): GpaResult {
  let points = 0;
  let credits = 0;
  let counted = 0;
  for (const r of rows) {
    if (!(r.credits > 0)) continue;
    const gp = gradePointOf(r);
    if (gp == null) continue;
    points += gp * r.credits;
    credits += r.credits;
    counted++;
  }
  return { gpa: credits > 0 ? roundGpa(points, credits) : null, credits, points, counted };
}

export interface SemesterResult extends GpaResult {
  key: string;
  academicYear: string;
  semester: string;
  /** Every row of this semester, 0-credit and undeclared ones included (for display). */
  courses: GradeRow[];
}

/** Rows grouped by (academic year, semester), oldest first; rows with no semester or year apart. */
export function groupBySemester(rows: GradeRow[]): { semesters: SemesterResult[]; unclassified: GradeRow[] } {
  const by = new Map<string, { academicYear: string; semester: string; courses: GradeRow[] }>();
  const unclassified: GradeRow[] = [];
  for (const r of rows) {
    const academicYear = r.academicYear.trim();
    const semester = r.semester.trim();
    if (!academicYear || !semester) {
      unclassified.push(r);
      continue;
    }
    const key = `${academicYear}::${semester}`;
    const g = by.get(key) ?? { academicYear, semester, courses: [] };
    g.courses.push(r);
    by.set(key, g);
  }
  const semesters = [...by.entries()].map(([key, g]) => ({ key, ...g, ...computeSGPA(g.courses) }));
  semesters.sort(compareTerms);
  return { semesters, unclassified };
}

/** CGPA over every declared course (unclassified ones too: they are still results). */
export function computeCGPA(rows: GradeRow[]): GpaResult {
  return computeSGPA(rows);
}
