'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ArrowRight, CheckCircle, MapPin, XCircle } from '@phosphor-icons/react';
import { cn } from './cn';
import { FULL_DAY } from './day-strip';
import type { Settings } from './store';
import { COMPONENT_LABELS, countOf, statusOf, type ComponentKey, type Status, type SubjectAttendance } from '@/lib/math';
import { agendaOf, clockOf, minutesOf, skipCall, type CourseSummary, type SkipCall } from '@/lib/insights';
import type { TimetableDay, TimetablePeriod } from '@/lib/erp/parsers';

const dateFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

interface Call {
  tone: Status | 'none';
  skippable: boolean;
  head: string;
  sub: string;
  chip: string;
}

function callFor(call: SkipCall | null, k: ComponentKey, target: number): Call {
  if (!call || call.now == null) {
    return { tone: 'none', skippable: false, head: 'Not counted yet', sub: 'No classes of this course are on the ERP yet.', chip: 'Not counted' };
  }
  if (call.skippable) {
    return {
      tone: 'safe',
      skippable: true,
      head: 'Skippable',
      sub: `Miss it and you’d still show ${call.after}%.`,
      chip: 'Skippable',
    };
  }
  if (call.now >= target) {
    return {
      tone: statusOf(call.after) === 'safe' ? 'condonation' : (statusOf(call.after) ?? 'condonation'),
      skippable: false,
      head: 'Go to this one',
      sub: `Missing it drops you to ${call.after}%, under ${target}%.`,
      chip: 'Attend',
    };
  }
  const tone = statusOf(call.now) ?? 'detained';
  return {
    tone,
    skippable: false,
    head: 'Go to this one',
    sub:
      call.needed != null && Number.isFinite(call.needed)
        ? `You’re at ${call.now}%: ${countOf(call.needed, k)} in a row gets you to ${target}%.`
        : `You’re at ${call.now}%: every class counts from here.`,
    chip: 'Attend',
  };
}

function untilLabel(p: TimetablePeriod, inDays: number, day: string, now: Date): string {
  if (inDays === 0) {
    const start = minutesOf(p.start);
    if (start == null) return 'Later today';
    const mins = start - (now.getHours() * 60 + now.getMinutes());
    if (mins < 60) return `Starts in ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `Starts in ${h} h${m ? ` ${m} min` : ''}`;
  }
  return inDays === 1 ? 'Tomorrow' : FULL_DAY[day];
}

function TimeFigure({ hhmm, className }: { hhmm: string; className?: string }) {
  const [t, ap] = clockOf(hhmm).split(' ');
  return (
    <span className={cn('figure inline-flex items-baseline', className)}>
      {t || hhmm}
      {ap && <span className="ml-1.5 font-sans text-[0.36em] font-semibold uppercase tracking-[0.02em] text-fg-2">{ap}</span>}
    </span>
  );
}

/**
 * The first day with classes still ahead, each class with the one call that
 * matters: can it be skipped and still hold the target? Every call assumes the
 * rest of that course's classes are attended, like the budgets on the cards.
 */
export function UpNext({
  timetable,
  subjects,
  summaries,
  settings,
  now,
}: {
  timetable: TimetableDay[];
  subjects: SubjectAttendance[];
  summaries: Map<string, CourseSummary>;
  settings: Settings;
  now: number;
}) {
  const date = new Date(now);
  const agenda = agendaOf(timetable, date);
  if (!agenda) return null;
  const rows = agenda.periods.map((p) => {
    const k: ComponentKey = p.type ?? 'L';
    const subj = subjects.find((s) => s.code === p.subjectCode);
    const call = callFor(subj ? skipCall(subj, settings, k) : null, k, settings.target);
    return { p, k, call, title: summaries.get(p.subjectCode)?.title ?? (p.subjectTitle || p.subjectCode) };
  });
  const [first, ...rest] = rows;
  const dayWord = agenda.inDays === 0 ? 'Today' : agenda.inDays === 1 ? 'Tomorrow' : FULL_DAY[agenda.day];
  const left = agenda.inDays === 0 ? `${rows.length} more ${rows.length === 1 ? 'class' : 'classes'}` : `${rows.length} ${rows.length === 1 ? 'class' : 'classes'}`;

  return (
    <section
      aria-label="Up next"
      data-tone={first.call.tone}
      className="card glow rise mt-7 lg:mt-9"
      style={{ '--gs': '620px', '--gx': '-240px', '--gy': '-330px' } as CSSProperties}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="p-5 lg:p-7">
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-fg-2">
            <span className="text-fg">Up next</span>
            <span aria-hidden>·</span>
            <span>{untilLabel(first.p, agenda.inDays, agenda.day, date)}</span>
          </p>
          <div className="mt-4">
            {first.p.start ? (
              <TimeFigure hhmm={first.p.start} className="text-[52px] lg:text-[64px]" />
            ) : (
              <span className="figure text-[44px]">{first.p.period.replace(/^P/, 'Period ')}</span>
            )}
          </div>
          <Link href={`/#course-${first.p.subjectCode}`} className="group mt-3 block">
            <h2 className="text-[21px] font-semibold leading-snug tracking-[-0.015em] group-hover:underline group-hover:decoration-white/30 pretty">
              {first.title}
            </h2>
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-fg-2">
            <span>{COMPONENT_LABELS[first.k]}</span>
            {first.p.room && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} aria-hidden /> {first.p.room}
              </span>
            )}
            {first.p.end && <span className="tnum">until {clockOf(first.p.end)}</span>}
          </p>
          <div className="mt-5 rounded-[18px] bg-tone/10 p-4 ring-1 ring-inset ring-tone/25">
            <p className="flex items-center gap-2 text-[18px] font-semibold text-tone">
              {first.call.skippable ? <CheckCircle size={22} weight="fill" aria-hidden /> : <XCircle size={22} weight="fill" aria-hidden />}
              {first.call.head}
            </p>
            <p className="mt-1 text-[14px] text-fg-2 pretty">{first.call.sub}</p>
          </div>
        </div>

        <div className="flex flex-col p-5 pt-0 lg:border-l lg:border-line lg:p-7">
          <div className="flex items-baseline justify-between gap-3 hair-t pt-4 lg:pt-0 lg:shadow-none">
            <p className="text-[15px] font-semibold">
              {dayWord} <span className="font-normal text-fg-2">{dateFmt.format(agenda.date)}</span>
            </p>
            <p className="text-[13px] text-fg-3 tnum">{left}</p>
          </div>
          <ol className="mt-2 flex-1">
            {[first, ...rest].map((r, i) => (
              <li key={`${r.p.period}-${r.p.subjectCode}`} data-tone={r.call.tone} className={cn('flex items-center gap-3 py-2.5', i > 0 && 'hair-t')}>
                <span className="mono w-[62px] shrink-0 text-[12.5px] text-fg-2">{clockOf(r.p.start) || r.p.period}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[14px] font-medium', i === 0 && 'text-fg')}>{r.title}</span>
                  <span className="block truncate text-[12px] text-fg-3">
                    {COMPONENT_LABELS[r.k]}
                    {r.p.room ? ` · ${r.p.room}` : ''}
                  </span>
                </span>
                <span className="chip shrink-0">
                  <span className="dot" aria-hidden />
                  {r.call.chip}
                </span>
              </li>
            ))}
          </ol>
          <Link href={`/plan?day=${agenda.day}`} className="press mt-3 inline-flex items-center gap-1.5 self-start rounded-full text-[13px] font-semibold text-fg-2 hover:text-fg">
            Plan the whole day <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
