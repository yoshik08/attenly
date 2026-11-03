/** Position of a semester inside its academic year: odd (Jul–Dec), even (Jan–Jun), then summer. */
export function semesterRank(semester: string): number {
  const s = semester.replace(/\s+/g, ' ').trim().toLowerCase();
  if (/odd|\b1\b|\bi\b|first/.test(s)) return 1;
  if (/even|\b2\b|\bii\b|second/.test(s)) return 2;
  if (/summer|supple/.test(s)) return 3;
  return 4;
}

/** Oldest first. */
export function compareTerms(a: { academicYear: string; semester: string }, b: { academicYear: string; semester: string }): number {
  return (
    a.academicYear.localeCompare(b.academicYear) ||
    semesterRank(a.semester) - semesterRank(b.semester) ||
    a.semester.localeCompare(b.semester)
  );
}

export interface TermOption {
  id: string;
  label: string;
}

export interface TermOptions {
  years: TermOption[];
  semesters: TermOption[];
}

/** A term as the ERP's forms take it: ids for the year and semester, plus readable labels. */
export interface Term {
  academicyear: string;
  semesterid: string;
  semester: string;
  yearLabel?: string;
}

/** "2026-2027" (or "2026-27") → 2026; null when the label isn't a year range. */
export function yearStart(label: string): number | null {
  const m = /(20\d{2})\s*[-–/]\s*(?:20)?\d{2}/.exec(label) ?? /^\s*(20\d{2})\s*$/.exec(label);
  return m ? Number(m[1]) : null;
}

/** Academic years, newest first. The ERP's option values are internal ids ("30"), so order by the label's year. */
export function yearsNewestFirst(years: TermOption[]): TermOption[] {
  return years
    .map((y, i) => ({ y, i, start: yearStart(y.label) ?? yearStart(y.id) }))
    .sort((a, b) => {
      if (a.start != null && b.start != null && a.start !== b.start) return b.start - a.start;
      if (a.start != null && b.start == null) return -1;
      if (a.start == null && b.start != null) return 1;
      const na = Number(a.y.id);
      const nb = Number(b.y.id);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na;
      return a.i - b.i;
    })
    .map((x) => x.y);
}

/** Within a year, the latest semester first: even, then odd, then anything else (summer, supplementary). */
function semesterTryOrder(label: string): number {
  const r = semesterRank(label);
  return r === 2 ? 0 : r === 1 ? 1 : r === 3 ? 2 : 3;
}

/**
 * Terms to try when nobody picked one, newest first: the two most recent
 * academic years and, within each, even → odd → the rest. The sync takes the
 * first that has courses on the ERP.
 */
export function termCandidates(options: TermOptions, maxYears = 2): Term[] {
  const sems = [...options.semesters].sort((a, b) => semesterTryOrder(a.label) - semesterTryOrder(b.label));
  return yearsNewestFirst(options.years)
    .slice(0, maxYears)
    .flatMap((y) => sems.map((s) => ({ academicyear: y.id, semesterid: s.id, semester: s.label, yearLabel: y.label })));
}

/** A chosen year/semester (ids) with its labels filled in from the ERP's options. */
export function termFromIds(ids: { academicyear: string; semesterid: string }, options?: TermOptions | null): Term {
  const year = options?.years.find((y) => y.id === ids.academicyear);
  const sem = options?.semesters.find((s) => s.id === ids.semesterid);
  return {
    academicyear: ids.academicyear,
    semesterid: ids.semesterid,
    semester: sem?.label ?? ids.semesterid,
    ...(year ? { yearLabel: year.label } : {}),
  };
}

/** "Even Sem 2026-2027" — always the readable year, never the ERP's internal id. */
export function termText(term: { academicyear?: string; semester?: string; yearLabel?: string } | null | undefined): string {
  if (!term) return '';
  return [term.semester, term.yearLabel ?? term.academicyear].filter(Boolean).join(' ');
}
