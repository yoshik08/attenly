'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MapPin, ArrowCounterClockwise } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Segmented } from '@/components/segmented';
import { Figure } from '@/components/motion';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, courseTcbr, emptyPlan, fmtPct, sandboxPct, statusOf, type ComponentKey, type SandboxPlan } from '@/lib/math';
import { STATUS_INK } from '@/components/course';
import { summarize, WEEK, type CourseSummary } from '@/lib/insights';
import type { TimetablePeriod } from '@/lib/erp/parsers';
import { termText } from '@/lib/terms';
import { useNow } from '@/lib/time';

const ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

type Decision = 'attended' | 'bunk' | 'not-conducted';

const CHOICES: { value: Decision; label: string; on: string }[] = [
  { value: 'attended', label: 'Attended', on: 'bg-mark text-black' },
  { value: 'bunk', label: 'Bunk', on: 'bg-[#2a1210] text-red ring-1 ring-inset ring-[#ff6b5e]/55' },
  { value: 'not-conducted', label: 'Not conducted', on: 'bg-[#121826] text-mark' },
];

export default function PlanTheDayPage() {
  return (
    <DataGate title="Plan the day">
      <PlanTheDay />
    </DataGate>
  );
}

function typeLabel(p: TimetablePeriod) {
  return p.type ? COMPONENT_LABELS[p.type] : 'Class';
}

function slotKey(p: TimetablePeriod) {
  return `${p.period}|${p.subjectCode}`;
}

function PlanTheDay() {
  const { snapshot, settings } = useStore();
  const now = useNow(60_000);
  const timetable = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const subjects = useMemo(() => snapshot?.attendance ?? [], [snapshot]);
  const days = useMemo(
    () => ORDER.filter((d) => (timetable.find((t) => t.day === d)?.periods.length ?? 0) > 0),
    [timetable],
  );
  const byCode = useMemo(() => {
    const m = new Map<string, CourseSummary>();
    for (const s of subjects) m.set(s.code, summarize(s, settings));
    return m;
  }, [subjects, settings]);

  const today = WEEK[new Date(now).getDay()];
  const defaultDay = useMemo(() => {
    if (days.includes(today)) return today;
    const start = ORDER.indexOf(today);
    for (let i = 1; i <= 7; i++) {
      const d = ORDER[(start + i) % 7];
      if (days.includes(d)) return d;
    }
    return days[0] ?? 'Mon';
  }, [days, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : defaultDay;

  const periods = useMemo(() => timetable.find((t) => t.day === day)?.periods ?? [], [timetable, day]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  // What the day would add, per course, as a what-if plan (in memory only).
  const plans = useMemo(() => {
    const m = new Map<string, SandboxPlan>();
    for (const p of periods) {
      const d = decisions[slotKey(p)];
      if (!d || d === 'not-conducted') continue;
      const plan = m.get(p.subjectCode) ?? emptyPlan();
      const k: ComponentKey = p.type ?? 'L';
      if (d === 'attended') plan[k].attend += 1;
      else plan[k].skip += 1;
      m.set(p.subjectCode, plan);
    }
    return m;
  }, [periods, decisions]);

  /** The course's percentage once the day's plan is applied. */
  const afterFor = (code: string): number | null => {
    const subj = subjects.find((s) => s.code === code);
    const summary = byCode.get(code);
    if (!subj || !summary) return null;
    const plan = plans.get(code);
    if (!plan) return summary.pct;
    return sandboxPct(subj, settings.weights, plan, courseTcbr(code, settings.tcbr));
  };

  const decided = periods.filter((p) => decisions[slotKey(p)]).length;

  if (days.length === 0) {
    return (
      <section className="page-in py-8">
        <h1 className="title-l">Plan the day</h1>
        <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">{termText(snapshot?.term)}</p>
        <p className="mt-8 text-[15px] font-semibold">The ERP has no timetable for this semester.</p>
        <p className="mt-1 text-[13px] text-dropout-text">
          A day can be planned here once your department publishes the timetable.{' '}
          <Link href="/settings#semester" className="underline decoration-seam-strong hover:text-mark">
            Look at another semester
          </Link>
        </p>
      </section>
    );
  }


  return (
    <div className="page-in py-6 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-l">Plan the day</h1>
          <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">
            {termText(snapshot?.term)}{' '}
            <Link href="/settings#semester" className="ml-1 rounded font-medium text-dropout-text underline decoration-seam-strong hover:text-mark">
              Change
            </Link>
          </p>
        </div>
      </div>

      <div className="-mx-4 mt-5 overflow-x-auto px-4 pb-1">
        <Segmented
          label="Day to plan"
          value={day}
          onChange={setPicked}
          options={days.map((d) => ({ value: d, label: d, hint: d === today ? `${FULL[d]} (today)` : FULL[d] }))}
          size="sm"
        />
      </div>

      {/* Every course, at a glance: the strip answers the plan as it changes. */}
      <div className="seam-b mt-5 pb-4">
        <ul className="flex flex-wrap gap-2" aria-label="Courses and the percentage each would have">
          {subjects.map((s) => {
            const summary = byCode.get(s.code);
            const after = afterFor(s.code);
            const status = statusOf(after);
            const changed = !!summary && after != null && summary.pct != null && after !== summary.pct;
            return (
              <li key={s.code} className="flex items-baseline gap-1.5 rounded-full px-3 py-1.5 ring-seam">
                <span className="text-[12px] text-dropout-text tnum">{s.code}</span>
                {after == null ? (
                  <span className="figure text-[15px] text-dropout-quiet">—</span>
                ) : (
                  <Figure value={after} className={cn('figure text-[15px]', status ? STATUS_INK[status] : 'text-dropout-quiet')} />
                )}
                {changed && <span className="text-[11px] text-dropout-quiet tnum">was {fmtPct(summary.pct)}</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="title-s mt-6">
          {FULL[day]}
          {day === today && <span className="ml-2 text-[13px] font-medium text-dropout-text">today</span>}
        </h2>
        {decided > 0 && (
          <button
            type="button"
            className="press inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-dropout-text hover:text-mark"
            onClick={() => setDecisions({})}
          >
            <ArrowCounterClockwise size={14} aria-hidden /> Reset the day
          </button>
        )}
      </div>

      <ol className="mt-4 flex flex-col gap-3">
        {periods.map((p) => {
          const key = slotKey(p);
          const choice = decisions[key];
          const summary = byCode.get(p.subjectCode);
          return (
            <li key={key} className="rounded-2xl p-4 ring-seam">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] text-dropout-quiet tnum">
                    {p.start ? `${p.start}${p.end ? `–${p.end}` : ''}` : p.period.replace(/^P/, 'Period ')}
                    <span className="mx-1.5" aria-hidden>
                      ·
                    </span>
                    {typeLabel(p)}
                    {p.room && (
                      <span className="ml-1.5 inline-flex items-center gap-1">
                        <MapPin size={12} aria-hidden /> {p.room}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[16px] font-semibold leading-snug">
                    {summary?.title ?? (p.subjectTitle || p.subjectCode)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-dropout-quiet tnum">
                    {p.subjectCode}
                    {summary?.pct != null && ` · now ${fmtPct(summary.pct)}`}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={`${summary?.title ?? p.subjectCode}, ${p.period}`}>
                {CHOICES.map((c) => {
                  const on = choice === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setDecisions((d) => {
                          const next = { ...d };
                          if (on) delete next[key];
                          else next[key] = c.value;
                          return next;
                        })
                      }
                      className={cn(
                        'press min-h-11 whitespace-nowrap rounded-full px-1.5 text-[12px] font-semibold',
                        on ? c.on : 'ring-seam text-dropout-text hover:text-mark',
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 text-[12px] text-dropout-quiet pretty">
        A planner only: attended, bunked and not-conducted periods change the percentages above, never your recorded
        attendance. “Not conducted” counts for neither side.
      </p>
    </div>
  );
}

