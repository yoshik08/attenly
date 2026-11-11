'use client';
import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, CalendarBlank } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Segmented } from '@/components/segmented';
import { Ring } from '@/components/ring';
import { Sheet } from '@/components/overlay';
import { MonthCalendar, dayCellClass, dayKey, MONTHS } from '@/components/month-calendar';
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
  /**
   * The projection window ends on the last instruction day when one is set, and
   * on the shown month's end otherwise.
   */
  const windowEnd = useMemo(
    () => (lastInstructionDay ? new Date(`${lastInstructionDay}T00:00:00`) : new Date(month.getFullYear(), month.getMonth() + 1, 0)),
    [lastInstructionDay, month],
  );
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
  const cycle = (day: { key: string; state: DayMark | 'present'; sunday: boolean }) => {
    if (day.sunday) return;
    setMarks((m) => {
      const next = { ...m };
      if (!next[day.key]) next[day.key] = 'absent';
      else if (next[day.key] === 'absent') next[day.key] = 'holiday';
      else delete next[day.key];
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
  // Monday-first grid: the blanks before the 1st.
  const target = settings.target;
  return (
    <div className="page-in py-6 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-l">Forecast</h1>
          <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">A simulation, never a record.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => {
              setPickerMonth(lastInstructionDay ? new Date(`${lastInstructionDay}T00:00:00`) : new Date(today.getFullYear(), today.getMonth(), 1));
              setPickError(null);
              setPicking(true);
            }}
            className="press inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-dropout-text ring-seam hover:text-mark"
          >
            <CalendarBlank size={15} aria-hidden />
            <span className="text-dropout-quiet">Last instruction day</span>
            <span className="font-medium text-mark tnum">{lastInstructionDay ? fmtDay(lastInstructionDay) : 'Month end'}</span>
          </button>
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
      </div>
      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <section aria-label="Days">
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
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={state !== 'present'}
                  aria-label={`${date.getDate()} ${MONTHS[date.getMonth()]}: ${beyond ? 'after the last instruction day' : state}`}
                  disabled={!markable}
                  onClick={() => cycle({ key, state, sunday })}
                  className={cn(
                    dayCellClass,
                    beyond
                      ? 'text-dropout-quiet/40'
                      : state === 'present'
                        ? 'text-mark ring-seam hover:bg-[#121826]'
                        : state === 'holiday'
                          ? 'bg-[#121826] text-dropout-text hover:bg-[#161d2b]'
                          : 'bg-[#2a1210] text-red hover:bg-[#3a1714]',
                    past && 'opacity-40',
                    isToday && 'ring-2 ring-inset ring-mark',
                  )}
                >
                  {date.getDate()}
                </button>
              );
            }}
          />
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
              <span className="h-3 w-3 rounded-full ring-1 ring-inset ring-seam-strong" aria-hidden /> present
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#121826]" aria-hidden /> holiday
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#2a1210]" aria-hidden /> absent
            </span>
            <span className="text-dropout-quiet">
              {lastInstructionDay
                ? `Attendance is taken until ${fmtDay(lastInstructionDay)}. Days after it are left out.`
                : 'Tap a day to cycle. Sundays are holidays.'}
            </span>
          </div>
        </section>
        <section className="mt-10 lg:mt-0" aria-label="Projected impact">
          <h2 className="title-s">Projected impact</h2>
          <p className="mt-1 text-[13px] text-dropout-text pretty">
            Where each course lands through {lastInstructionDay ? fmtDay(lastInstructionDay) : `the end of ${MONTHS[month.getMonth()]}`}, if the rest goes as marked, against the{' '}
            {target}% target.
          </p>
          <ul className="mt-3 seam-t">
            {subjects.map((s) => {
              const summary = byCode.get(s.code);
              const before = summary?.pct ?? null;
              const after = projectedOf(s.code);
              const status = statusOf(after);
              const delta = before != null && after != null ? after - before : null;
              return (
                <li key={s.code} className="seam-b flex items-center gap-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{summary?.title ?? s.code}</p>
                    <p className="mt-0.5 truncate text-[11px] text-dropout-quiet tnum">{s.code}</p>
                  </div>
                  <span className="shrink-0">
                    <span className="sr-only">now</span>
                    <Ring value={before} tone="text-dropout-text" size={52} stroke={5} />
                  </span>
                  <ArrowRight size={12} className="shrink-0 text-dropout-quiet" aria-hidden />
                  <span className="shrink-0">
                    <span className="sr-only">projected</span>
                    <Ring value={after} tone={status ? STATUS_INK[status] : 'text-dropout'} size={52} stroke={5} />
                  </span>
                  <span
                    className={cn(
                      'figure w-[42px] shrink-0 text-right text-[15px]',
                      delta == null || delta === 0 ? 'text-dropout-quiet' : delta > 0 ? 'text-cruise' : 'text-red',
                    )}
                  >
                    {delta == null || delta === 0 ? '0%' : `${delta > 0 ? '+' : ''}${delta}%`}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="seam-t mt-4 pt-3">
            <p className="text-[11px] font-medium text-dropout-text">If a class is skipped</p>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              {(['safe', 'condonation', 'medical', 'detained'] as const).map((st) => (
                <li key={st} className="flex items-center gap-1.5">
                  <span className={cn('rounded-full px-1.5 py-0.5 font-semibold ring-1 ring-inset', STATUS_BADGE[st])}>
                    {STATUS_LABEL[st]}
                  </span>
                  <span className="text-dropout-quiet">
                    {st === 'safe' ? '85%+' : st === 'condonation' ? '75–85' : st === 'medical' ? '65–75' : 'under 65'}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span className="rounded-full bg-[#121826] px-1.5 py-0.5 font-semibold text-dropout-text">NOT COUNTED</span>
                <span className="text-dropout-quiet">holidays</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
      <Sheet open={picking} onClose={() => setPicking(false)} title="Last instruction day">
        <p className="text-[13px] text-dropout-text pretty">
          The last day attendance is taken. The forecast stops here instead of running to the end of the month.
        </p>
        <div className="mt-4">
          <MonthCalendar
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
                    picked ? 'bg-mark text-black' : 'text-mark hover:bg-[#121826]',
                    !picked && date < startOfToday && 'text-dropout-quiet',
                    isToday && !picked && 'ring-2 ring-inset ring-mark',
                  )}
                >
                  {date.getDate()}
                </button>
              );
            }}
          />
        </div>
        {pickError && (
          <p role="alert" className="mt-3 text-[13px] text-red">
            {pickError}
          </p>
        )}
        <div className="seam-t mt-4 flex items-center justify-between gap-3 pt-3">
          <button type="button" className="press rounded-full px-2 py-1 text-[13px] text-dropout-text hover:text-mark" onClick={() => void clearDay()}>
            Use month end
          </button>
          <button type="button" className="btn btn-line btn-sm press" onClick={() => setPicking(false)}>
            Close
          </button>
        </div>
      </Sheet>
    </div>
  );
}
