'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight, Exam, MapPin, Notebook } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { useRecord } from '@/components/records';
import { Meter, RecordLine, RecordProblem, RecordSkeleton, SelectField, fmtDate, marks, nameCase } from '@/components/record-ui';
import { cn } from '@/components/cn';
import type { InternalCourse } from '@/lib/erp/records-parse';

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

      <Link
        href="/booklets"
        className="card press mt-10 flex items-center gap-4 p-5 hover:bg-raised lg lg-card lg-frost lg-press"
      >
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-raised hair">
          <Exam size={22} className="text-fg" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Mid-term booklets</span>
          <span className="block text-[13px] text-fg-2">Your scanned answer scripts, marked question by question</span>
        </span>
        <ArrowRight size={18} className="shrink-0 text-fg-2" aria-hidden />
      </Link>

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

