'use client';

import { useMemo, type CSSProperties } from 'react';
import { ArrowsClockwise, GraduationCap } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Figure } from '@/components/motion';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { cn } from '@/components/cn';
import { computeCGPA, groupBySemester, type GradeRow, type SemesterResult } from '@/lib/gpa';

export default function CgpaPage() {
  return (
    <DataGate title="CGPA">
      <Cgpa />
    </DataGate>
  );
}

function gradeTone(grade: string): 'safe' | 'mark' | 'condonation' | 'detained' {
  const g = grade.trim().toUpperCase();
  if (g === 'O' || g === 'A+' || g === 'A') return 'safe';
  if (g === 'F' || g === 'AB' || g === 'I' || g === 'R') return 'detained';
  if (g === 'C' || g === 'D' || g === 'P') return 'condonation';
  return 'mark';
}

/** "2025-2026" → "2025–2026". */
const yearText = (y: string) => y.replace(/(\d{4})\s*-\s*(\d{2,4})/, '$1–$2');

/** "Odd Sem" + "2025-2026" → "Odd 25–26" for a bar label. */
function shortTerm(semester: string, year: string) {
  const sem = semester.replace(/\s*sem(ester)?\s*/i, '').trim() || semester;
  const m = /(\d{2})(\d{2})\s*[-–/]\s*(?:\d{2})?(\d{2})/.exec(year);
  return m ? `${sem} ${m[2]}–${m[3]}` : `${sem} ${year}`;
}

const sgpaText = (n: number | null) => (n == null ? '—' : n.toFixed(2));
const sectionId = (key: string) => `sem-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

function Cgpa() {
  const { snapshot, sync, forceSync } = useStore();
  const rows: GradeRow[] = useMemo(() => snapshot?.cgpaRows ?? [], [snapshot]);
  // One SGPA per (academic year, semester), each from its own courses only (lib/gpa.ts).
  const { semesters, unclassified } = useMemo(() => groupBySemester(rows), [rows]);
  const overall = useMemo(() => computeCGPA(rows), [rows]);
  const newestFirst = useMemo(() => [...semesters].reverse(), [semesters]);
  const graded = semesters.filter((s) => s.gpa != null);

  if (rows.length === 0) {
    return (
      <section className="page-in">
        <PageHeader title="CGPA" />
        <Empty
          icon={GraduationCap}
          title="No graded semesters on the ERP yet."
          action={
            <button type="button" className="btn btn-secondary press" disabled={sync.running} onClick={() => void forceSync()}>
              <ArrowsClockwise size={18} className={sync.running ? 'spin' : ''} aria-hidden />
              {sync.running ? 'Syncing…' : 'Check now'}
            </button>
          }
        >
          Grades appear here once your first semester results are published. Attenly checks with every sync.
        </Empty>
      </section>
    );
  }

  const jump = (key: string) => {
    document.getElementById(sectionId(key))?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  return (
    <div className="page-in">
      <PageHeader title="CGPA" />

      <section
        data-tone="mark"
        className="card glow mt-7 grid grid-cols-[minmax(0,1fr)] gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end lg:gap-12"
        style={{ '--gs': '520px', '--gx': '-200px', '--gy': '-260px' } as CSSProperties}
        aria-label="CGPA and SGPA by semester"
      >
        <div>
          <Figure value={overall.gpa} suffix="" decimals={2} className="figure block text-[80px] sm:text-[104px]" />
          <p className="mt-3 text-[15px] text-fg-2">
            out of 10 <span className="text-fg-3">·</span>{' '}
            <span className="tnum">
              {overall.credits} credits over {graded.length} {graded.length === 1 ? 'semester' : 'semesters'}
            </span>
          </p>
        </div>

        <div>
          <p className="text-[13px] font-semibold text-fg-2">SGPA by semester</p>
          <div className="mt-4 flex h-[150px] items-end gap-2.5 sm:h-[170px]" role="group" aria-label="Semesters">
            {semesters.map((t) => {
              const h = t.gpa == null ? 4 : Math.max(6, Math.min(100, (t.gpa / 10) * 100));
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => jump(t.key)}
                  className="press group flex h-full min-w-0 max-w-[72px] flex-1 flex-col items-center justify-end gap-2"
                >
                  <span className="sr-only">
                    {t.semester} {t.academicYear}, SGPA
                  </span>
                  <span className="figure text-[15px] text-fg">{sgpaText(t.gpa)}</span>
                  <span
                    className={cn(
                      'w-full rounded-t-[10px] rounded-b-[4px] transition-colors',
                      t.gpa == null ? 'bg-white/[0.08]' : 'bg-fg/90 shadow-[0_0_24px_rgba(255,255,255,0.18)] group-hover:bg-fg',
                    )}
                    style={{ height: `${h}%` }}
                  />
                  <span className="max-w-full truncate text-[11.5px] font-semibold text-fg-2">{shortTerm(t.semester, t.academicYear)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="mt-10 flex flex-col gap-10">
        {newestFirst.map((t) => (
          <SemesterSection key={t.key} sem={t} />
        ))}
        {unclassified.length > 0 && <Unclassified rows={unclassified} />}
      </div>

      <Footnote>
        Each semester&rsquo;s SGPA uses only its own courses: grade points × credits, divided by its credits, to 2 decimals. 0-credit
        courses don&rsquo;t count either way; an F counts its credits with 0 points; results not yet declared wait until they are.
        The CGPA does the same over every course.
      </Footnote>
    </div>
  );
}

function SemesterSection({ sem }: { sem: SemesterResult }) {
  return (
    <section id={sectionId(sem.key)} aria-label={`${sem.semester} ${sem.academicYear}`} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="h2 text-[22px]">
          {yearText(sem.academicYear)} <span className="text-fg-3">·</span> {sem.semester}
        </h2>
        <p className="text-[13px] text-fg-2 tnum">
          SGPA <span className="font-semibold text-fg">{sgpaText(sem.gpa)}</span> · {sem.credits} credits · {sem.counted}{' '}
          {sem.counted === 1 ? 'course' : 'courses'}
        </p>
      </div>
      <CourseTable rows={sem.courses} />
    </section>
  );
}

function Unclassified({ rows }: { rows: GradeRow[] }) {
  return (
    <section aria-label="Not matched to a semester">
      <h2 className="h2 text-[22px]">Not matched to a semester</h2>
      <p className="mt-1 text-[13px] text-fg-2">The ERP gave no semester for these, so they count toward the CGPA but no SGPA.</p>
      <CourseTable rows={rows} />
    </section>
  );
}

function CourseTable({ rows }: { rows: GradeRow[] }) {
  return (
    <div className="card mt-4 px-4 sm:px-5">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[12px] text-fg-3">
            <th className="py-3 pr-3 font-semibold">Course</th>
            <th className="w-16 py-3 pr-3 text-center font-semibold">Grade</th>
            <th className="hidden w-16 py-3 pr-3 text-right font-semibold sm:table-cell">Points</th>
            <th className="w-16 py-3 text-right font-semibold">Credits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.courseCode}-${r.grade}-${i}`} className="border-t border-line align-middle">
              <td className="py-3.5 pr-3">
                <span className="block text-[14px] font-semibold leading-snug">{r.courseName}</span>
                <span className="mono text-[12px] text-fg-3">
                  {r.courseCode}
                  {!(r.credits > 0) && <span className="ml-2 font-sans text-fg-3">· 0 credits, not counted</span>}
                </span>
              </td>
              <td className="py-3.5 pr-3 text-center">
                <span
                  data-tone={gradeTone(r.grade)}
                  className="figure inline-flex h-10 w-11 items-center justify-center rounded-[12px] bg-tone/12 text-[17px] text-tone"
                >
                  {r.grade || '—'}
                </span>
              </td>
              <td className="hidden py-3.5 pr-3 text-right text-[14px] text-fg-2 tnum sm:table-cell">{r.gradePoint}</td>
              <td className="py-3.5 text-right text-[14px] text-fg-2 tnum">{r.credits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
