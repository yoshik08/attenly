'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, CalendarBlank, Check, Minus, X } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { DayStrip, defaultDayOf, FULL_DAY, nextDateOf, WEEK_ORDER } from '@/components/day-strip';
import { Empty, Footnote, PageHeader, TermLine } from '@/components/page';
import { Ring } from '@/components/ring';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, courseTcbr, emptyPlan, sandboxPct, statusOf, type ComponentKey, type SandboxPlan } from '@/lib/math';
import { clockOf, courseTitle, sortPeriods, summarize, WEEK, type CourseSummary } from '@/lib/insights';
import type { TimetablePeriod } from '@/lib/erp/parsers';
import { termText } from '@/lib/terms';
import { useNow } from '@/lib/time';

type Decision = 'attended' | 'bunk' | 'not-conducted';

const CHOICES: { value: Decision; label: string; Icon: typeof Check; on: string }[] = [
  { value: 'attended', label: 'Attended', Icon: Check, on: 'bg-fg text-black' },
  { value: 'bunk', label: 'Bunk', Icon: X, on: 'bg-det text-black' },
  { value: 'not-conducted', label: 'Not conducted', Icon: Minus, on: 'bg-raised-2 text-fg shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]' },
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

/** A decision belongs to one period of one day. */
function slotKey(day: string, p: TimetablePeriod) {
  return `${day}|${p.period}|${p.subjectCode}`;
}

function PlanTheDay() {
  const { snapshot, settings } = useStore();
  const now = useNow(60_000);
  const date = useMemo(() => new Date(now), [now]);
  const timetable = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const subjects = useMemo(() => snapshot?.attendance ?? [], [snapshot]);
  const days = useMemo(
    () => WEEK_ORDER.filter((d) => (timetable.find((t) => t.day === d)?.periods.length ?? 0) > 0),
    [timetable],
  );
  const byCode = useMemo(() => {
    const m = new Map<string, CourseSummary>();
    for (const s of subjects) m.set(s.code, summarize(s, settings));
    return m;
  }, [subjects, settings]);

  const today = WEEK[date.getDay()];
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : defaultDayOf(days, date);

  // Opened from Up next for a given day: ?day=Fri
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('day');
    // Read once after hydration; the server render can't see the query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q && WEEK_ORDER.includes(q)) setPicked(q);
  }, []);

  const periods = useMemo(() => sortPeriods(timetable.find((t) => t.day === day)?.periods ?? []), [timetable, day]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  // What the day would add, per course, as a what-if plan (in memory only).
  const plans = useMemo(() => {
    const m = new Map<string, SandboxPlan>();
    for (const p of periods) {
      const d = decisions[slotKey(day, p)];
      if (!d || d === 'not-conducted') continue;
      const plan = m.get(p.subjectCode) ?? emptyPlan();
      const k: ComponentKey = p.type ?? 'L';
      if (d === 'attended') plan[k].attend += 1;
      else plan[k].skip += 1;
      m.set(p.subjectCode, plan);
    }
    return m;
  }, [periods, decisions, day]);

  /** The course's percentage once the day's plan is applied. */
  const afterFor = (code: string): number | null => {
    const subj = subjects.find((s) => s.code === code);
    const summary = byCode.get(code);
    if (!subj || !summary) return null;
    const plan = plans.get(code);
    if (!plan) return summary.pct;
    return sandboxPct(subj, settings.weights, plan, courseTcbr(code, settings.tcbr));
  };

  const decided = periods.filter((p) => decisions[slotKey(day, p)]).length;
  const resetDay = () =>
    setDecisions((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${day}|`))));
  const term = termText(snapshot?.term);

  if (days.length === 0) {
    return (
      <section className="page-in">
        <PageHeader title="Plan the day" sub={<TermLine term={term} />} />
        <Empty icon={CalendarBlank} title="The ERP has no timetable for this semester.">
          A day can be planned here once your department publishes the timetable.{' '}
          <Link href="/settings#semester" className="link">
            Look at another semester
          </Link>
        </Empty>
      </section>
    );
  }

  const dayDate = nextDateOf(day, date);

  return (
    <div className="page-in">
      <PageHeader title="Plan the day" sub={<TermLine term={term} />} />
      <DayStrip className="mt-6" label="Day to plan" days={days} value={day} onChange={setPicked} now={date} />

      {/* Every course, at a glance: the strip answers the plan as it changes. */}
      <div className="material sticky top-[calc(var(--bar-h)+var(--safe-t))] z-30 -mx-4 mt-5 px-4 py-3 sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-12 lg:px-12">
        <ul
          tabIndex={0}
          className="-mx-4 flex gap-2 overflow-x-auto rounded-[18px] px-4 no-bar sm:mx-0 sm:px-0 lg:flex-wrap"
          aria-label="Courses and the percentage each would have"
        >
          {subjects.map((s) => {
            const summary = byCode.get(s.code);
            const after = afterFor(s.code);
            const status = statusOf(after);
            const changed = !!summary && after != null && summary.pct != null && after !== summary.pct;
            return (
              <li
                key={s.code}
                data-tone={changed ? (after! > summary!.pct! ? 'safe' : 'detained') : 'none'}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-[18px] bg-surface py-2 pl-2 pr-3.5 hair transition-shadow',
                  changed && 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--tone)_45%,transparent)]',
                )}
              >
                <Ring value={after} tone={status} target={settings.target} size={46} stroke={4.5} />
                <span className="min-w-0">
                  <span className="mono block text-[11.5px] text-fg-3">{s.code}</span>
                  <span className="block max-w-[150px] truncate text-[13px] font-semibold">{summary?.title ?? s.code}</span>
                  {changed && <span className="block text-[11.5px] font-semibold text-tone tnum">was {summary.pct}%</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="h2">
          {FULL_DAY[day]}{' '}
          <span className="font-sans text-[15px] font-medium tracking-normal text-fg-3">
            {dayDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            {day === today ? ' · today' : ''}
          </span>
        </h2>
        <p className="flex items-center gap-3 text-[13px] text-fg-3 tnum">
          {decided} of {periods.length} planned
          {decided > 0 && (
            <button type="button" className="btn btn-ghost btn-sm press !min-h-8 !px-3" onClick={resetDay}>
              <ArrowCounterClockwise size={14} aria-hidden /> Reset the day
            </button>
          )}
        </p>
      </div>

      <ol className="mt-3 flex flex-col gap-2">
        {periods.map((p, i) => {
          const key = slotKey(day, p);
          const choice = decisions[key];
          const summary = byCode.get(p.subjectCode);
          const name = summary?.title ?? courseTitle(p.subjectTitle, p.subjectCode);
          const after = afterFor(p.subjectCode);
          const changed = summary?.pct != null && after != null && after !== summary.pct;
          return (
            <li
              key={key}
              data-tone={choice === 'bunk' ? 'detained' : choice === 'attended' ? 'safe' : 'none'}
              className="card rise p-3.5 sm:p-4"
              style={{ '--i': i } as React.CSSProperties}
            >
              <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 lg:grid-cols-[64px_minmax(0,1fr)_auto_auto] lg:gap-x-5">
                <div>
                  <span className="figure block text-[22px] leading-none">{p.period.replace(/\D/g, '')}</span>
                  <span className="mono mt-1 block text-[11px] text-fg-3">{clockOf(p.start).split(' ')[0]}</span>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold leading-snug">{name}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-fg-2">
                    {typeLabel(p)}
                    {p.room ? ` · ${p.room}` : ''} · <span className="mono text-fg-3">{p.subjectCode}</span>
                  </p>
                </div>

                <span className="flex items-center justify-end gap-1.5 text-[13px] tnum">
                  {summary?.pct != null ? (
                    <>
                      <span className={changed ? 'text-fg-3' : 'font-semibold text-fg'}>{summary.pct}%</span>
                      {changed && (
                        <>
                          <ArrowRight size={12} className="text-fg-3" aria-hidden />
                          <span data-tone={statusOf(after) ?? 'none'} className="font-semibold text-tone">
                            {after}%
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-fg-3">—</span>
                  )}
                </span>

                <div
                  className="col-span-3 flex gap-1 rounded-[14px] bg-black/40 p-1 hair lg:col-span-1 lg:inline-flex"
                  role="group"
                  aria-label={`${name}, period ${p.period.replace(/\D/g, '')}`}
                >
                  <Choices choice={choice} onPick={(v) => setDecisions((d) => toggle(d, key, v))} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Footnote>
        A planner only: attended, bunked and not-conducted periods change the percentages above, never your recorded
        attendance. “Not conducted” counts for neither side.
      </Footnote>
    </div>
  );
}

function toggle(d: Record<string, Decision>, key: string, v: Decision) {
  const next = { ...d };
  if (next[key] === v) delete next[key];
  else next[key] = v;
  return next;
}

function Choices({ choice, onPick }: { choice: Decision | undefined; onPick: (v: Decision) => void }) {
  return (
    <>
      {CHOICES.map((c) => {
        const on = choice === c.value;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(c.value)}
            className={cn(
              'press inline-flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-2 text-[12.5px] font-semibold lg:h-9 lg:flex-none lg:px-3',
              on ? c.on : 'text-fg-2 hover:bg-white/[0.06] hover:text-fg',
            )}
          >
            <c.Icon size={13} weight="bold" aria-hidden className="hidden sm:block" />
            {c.label}
          </button>
        );
      })}
    </>
  );
}
