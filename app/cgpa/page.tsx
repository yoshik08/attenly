'use client';

import { useMemo, useState } from 'react';
import { ArrowsClockwise, GraduationCap } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Figure } from '@/components/motion';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { cn } from '@/components/cn';
import { compareTerms } from '@/lib/terms';

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

/** "Odd Sem" + "2024-2025" → "Odd · 24–25" for a chart label. */
function shortTerm(semester: string, year: string) {
  const sem = semester.replace(/\s*sem(ester)?\s*/i, '').trim() || semester;
  const m = /(\d{2})(\d{2})\s*[-–/]\s*(?:\d{2})?(\d{2})/.exec(year);
  return m ? `${sem} ${m[2]}–${m[3]}` : `${sem} ${year}`;
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
      <section className="page-in">
        <PageHeader title="CGPA" />
        <Empty
          icon={GraduationCap}
          title="No graded semesters on the ERP yet."
          action={
            <button type="button" className="btn btn-secondary press lg lg-btn" disabled={sync.running} onClick={() => void forceSync()}>
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

  return (
    <div className="page-in">
      <PageHeader title="CGPA" />

      <section
        data-tone="mark"
        className="card glow mt-7 grid grid-cols-[minmax(0,1fr)] gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end lg:gap-12 lg lg-card"
        style={{ '--gs': '520px', '--gx': '-200px', '--gy': '-260px' } as React.CSSProperties}
        aria-label="CGPA and SGPA by semester"
      >
        <div>
          <Figure value={snapshot?.cgpa ?? null} suffix="" decimals={2} className="figure block text-[80px] sm:text-[104px]" />
          <p className="mt-3 text-[15px] text-fg-2">
            out of 10 <span className="text-fg-3">·</span>{' '}
            <span className="tnum">
              {credits} credits over {terms.length} {terms.length === 1 ? 'semester' : 'semesters'}
            </span>
          </p>
        </div>

        <div>
          <p className="text-[13px] font-semibold text-fg-2">SGPA by semester</p>
          <div className="mt-4 flex h-[150px] items-end gap-2.5 sm:h-[170px]" role="group" aria-label="Semesters">
            {terms.map((t) => {
              const active = t.key === selected?.key;
              const h = Math.max(6, Math.min(100, ((t.sgpa ?? 0) / 10) * 100));
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setPicked(t.key)}
                  aria-pressed={active}
                  className="press group flex h-full min-w-0 max-w-[72px] flex-1 flex-col items-center justify-end gap-2 lg-press"
                >
                  <span className="sr-only">
                    {t.semester} {t.academicYear}, SGPA
                  </span>
                  <span className={cn('figure text-[15px]', active ? 'text-fg' : 'text-fg-2')}>{t.sgpa != null ? t.sgpa.toFixed(2) : '—'}</span>
                  <span
                    className={cn(
                      'w-full rounded-t-[10px] rounded-b-[4px] transition-colors',
                      active ? 'bg-fg shadow-[0_0_24px_rgba(255,255,255,0.25)]' : 'bg-white/[0.12] group-hover:bg-white/[0.2]',
                    )}
                    style={{ height: `${h}%` }}
                  />
                  <span className={cn('max-w-full truncate text-[11.5px] font-semibold', active ? 'text-fg' : 'text-fg-3')}>
                    {shortTerm(t.semester, t.academicYear)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-10" aria-label="Grades">
        {selected && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="h2 text-[22px]">
                {selected.semester} <span className="text-fg-3 tnum">{selected.academicYear}</span>
              </h2>
              <p className="text-[13px] text-fg-2 tnum">
                SGPA <span className="font-semibold text-fg">{selected.sgpa != null ? selected.sgpa.toFixed(2) : '—'}</span> · {selected.credits} credits
              </p>
            </div>
            <div className="card mt-4 px-4 sm:px-5 lg lg-card lg-frost">
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
                  {termRows.map((r, i) => (
                    <tr key={`${r.courseCode}-${r.grade}-${i}`} className="border-t border-line align-middle">
                      <td className="py-3.5 pr-3">
                        <span className="block text-[14px] font-semibold leading-snug">{r.courseName}</span>
                        <span className="mono text-[12px] text-fg-3">{r.courseCode}</span>
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
          </>
        )}
        <Footnote>Worked out from the ERP’s course grades: credit-weighted grade points, failed courses left out.</Footnote>
      </section>
    </div>
  );
}
