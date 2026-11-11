'use client';

import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, ArrowCounterClockwise } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Segmented } from '@/components/segmented';
import { Ring } from '@/components/ring';
import { cn } from '@/components/cn';
import { STATUS_INK, STATUS_BADGE } from '@/components/course';
import {
  courseTcbr,
  emptyPlan,
  sandboxPct,
  statusOf,
  STATUS_LABEL,
  TARGETS,
  type ComponentKey,
  type SandboxPlan,
} from '@/lib/math';
import { summarize, WEEK, type CourseSummary } from '@/lib/insights';
import { useNow } from '@/lib/time';

type DayMark = 'absent' | 'holiday';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAY_HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function ForecastPage() {
  return (
    <DataGate title="Forecast">
      <Forecast />
    </DataGate>
  );
}

function Forecast() {
  const { snapshot, settings, updateSettings } = useStore();
  const now = useNow(60_000);
  const today = useMemo(() => new Date(now), [now]);
  const timetable = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const subjects = useMemo(() => snapshot?.attendance ?? [], [snapshot]);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [marks, setMarks] = useState<Record<string, DayMark>>({});

  const byCode = useMemo(() => {
    const m = new Map<string, CourseSummary>();
    for (const s of subjects) m.set(s.code, summarize(s, settings));
    return m;
  }, [subjects, settings]);

  /** Every day from today to the end of the shown month, with the weekday's classes. */
  const days = useMemo(() => {
    const out: { date: Date; key: string; state: DayMark | 'present'; sunday: boolean; past: boolean }[] = [];
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    for (let d = new Date(month); d <= end; d.setDate(d.getDate() + 1)) {
      const date = new Date(d);
      const sunday = date.getDay() === 0;
      const key = keyOf(date);
      const past = date < startOfToday;
      out.push({ date, key, sunday, past, state: sunday ? 'holiday' : (marks[key] ?? 'present') });
    }
    return out;
  }, [month, marks, today]);

  /**
   * What the rest of the shown month would do to each course: a present day adds
   * an attended class per scheduled period, an absent day a missed one, and a
   * holiday (or Sunday) counts for neither.
   */
  const plans = useMemo(() => {
    const m = new Map<string, SandboxPlan>();
    for (const day of days) {
      if (day.past || day.state === 'holiday') continue;
      const weekday = WEEK[day.date.getDay()];
      for (const p of timetable.find((t) => t.day === weekday)?.periods ?? []) {
        const plan = m.get(p.subjectCode) ?? emptyPlan();
        const k: ComponentKey = p.type ?? 'L';
        if (day.state === 'present') plan[k].attend += 1;
        else plan[k].skip += 1;
        m.set(p.subjectCode, plan);
      }
    }
    return m;
  }, [days, timetable]);

  const projectedOf = (code: string): number | null => {
    const subj = subjects.find((s) => s.code === code);
    const summary = byCode.get(code);
    if (!subj || !summary) return null;
    const plan = plans.get(code);
    if (!plan) return summary.pct;
    return sandboxPct(subj, settings.weights, plan, courseTcbr(code, settings.tcbr));
  };

  const cycle = (day: { key: string; state: DayMark | 'present'; sunday: boolean; past: boolean }) => {
    if (day.past || day.sunday) return;
    setMarks((m) => {
      const next = { ...m };
      if (!next[day.key]) next[day.key] = 'absent';
      else if (next[day.key] === 'absent') next[day.key] = 'holiday';
      else delete next[day.key];
      return next;
    });
  };

  /** Mark every remaining day of the month at once. */
  const markAll = (state: DayMark) =>
    setMarks((m) => {
      const next = { ...m };
      for (const day of days) if (!day.past && !day.sunday) next[day.key] = state;
      return next;
    });

  // Monday-first grid: the blanks before the 1st.
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();


  const target = settings.target;

  return (
    <div className="page-in py-6 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-l">Forecast</h1>
          <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">A simulation, never a record.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-dropout-text">Target</span>
          <Segmented
            label="Target attendance"
            size="sm"
            value={String(target)}
            onChange={(v) => updateSettings({ target: v === '75' ? 75 : 85 })}
            options={TARGETS.map((t) => ({ value: String(t), label: `${t}%` }))}
          />
        </div>
      </div>

      <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <section aria-label="Days">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="press inline-flex h-11 w-11 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              aria-label="Previous month"
            >
              <CaretLeft size={17} aria-hidden />
            </button>
            <p className="title-s text-[17px]" aria-live="polite">
              {MONTHS[month.getMonth()]} {month.getFullYear()}
            </p>
            <button
              type="button"
              className="press inline-flex h-11 w-11 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              aria-label="Next month"
            >
              <CaretRight size={17} aria-hidden />
            </button>
          </div>

          <div className="mt-4">
            <div className="grid grid-cols-7 gap-1.5">
              {DAY_HEADS.map((d, i) => (
                <div key={`${d}-${i}`} className="pb-1 text-center text-[11px] font-medium text-dropout-quiet" aria-hidden>
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1.5" role="group" aria-label={`Days of ${MONTHS[month.getMonth()]}`}>
              {Array.from({ length: lead }, (_, i) => (
                <span key={`lead-${i}`} aria-hidden />
              ))}
              {Array.from({ length: monthDays }, (_, i) => {
                const date = new Date(month.getFullYear(), month.getMonth(), i + 1);
                const key = keyOf(date);
                const sunday = date.getDay() === 0;
                const state = (sunday ? 'holiday' : (marks[key] ?? 'present')) as DayMark | 'present';
                const past = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const isToday = key === keyOf(today);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={state !== 'present'}
                    aria-label={`${i + 1} ${MONTHS[month.getMonth()]}: ${state}`}
                    disabled={past || sunday}
                    onClick={() => cycle({ key, state, sunday, past })}
                    className={cn(
                      'press flex aspect-square items-center justify-center rounded-xl text-[13px] tnum',
                      state === 'present'
                        ? 'text-mark ring-seam'
                        : state === 'holiday'
                          ? 'bg-[#121826] text-dropout-text'
                          : 'bg-[#2a1210] text-red',
                      past && 'opacity-40',
                      isToday && 'ring-2 ring-inset ring-mark',
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-line btn-sm press" onClick={() => markAll('absent')}>
              Mark absent
            </button>
            <button type="button" className="btn btn-line btn-sm press" onClick={() => markAll('holiday')}>
              Mark holiday
            </button>
            <button type="button" className="btn btn-line btn-sm press" onClick={() => setMarks({})}>
              <ArrowCounterClockwise size={14} aria-hidden /> Reset
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-dropout-text">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[4px] ring-seam" aria-hidden /> present
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[4px] bg-[#121826]" aria-hidden /> holiday
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[4px] bg-[#2a1210]" aria-hidden /> absent
            </span>
            <span className="text-dropout-quiet">Tap a day to cycle. Sundays are holidays.</span>
          </div>
        </section>

        <section className="mt-10 lg:mt-0" aria-label="Projected impact">
          <h2 className="title-s">Projected impact</h2>
          <p className="mt-1 text-[13px] text-dropout-text pretty">
            Where each course lands at the end of {MONTHS[month.getMonth()]}, if the rest goes as marked, against the{' '}
            {target}% target.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {subjects.map((s) => {
              const summary = byCode.get(s.code);
              const before = summary?.pct ?? null;
              const after = projectedOf(s.code);
              const status = statusOf(after);
              const delta = before != null && after != null ? after - before : null;
              return (
                <li key={s.code} className="rounded-2xl p-4 ring-seam">
                  <p className="text-[12px] text-dropout-quiet tnum">{s.code}</p>
                  <p className="mt-0.5 text-[15px] font-semibold leading-snug pretty">{summary?.title ?? s.code}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-center">
                      <Ring value={before} tone="text-dropout-text" size={60} stroke={6} />
                      <p className="mt-1 text-[11px] text-dropout-quiet">NOW</p>
                    </div>
                    <div className="text-center">
                      <Ring value={after} tone={status ? STATUS_INK[status] : 'text-dropout'} size={60} stroke={6} />
                      <p className="mt-1 text-[11px] text-dropout-quiet">PROJECTED</p>
                    </div>
                    <p
                      className={cn(
                        'figure text-[20px]',
                        delta == null || delta === 0 ? 'text-dropout-quiet' : delta > 0 ? 'text-cruise' : 'text-red',
                      )}
                    >
                      {delta == null || delta === 0 ? '0%' : `${delta > 0 ? '+' : ''}${delta}%`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="seam-t mt-6 pt-4">
            <p className="text-[12px] font-medium text-dropout-text">If a class is skipped</p>
            <ul className="mt-2 flex flex-col gap-2 text-[12px]">
              {(['safe', 'condonation', 'medical', 'detained'] as const).map((st) => (
                <li key={st} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                      STATUS_BADGE[st],
                    )}
                  >
                    {STATUS_LABEL[st]}
                  </span>
                  <span className="text-dropout-quiet">
                    {st === 'safe' ? '85% and above' : st === 'condonation' ? '75–85%' : st === 'medical' ? '65–75%' : 'below 65%'}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-[#121826] px-2 py-0.5 text-[11px] font-semibold text-dropout-text">
                  NOT COUNTED
                </span>
                <span className="text-dropout-quiet">holidays and Sundays</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

