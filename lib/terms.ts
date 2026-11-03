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

/** "Odd Sem 2026-2027" */
export function termText(term: { academicyear?: string; semester?: string } | null | undefined): string {
  if (!term) return '';
  return [term.semester, term.academicyear].filter(Boolean).join(' ');
}
