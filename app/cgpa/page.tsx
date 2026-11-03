'use client';

import { useMemo, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Figure } from '@/components/motion';
import { cn } from '@/components/cn';
import { compareTerms } from '@/lib/terms';

export default function CgpaPage() {
  return (
    <DataGate title="CGPA">
      <Cgpa />
    </DataGate>
  );
}

function gradeInk(grade: string): string {
  const g = grade.trim().toUpperCase();
  if (g === 'O' || g === 'A+' || g === 'A') return 'text-cruise';
  if (g === 'F' || g === 'AB' || g === 'I' || g === 'R') return 'text-red';
  return 'text-mark';
}

function Cgpa() {
  const { snapshot, sync, forceSync } = useStore();
  // Older snapshots stored semesters alphabetically; always order them by time.
  const terms = useMemo(() => [...(snapshot?.sgpaTerms ?? [])].sort(compareTerms), [snapshot]);
  const rows = useMemo(() => snapshot?.cgpaRows ?? [], [snapshot]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = terms.find((t) => t.key === picked) ?? terms[terms.length - 1] ?? null;
  const termRows = selected ? rows.filter((r) => `${r.academicYear}::${r.semester}` === selected.key) : [];
  const credits = terms.reduce((n, t) => n + t.credits, 0);

  if (terms.length === 0) {
    return (
      <section className="page-in py-8 lg:py-10">
        <h1 className="title-l">CGPA</h1>
        <p className="mt-8 text-[15px] font-semibold">No graded semesters on the ERP yet.</p>
        <p className="mt-1 max-w-[52ch] text-[13px] text-dropout-text">
          Grades appear here once your first semester results are published. Attenly checks with every sync.
        </p>
        <button type="button" className="btn btn-line press mt-6" disabled={sync.running} onClick={() => void forceSync()}>
          <ArrowsClockwise size={18} className={sync.running ? 'spin' : ''} aria-hidden />
          {sync.running ? 'Syncing…' : 'Check now'}
        </button>
      </section>
    );
  }

  return (
    <div className="page-in py-6 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-14 lg:py-10">
      <aside className="lg:sticky lg:top-[calc(var(--bar-h)+var(--safe-t)+40px)] lg:self-start">
        <h1 className="title-l">CGPA</h1>
        <div className="mt-5 flex items-end gap-3">
          <Figure value={snapshot?.cgpa ?? null} suffix="" decimals={2} className="figure text-[64px]" />
          <p className="pb-1.5 text-[13px] text-dropout-text">
            out of 10
            <span className="block tnum">
              {credits} credits over {terms.length} {terms.length === 1 ? 'semester' : 'semesters'}
            </span>
          </p>
        </div>

        <h2 className="mt-8 text-[13px] font-medium text-dropout-text">SGPA by semester</h2>
        <ul className="mt-2">
          {[...terms].reverse().map((t) => {
            const active = t.key === selected?.key;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => setPicked(t.key)}
                  aria-pressed={active}
                  className={cn('press seam-b grid w-full grid-cols-[1fr_auto] items-center gap-x-4 rounded-lg px-2 py-3 text-left', active ? 'bg-[#0f1420]' : 'hover:bg-[#080b12]')}
                >
                  <span className="text-[14px] font-medium">
                    {t.semester}
                    <span className="ml-1.5 text-[12px] text-dropout-quiet tnum">{t.academicYear}</span>
                  </span>
                  <span className="figure text-[20px]">{t.sgpa != null ? t.sgpa.toFixed(2) : '—'}</span>
                  <span className="col-span-2 mt-2 block h-1 rounded-full bg-seam">
                    <span className="block h-full rounded-full bg-mark" style={{ width: `${Math.min(100, ((t.sgpa ?? 0) / 10) * 100)}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="mt-10 lg:mt-1" aria-label="Grades">
        {selected && (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="title-s text-[20px]">
                {selected.semester} <span className="text-dropout-text tnum">{selected.academicYear}</span>
              </h2>
              <p className="text-[13px] text-dropout-text tnum">{selected.credits} credits</p>
            </div>
            <table className="mt-4 w-full border-collapse text-left">
              <thead>
                <tr className="seam-b text-[12px] text-dropout-quiet">
                  <th className="py-2 pr-3 font-medium">Course</th>
                  <th className="w-16 py-2 pr-3 text-center font-medium">Grade</th>
                  <th className="hidden w-16 py-2 pr-3 text-right font-medium sm:table-cell">Points</th>
                  <th className="w-16 py-2 text-right font-medium">Credits</th>
                </tr>
              </thead>
              <tbody>
                {termRows.map((r) => (
                  <tr key={`${r.courseCode}-${r.grade}`} className="seam-b align-top">
                    <td className="py-3 pr-3">
                      <span className="block text-[14px] font-medium leading-snug">{r.courseName}</span>
                      <span className="text-[12px] text-dropout-quiet tnum">{r.courseCode}</span>
                    </td>
                    <td className={cn('figure py-3 pr-3 text-center text-[18px]', gradeInk(r.grade))}>{r.grade || '—'}</td>
                    <td className="hidden py-3 pr-3 text-right text-[14px] text-dropout-text tnum sm:table-cell">{r.gradePoint}</td>
                    <td className="py-3 text-right text-[14px] text-dropout-text tnum">{r.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="mt-6 text-[12px] text-dropout-quiet">
          Worked out from the ERP’s course grades: credit-weighted grade points, failed courses left out.
        </p>
      </section>
    </div>
  );
}
