'use client';

import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, CalendarBlank } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Segmented } from '@/components/segmented';
import { Ring } from '@/components/ring';
import { Sheet } from '@/components/overlay';
import { Band } from '@/components/course';
import { Footnote, PageHeader } from '@/components/page';
import { MonthCalendar, dayCellClass, dayKey, MONTHS } from '@/components/month-calendar';
import { cn } from '@/components/cn';
import { courseTcbr, emptyPlan, sandboxPct, statusOf, TARGETS, type ComponentKey, type SandboxPlan } from '@/lib/math';
import { summarize, WEEK, type CourseSummary } from '@/lib/insights';
import { useNow } from '@/lib/time';

type DayMark = 'absent' | 'holiday';

export default function ForecastPage() {
  return (
    <DataGate title="Forecast">
      <Forecast />
    </DataGate>
  );
}

function Forecast() {
  const { snapshot, settings, updateSettings, lastInstructionDay, setLastInstructionDay } = useStore();
  const now = useNow(60_000);
  const today = useMemo(() => new Date(now), [now]);
  const timetable = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const subjects = useMemo(() => snapshot?.attendance ?? [], [snapshot]);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [marks, setMarks] = useState<Record<string, DayMark>>({});
  const [picking, setPicking] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [pickError, setPickError] = useState<string | null>(null);
  const byCode = useMemo(() => {
    const m = new Map<string, CourseSummary>();
    for (const s of subjects) m.set(s.code, summarize(s, settings));
    return m;
  }, [subjects, settings]);
  const startOfToday = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()), [today]);
  /** Periods per weekday, for the dots under each day. */
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of timetable) m.set(d.day, d.periods.length);
    return m;
  }, [timetable]);

  /**
   * The projection window ends on the last instruction day when one is set, and
   * on the shown month's end otherwise (never before this month's end).
   */
  const windowEnd = useMemo(() => {
    if (lastInstructionDay) return new Date(`${lastInstructionDay}T00:00:00`);
    const shown = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return shown < thisMonth ? thisMonth : shown;
  }, [lastInstructionDay, month, today]);

  /** Every day the projection covers: today through the window's end. */
  const days = useMemo(() => {
    const out: { date: Date; key: string; state: DayMark | 'present'; sunday: boolean }[] = [];
    if (Number.isNaN(windowEnd.getTime())) return out;
    for (let d = new Date(startOfToday); d <= windowEnd; d.setDate(d.getDate() + 1)) {
      const date = new Date(d);
      const sunday = date.getDay() === 0;
      out.push({ date, key: dayKey(date), sunday, state: sunday ? 'holiday' : (marks[dayKey(date)] ?? 'present') });
    }
    return out;
  }, [startOfToday, windowEnd, marks]);

  /**
   * What the window would do to each course: a present day adds an attended
   * class per scheduled period, an absent day a missed one, and a holiday (or
   * Sunday) counts for neither.
   */
  const plans = useMemo(() => {
    const m = new Map<string, SandboxPlan>();
    for (const day of days) {
      if (day.state === 'holiday') continue;
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

  const cycle = (key: string, sunday: boolean) => {
    if (sunday) return;
    setMarks((m) => {
      const next = { ...m };
      if (!next[key]) next[key] = 'absent';
      else if (next[key] === 'absent') next[key] = 'holiday';
      else delete next[key];
      return next;
    });
  };
  /** Mark every day of the window at once. */
  const markAll = (state: DayMark) =>
    setMarks((m) => {
      const next = { ...m };
      for (const day of days) if (!day.sunday) next[day.key] = state;
      return next;
    });
  /** A day can be marked only inside the window: attendance stops at its end. */
  const inWindow = (date: Date) => date >= startOfToday && date <= windowEnd;

  const pickDay = async (key: string) => {
    setPickError(null);
    const res = await setLastInstructionDay(key);
    if (!res.ok) setPickError(res.error ?? 'Could not save that date.');
    else setPicking(false);
  };
  const clearDay = async () => {
    setPickError(null);
    const res = await setLastInstructionDay(null);
    if (!res.ok) setPickError(res.error ?? 'Could not save that.');
    else setPicking(false);
  };
  const fmtDay = (key: string) =>
    new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const target = settings.target;
  const counted = days.filter((d) => d.state !== 'holiday' && (perDay.get(WEEK[d.date.getDay()]) ?? 0) > 0);
  const absent = counted.filter((d) => d.state === 'absent').length;
  const endLabel = lastInstructionDay ? fmtDay(lastInstructionDay) : `the end of ${MONTHS[windowEnd.getMonth()]}`;

  return (
    <div className="page-in">
      <PageHeader
        title="Forecast"
        sub="A simulation, never a record."
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setPickerMonth(lastInstructionDay ? new Date(`${lastInstructionDay}T00:00:00`) : new Date(today.getFullYear(), today.getMonth(), 1));
                setPickError(null);
                setPicking(true);
              }}
              className="press inline-flex h-10 items-center gap-2 rounded-full bg-raised px-3.5 text-[13px] text-fg-2 hair hover:bg-raised-2"
            >
              <CalendarBlank size={16} aria-hidden />
              <span>Last instruction day</span>
              <span className="font-semibold text-fg tnum">{lastInstructionDay ? fmtDay(lastInstructionDay) : 'Month end'}</span>
            </button>
            <Segmented
              label="Target attendance"
              size="sm"
              value={String(target)}
              onChange={(v) => updateSettings({ target: v === '75' ? 75 : 85 })}
              options={TARGETS.map((t) => ({ value: String(t), label: `${t}%` }))}
            />
          </>
        }
      />

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <section aria-label="Days" className="card self-start p-4 sm:p-6">
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            label={`Days of ${MONTHS[month.getMonth()]}`}
            renderDay={(date) => {
              const key = dayKey(date);
              const sunday = date.getDay() === 0;
              const state = (sunday ? 'holiday' : (marks[key] ?? 'present')) as DayMark | 'present';
              const beyond = date > windowEnd;
              const markable = inWindow(date) && !sunday;
              const past = date < startOfToday;
              const isToday = key === dayKey(today);
              const classes = sunday ? 0 : (perDay.get(WEEK[date.getDay()]) ?? 0);
              const live = !beyond && !past;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={state !== 'present'}
                  aria-label={`${date.getDate()} ${MONTHS[date.getMonth()]}: ${beyond ? 'after the last instruction day' : state}`}
                  disabled={!markable}
                  onClick={() => cycle(key, sunday)}
                  className={cn(
                    dayCellClass,
                    'gap-1',
                    !live
                      ? 'text-fg-3/50'
                      : state === 'present'
                        ? 'bg-surface text-fg hair hover:bg-raised'
                        : state === 'holiday'
                          ? 'hatch text-fg-3'
                          : 'bg-det/16 text-det hover:bg-det/24',
                    past && 'opacity-50',
                    isToday && '!shadow-[inset_0_0_0_2px_#f5f5f7]',
                  )}
                >
                  {date.getDate()}
                  {live && state !== 'holiday' && classes > 0 && (
                    <span className="flex gap-[2.5px]" aria-hidden>
                      {Array.from({ length: Math.min(classes, 6) }, (_, i) => (
                        <span key={i} className={cn('h-[4px] w-[4px] shrink-0 rounded-full', state === 'absent' ? 'bg-det' : 'bg-fg/55')} />
                      ))}
                    </span>
                  )}
                </button>
              );
            }}
          />
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary btn-sm press" onClick={() => markAll('absent')}>
              Mark absent
            </button>
            <button type="button" className="btn btn-secondary btn-sm press" onClick={() => markAll('holiday')}>
              Mark holiday
            </button>
            <button type="button" className="btn btn-ghost btn-sm press" onClick={() => setMarks({})}>
              <ArrowCounterClockwise size={14} aria-hidden /> Reset
            </button>
          </div>
          <ul className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-fg-2" aria-label="How to read the days">
            <li className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-[5px] bg-surface hair" aria-hidden /> present
            </li>
            <li className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-[5px] bg-det/30" aria-hidden /> absent
            </li>
            <li className="inline-flex items-center gap-2">
              <span className="hatch h-3.5 w-3.5 rounded-[5px] hair" aria-hidden /> holiday
            </li>
            <li className="text-fg-3">
              {lastInstructionDay
                ? `Attendance is taken until ${fmtDay(lastInstructionDay)}. Days after it are left out.`
                : 'Tap a day to cycle. Sundays are holidays.'}
            </li>
          </ul>
        </section>

        <section aria-label="Projected impact">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="h2">Projected impact</h2>
            <p className="text-[13px] text-fg-3 tnum">
              {counted.length} class {counted.length === 1 ? 'day' : 'days'}
              {absent > 0 ? ` · ${absent} absent` : ''}
            </p>
          </div>
          <p className="mt-1.5 text-[14px] text-fg-2 pretty">
            Where each course lands through {endLabel}, if the rest goes as marked, against the {target}% target.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {subjects.map((s, i) => {
              const summary = byCode.get(s.code);
              const before = summary?.pct ?? null;
              const after = projectedOf(s.code);
              const status = statusOf(after);
              const delta = before != null && after != null ? after - before : null;
              return (
                <li key={s.code} data-tone={status ?? 'none'} className="card rise flex items-center gap-3 p-3.5 sm:p-4" style={{ '--i': i } as React.CSSProperties}>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{summary?.title ?? s.code}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="mono text-[11.5px] text-fg-3">{s.code}</span>
                      <Band status={status} className="!text-[10px]" />
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-col items-center gap-1">
                    <Ring value={before} tone={null} target={target} size={52} stroke={5} />
                    <span className="text-[10.5px] font-semibold text-fg-3">Now</span>
                  </span>
                  <ArrowRight size={13} className="mb-4 shrink-0 text-fg-3" aria-hidden />
                  <span className="flex shrink-0 flex-col items-center gap-1">
                    <Ring value={after} tone={status} target={target} size={52} stroke={5} />
                    <span className="text-[10.5px] font-semibold text-fg-3">Projected</span>
                  </span>
                  <span
                    data-tone={delta == null || delta === 0 ? 'none' : delta > 0 ? 'safe' : 'detained'}
                    className="figure mb-4 w-[46px] shrink-0 text-right text-[16px] text-tone"
                  >
                    {delta == null || delta === 0 ? '0%' : `${delta > 0 ? '+' : ''}${delta}%`}
                  </span>
                </li>
              );
            })}
          </ul>
          <Footnote className="mt-5">
            Bands: safe 85% and up, condonation 75–85, medical certificate and condonation 65–75, detained under 65.
            Holidays and Sundays count for neither side.
          </Footnote>
        </section>
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Last instruction day">
        <p className="text-[14px] text-fg-2 pretty">
          The last day attendance is taken. The forecast stops here instead of running to the end of the month.
        </p>
        <MonthCalendar
          className="mt-5"
          month={pickerMonth}
          onMonthChange={setPickerMonth}
          label="Pick the last instruction day"
          renderDay={(date) => {
            const key = dayKey(date);
            const picked = key === lastInstructionDay;
            const isToday = key === dayKey(today);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={picked}
                aria-label={`${date.getDate()} ${MONTHS[date.getMonth()]}`}
                onClick={() => void pickDay(key)}
                className={cn(
                  dayCellClass,
                  picked ? 'bg-fg text-black' : 'text-fg hover:bg-raised',
                  !picked && date < startOfToday && 'text-fg-3',
                  isToday && !picked && 'shadow-[inset_0_0_0_2px_#f5f5f7]',
                )}
              >
                {date.getDate()}
              </button>
            );
          }}
        />
        {pickError && (
          <p role="alert" className="mt-3 text-[13px] text-det">
            {pickError}
          </p>
        )}
        <div className="mt-5 flex items-center justify-between gap-3 hair-t pt-4">
          <button type="button" className="btn btn-ghost btn-sm press" onClick={() => void clearDay()}>
            Use month end
          </button>
          <button type="button" className="btn btn-secondary btn-sm press" onClick={() => setPicking(false)}>
            Close
          </button>
        </div>
      </Sheet>
    </div>
  );
}
