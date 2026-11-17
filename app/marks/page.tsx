'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Exam, MapPin, Notebook } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { useRecord } from '@/components/records';
import { Meter, RecordLine, RecordProblem, RecordSkeleton, SelectField, fmtDate, marks, nameCase } from '@/components/record-ui';
import { cn } from '@/components/cn';
import type { InternalCourse } from '@/lib/erp/records-parse';
import type { Paper } from '@/lib/erp/records-parse';

export default function MarksPage() {
  return (
    <DataGate title="Marks">
      <Marks />
    </DataGate>
  );
}

const termLabel = (t: { semester: string; yearLabel: string }) => `${t.semester} ${t.yearLabel}`;

function Marks() {
  const { snapshot } = useStore();
  // The synced term first; the ERP's own list of this student's terms once it is read.
  const [picked, setPicked] = useState<{ ay: string; sem: string } | null>(null);
  const want = picked ?? (snapshot?.term ? { ay: snapshot.term.academicyear, sem: snapshot.term.semesterid } : {});
  const rec = useRecord('marks', want);
  const terms = rec.data?.terms ?? [];
  const term = rec.data?.term ?? null;
  const value = term ? `${term.academicyear}:${term.semesterid}` : '';

  const courses = rec.data?.courses ?? [];
  const seating = rec.data?.seating ?? [];

  return (
    <div className="page-in">
      <PageHeader
        title="Marks"
        sub={<RecordLine fetchedAt={rec.fetchedAt} loading={rec.loading} onRefresh={rec.refresh} />}
        actions={
          terms.length > 1 && (
            <SelectField
              id="marks-term"
              label="Semester"
              className="w-[210px]"
              value={value}
              disabled={rec.loading}
              onChange={(v) => {
                const [ay, sem] = v.split(':');
                setPicked({ ay, sem });
              }}
              options={terms.map((t) => ({ id: `${t.academicyear}:${t.semesterid}`, label: termLabel(t) }))}
            />
          )
        }
      />
      <RecordProblem error={rec.error} code={rec.code} hasData={Boolean(rec.data)} />

      {seating.length > 0 && <ExamRooms seating={seating} />}

      <section aria-label="Internal marks" className="mt-9">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="h2">
            Internals {term && <span className="font-sans text-[15px] font-medium tracking-normal text-fg-3">{termLabel(term)}</span>}
          </h2>
        </div>
        {!rec.data && rec.loading ? (
          <RecordSkeleton cards={4} tall />
        ) : courses.length === 0 ? (
          rec.data && (
            <Empty icon={Notebook} title={`No internal marks on the ERP${term ? ` for ${termLabel(term)}` : ''} yet.`} className="mt-0">
              Marks appear here as faculty enter them. Pick another semester above to look back.
            </Empty>
          )
        ) : (
          <div className="grid items-start gap-3 md:grid-cols-2 lg:gap-4">
            {courses.map((c, i) => (
              <InternalCard key={c.code} course={c} index={i} />
            ))}
          </div>
        )}
      </section>

      <Papers />

      <Footnote>
        Read from the ERP when you open this screen, at most every 20 minutes. Weighted marks are what count toward the internal
        total; the raw score is out of each component&rsquo;s own maximum.
      </Footnote>
    </div>
  );
}

function InternalCard({ course, index }: { course: InternalCourse; index: number }) {
  const marked = course.components.filter((c) => c.marked);
  const got = marked.reduce((n, c) => n + (c.weighted ?? 0), 0);
  const of = marked.reduce((n, c) => n + (c.weight ?? 0), 0);
  return (
    <article className="card rise p-5 lg lg-card lg-frost" style={{ '--i': index } as CSSProperties} aria-label={nameCase(course.title)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
        <div className="min-w-0">
          <p className="mono text-[12px] text-fg-3">{course.code}</p>
          <h3 className="mt-2 line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] pretty">{nameCase(course.title)}</h3>
          <p className="mt-1.5 text-[13px] text-fg-2">
            {marked.length} of {course.components.length} components marked
          </p>
        </div>
        <div className="text-right">
          <p className="figure text-[34px] leading-none">{of ? marks(got) : '—'}</p>
          <p className="mt-1.5 text-[12px] text-fg-3 tnum">{of ? `of ${marks(of)} so far` : 'nothing yet'}</p>
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-1" aria-label={`${nameCase(course.title)}: components`}>
        {course.components.map((c, i) => (
          <li key={`${c.name}-${i}`} className="rounded-[12px] bg-white/[0.035] px-3 py-2 text-[13px] lg lg-card lg-frost">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-fg-2" title={c.name}>
                {c.name}
              </span>
              {c.marked ? (
                <span className="flex shrink-0 items-baseline gap-2.5 tnum">
                  <span className="text-[12px] text-fg-3">
                    {marks(c.total)}/{marks(c.max)}
                  </span>
                  <span className="font-semibold">
                    {marks(c.weighted)}
                    <span className="font-normal text-fg-3">/{marks(c.weight)}</span>
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-[12px] text-fg-3">Not marked yet</span>
              )}
            </div>
            {c.marked && <Meter value={c.total} max={c.max} className="mt-1.5" />}
          </li>
        ))}
      </ul>
    </article>
  );
}

function ExamRooms({ seating }: { seating: { date: string; examType: string; slot: string; courseCode: string; room: string }[] }) {
  return (
    <section aria-label="Exam rooms" className="mt-7">
      <div data-tone="mark" className="card glow p-5 lg:p-6 lg lg-card" style={{ '--gs': '360px', '--gx': '-150px', '--gy': '-190px' } as CSSProperties}>
        <p className="flex items-center gap-2 text-[13px] font-semibold text-fg-2">
          <MapPin size={16} weight="fill" aria-hidden /> Exam rooms
        </p>
        <ul className="mt-3 flex flex-col">
          {seating.map((s, i) => (
            <li key={`${s.date}-${s.courseCode}-${i}`} className={cn('flex items-center justify-between gap-4 py-3', i > 0 && 'hair-t')}>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{s.courseCode}</span>
                <span className="block text-[12.5px] text-fg-2">{[fmtDate(s.date, true), s.slot, s.examType].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="figure shrink-0 text-[24px]">{s.room}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Papers() {
  const rec = useRecord('papers');
  const papers = useMemo(() => rec.data?.papers ?? [], [rec.data]);
  const [open, setOpen] = useState<string | null>(null);

  // Newest term first; inside a term, as the ERP lists them.
  const groups = useMemo(() => {
    const by = new Map<string, Paper[]>();
    for (const p of papers) {
      const k = `${p.semester} ${p.academicYear}`;
      by.set(k, [...(by.get(k) ?? []), p]);
    }
    return [...by.entries()].sort((a, b) => {
      const ya = a[1][0].academicYear;
      const yb = b[1][0].academicYear;
      return yb.localeCompare(ya) || (/even/i.test(a[0]) ? -1 : 1);
    });
  }, [papers]);

  return (
    <section aria-label="Mid-term papers" className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="h2">
          Mid-term papers{' '}
          {papers.length > 0 && <span className="font-sans text-[15px] font-medium tracking-normal text-fg-3 tnum">{papers.length}</span>}
        </h2>
        {rec.data && (
          <button type="button" onClick={rec.refresh} disabled={rec.loading} className="link text-[13px] lg-press disabled:opacity-50">
            {rec.loading ? 'Reading…' : 'Refresh'}
          </button>
        )}
      </div>
      {!rec.data && rec.loading ? (
        <RecordSkeleton cards={2} />
      ) : !rec.data && rec.error ? (
        <RecordProblem error={rec.error} code={rec.code} hasData={false} />
      ) : papers.length === 0 ? (
        rec.data && (
          <Empty icon={Exam} title="No evaluated papers on the ERP yet." className="mt-0">
            Once a mid-term is evaluated, each question&rsquo;s marks show up here.
          </Empty>
        )
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(([label, list]) => (
            <div key={label}>
              <p className="mb-2.5 text-[13px] font-semibold text-fg-2">{label}</p>
              <ul className="grid items-start gap-2.5 md:grid-cols-2">
                {list.map((p, i) => {
                  const id = `${p.courseCode}-${p.exam}-${p.academicYear}-${p.semester}-${i}`;
                  const isOpen = open === id;
                  return (
                    <li key={id} className="card p-4 lg lg-card lg-frost">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : id)}
                        aria-expanded={isOpen}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold">{nameCase(p.courseName)}</span>
                          <span className="mt-0.5 block truncate text-[12.5px] text-fg-3">{p.exam}</span>
                        </span>
                        <span className="text-right">
                          <span className="figure text-[24px]">{marks(p.got)}</span>
                          <span className="text-[13px] text-fg-3 tnum">/{marks(p.max)}</span>
                        </span>
                      </button>
                      <Meter value={p.got} max={p.max} className="mt-3" />
                      <div className="t-acc" data-open={isOpen}>
                        <div className="t-acc-panel">
                          <div className="t-acc-panel-inner">
                            {isOpen && (
                              <div className="grid grid-cols-3 gap-1.5 pt-3.5 sm:grid-cols-4" inert={!isOpen}>
                                {p.questions.length === 0 ? (
                                  <p className="col-span-full text-[13px] text-fg-3">The ERP shows no question-wise marks for this paper.</p>
                                ) : (
                                  p.questions.map((q) => (
                                    <span key={q.question} className="rounded-[10px] bg-white/[0.04] px-2.5 py-2 text-center hair">
                                      <span className="block text-[11.5px] text-fg-3">Q{q.question}</span>
                                      <span className="block text-[14px] font-semibold tnum">
                                        {marks(q.got)}
                                        <span className="font-normal text-fg-3">/{marks(q.max)}</span>
                                      </span>
                                    </span>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
