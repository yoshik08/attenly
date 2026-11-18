'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { defaultDayOf, FULL_DAY, WEEK_ORDER } from '@/components/day-strip';
import { Empty, PageHeader, TermLine } from '@/components/page';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, type ComponentKey, type Status } from '@/lib/math';
import { clockOf, courseTitle, endOf, minutesOf, periodOrder, sortPeriods, startOf, summarize, WEEK, type CourseSummary } from '@/lib/insights';
import { courseHues } from '@/lib/hues';
import type { TimetableDay, TimetablePeriod } from '@/lib/erp/parsers';
import { useNow } from '@/lib/time';
import { termText } from '@/lib/terms';

export default function TimetablePage() {
  return (
    <DataGate title="Timetable">
      <Timetable />
    </DataGate>
  );
}

/* ------------------------------------------------------------------ */
/* Shaping the week                                                    */
/* ------------------------------------------------------------------ */

/** Back-to-back periods of the same class, drawn as one block. */
interface Block {
  day: string;
  code: string;
  type: ComponentKey | null;
  room: string;
  from: number;
  to: number;
  periods: TimetablePeriod[];
}

type Row = { kind: 'period'; n: number; sample: TimetablePeriod } | { kind: 'gap'; after: number };

function blocksOf(day: string, periods: TimetablePeriod[]): Block[] {
  const out: Block[] = [];
  for (const p of sortPeriods(periods)) {
    const n = periodOrder(p);
    const last = out[out.length - 1];
    if (last && last.code === p.subjectCode && last.type === p.type && last.room === p.room && n === last.to + 1) {
      last.to = n;
      last.periods.push(p);
    } else {
      out.push({ day, code: p.subjectCode, type: p.type, room: p.room, from: n, to: n, periods: [p] });
    }
  }
  return out;
}

const slotId = (day: string, p: TimetablePeriod) => `slot-${day}-${p.period}`;
const typeLabel = (t: ComponentKey | null) => (t ? COMPONENT_LABELS[t] : 'Class');
const range = (b: { from: number; to: number }) => (b.to > b.from ? `${b.from}–${b.to}` : `${b.from}`);

/** The most you can skip, or the fewest you must attend, for one course. */
function budgetShort(s: CourseSummary | undefined, target: number): string | null {
  if (!s || s.pct == null) return null;
  if (s.pct >= target) {
    let spare: number | null = null;
    for (const c of s.components) {
      const v = c.budget?.spare;
      if (v != null && Number.isFinite(v) && (spare == null || v > spare)) spare = v;
    }
    return spare ? `${spare} to spare` : 'none to spare';
  }
  let need: number | null = null;
  for (const c of s.components) {
    const v = c.budget?.needed;
    if (v != null && Number.isFinite(v) && v > 0 && (need == null || v < need)) need = v;
  }
  return need != null ? `attend ${need}` : 'out of reach';
}

/** This week's dates, Monday first (on a Sunday, the week ahead). */
function weekDates(now: Date): Map<string, Date> {
  const back = now.getDay() === 0 ? -1 : (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  return new Map(WEEK_ORDER.map((d, i) => [d, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)]));
}

interface Course {
  code: string;
  title: string;
  hue: number;
  pct: number | null;
  status: Status | null;
  budget: string | null;
  perWeek: number;
}

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

function Timetable() {
  const { snapshot, settings } = useStore();
  const now = useNow(60_000);
  const date = useMemo(() => new Date(now), [now]);
  const timetable: TimetableDay[] = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const days = useMemo(
    () => WEEK_ORDER.filter((d) => (timetable.find((t) => t.day === d)?.periods.length ?? 0) > 0),
    [timetable],
  );
  const summaries = useMemo(() => {
    const m = new Map<string, CourseSummary>();
    for (const s of snapshot?.attendance ?? []) m.set(s.code, summarize(s, settings));
    return m;
  }, [snapshot, settings]);

  const all = useMemo(() => timetable.flatMap((d) => d.periods), [timetable]);
  const hues = useMemo(() => courseHues(all.map((p) => p.subjectCode)), [all]);
  const courses: Course[] = useMemo(() => {
    const seen = new Map<string, Course>();
    for (const p of all) {
      const c = seen.get(p.subjectCode);
      if (c) {
        c.perWeek++;
        continue;
      }
      const s = summaries.get(p.subjectCode);
      seen.set(p.subjectCode, {
        code: p.subjectCode,
        title: s?.title ?? courseTitle(p.subjectTitle, p.subjectCode),
        hue: hues.get(p.subjectCode) ?? 260,
        pct: s?.pct ?? null,
        status: s?.status ?? null,
        budget: budgetShort(s, settings.target),
        perWeek: 1,
      });
    }
    return [...seen.values()].sort((a, b) => b.perWeek - a.perWeek || a.title.localeCompare(b.title));
  }, [all, summaries, hues, settings.target]);
  const byCode = useMemo(() => new Map(courses.map((c) => [c.code, c])), [courses]);

  /** Every period number the week uses, with a gap row wherever numbers skip (a break). */
  const rows: Row[] = useMemo(() => {
    const samples = new Map<number, TimetablePeriod>();
    for (const p of all) {
      const n = periodOrder(p);
      const known = samples.get(n);
      if (!known || (!known.start && p.start)) samples.set(n, p);
    }
    const nums = [...samples.keys()].sort((a, b) => a - b);
    const out: Row[] = [];
    nums.forEach((n, i) => {
      if (i > 0 && n - nums[i - 1] > 1) out.push({ kind: 'gap', after: nums[i - 1] });
      out.push({ kind: 'period', n, sample: samples.get(n)! });
    });
    return out;
  }, [all]);

  const blocksByDay = useMemo(() => {
    const m = new Map<string, Block[]>();
    for (const d of days) m.set(d, blocksOf(d, timetable.find((t) => t.day === d)?.periods ?? []));
    return m;
  }, [days, timetable]);

  const today = WEEK[date.getDay()];
  const dates = useMemo(() => weekDates(date), [date]);
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : defaultDayOf(days, date);

  // Hover lights a course for a moment; a tap or click pins it.
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const lit = hover ?? pinned;

  // Deep link from a course's "Next class": ?day=Tue#slot-Tue-P3
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('day');
    // Read once after hydration; the server render can't see the query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q && WEEK_ORDER.includes(q)) setPicked(q);
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('slot-')) {
      requestAnimationFrame(() => {
        const el = [...document.querySelectorAll<HTMLElement>(`[data-slots~="${CSS.escape(hash)}"]`)].find((x) => x.offsetParent);
        if (!el) return;
        el.scrollIntoView({ block: 'center' });
        const target = el.matches('a') ? el : (el.querySelector<HTMLElement>('a') ?? el);
        target.classList.add('flash');
      });
    }
  }, []);

  const nowMin = date.getHours() * 60 + date.getMinutes();
  const liveOf = (d: string, b: Block) => {
    if (d !== today) return false;
    const s = minutesOf(startOf(b.periods[0]));
    const e = minutesOf(endOf(b.periods[b.periods.length - 1]));
    return s != null && e != null && s <= nowMin && nowMin < e;
  };
  const term = termText(snapshot?.term);

  if (days.length === 0) {
    return (
      <section className="page-in">
        <PageHeader title="Timetable" sub={<TermLine term={term} />} />
        <Empty icon={CalendarBlank} title="The ERP has no timetable for this semester.">
          It shows up here after the next sync once your department publishes it.{' '}
          <Link href="/settings#semester" className="link">
            Look at another semester
          </Link>
        </Empty>
      </section>
    );
  }

  return (
    <div className="page-in" data-focus={lit ?? undefined}>
      <PageHeader title="Timetable" sub={<TermLine term={term} />} />

      <Legend
        courses={courses}
        lit={lit}
        pinned={pinned}
        onHover={setHover}
        onPin={(code) => setPinned((p) => (p === code ? null : code))}
      />

      {/* Phones: the week's pattern picks a day, then that day on a rail. */}
      <div className="lg:hidden">
        <WeekMap days={days} value={day} onChange={setPicked} rows={rows} timetable={timetable} hues={hues} dates={dates} today={today} lit={lit} />
        <DayAgenda
          day={day}
          date={dates.get(day)!}
          isToday={day === today}
          blocks={blocksByDay.get(day) ?? []}
          byCode={byCode}
          lit={lit}
          liveOf={(b) => liveOf(day, b)}
        />
      </div>

      {/* Desktop: the whole week as a calendar. */}
      <WeekGrid days={days} rows={rows} blocksByDay={blocksByDay} byCode={byCode} dates={dates} today={today} lit={lit} liveOf={liveOf} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend: every course once, with its figure                          */
/* ------------------------------------------------------------------ */

function Legend({
  courses,
  lit,
  pinned,
  onHover,
  onPin,
}: {
  courses: Course[];
  lit: string | null;
  pinned: string | null;
  onHover: (c: string | null) => void;
  onPin: (c: string) => void;
}) {
  return (
    <section aria-label="Courses this week" className="mt-6 lg:mt-8">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-bar sm:mx-0 sm:px-0 lg:flex-wrap">
        {courses.map((c) => {
          const on = lit === c.code;
          return (
            <li key={c.code} className="shrink-0">
              <button
                type="button"
                aria-pressed={pinned === c.code}
                data-on={on || undefined}
                onMouseEnter={() => onHover(c.code)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(c.code)}
                onBlur={() => onHover(null)}
                onClick={() => onPin(c.code)}
                style={{ '--h': c.hue } as CSSProperties}
                className={cn(
                  'tt-row press flex items-center gap-2.5 rounded-[14px] bg-surface py-2 pl-3 pr-3.5 text-left hair hover:bg-raised',
                  pinned === c.code && '!bg-raised-2 !shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.45)]',
                )}
              >
                <span className="hue-dot h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden />
                <span className="max-w-[150px] truncate text-[13px] font-semibold sm:max-w-[210px]">{c.title}</span>
                {c.pct != null && (
                  <span data-tone={c.status ?? 'none'} className="text-[13px] font-bold text-tone tnum">
                    {c.pct}%
                  </span>
                )}
                {c.budget && <span className="whitespace-nowrap text-[11.5px] text-fg-3">{c.budget}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 hidden text-[12px] text-fg-3 lg:block">Point at a course to light it up across the week; click to keep it lit.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop: the week as a calendar                                     */
/* ------------------------------------------------------------------ */

function WeekGrid({
  days,
  rows,
  blocksByDay,
  byCode,
  dates,
  today,
  lit,
  liveOf,
}: {
  days: string[];
  rows: Row[];
  blocksByDay: Map<string, Block[]>;
  byCode: Map<string, Course>;
  dates: Map<string, Date>;
  today: string;
  lit: string | null;
  liveOf: (day: string, b: Block) => boolean;
}) {
  const lineOf = new Map<number, number>();
  rows.forEach((r, i) => {
    if (r.kind === 'period') lineOf.set(r.n, i + 2);
  });
  const template = ['auto', ...rows.map((r) => (r.kind === 'gap' ? '22px' : 'minmax(78px, auto)'))].join(' ');
  const todayCol = days.indexOf(today);
  const todayDate = dates.get(today);

  return (
    <section aria-label="Weekly timetable" className="mt-8 hidden lg:block">
      <div className="relative grid gap-x-2 gap-y-2" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`, gridTemplateRows: template }}>
        {todayCol >= 0 && (
          <div
            aria-hidden
            className="-mx-1.5 -mb-1.5 rounded-[22px] bg-white/[0.035] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
            style={{ gridColumn: todayCol + 2, gridRow: '1 / -1' }}
          />
        )}

        {days.map((d, i) => {
          const dt = dates.get(d)!;
          const isToday = d === today;
          const past = !!todayDate && dt < todayDate && !isToday;
          return (
            <div key={d} className="flex items-baseline gap-2 px-1.5 pb-1 pt-3" style={{ gridColumn: i + 2, gridRow: 1 }}>
              <span className={cn('figure text-[26px]', past ? 'text-fg-3' : 'text-fg')}>{dt.getDate()}</span>
              <span className={cn('text-[13px] font-semibold', isToday ? 'text-fg' : past ? 'text-fg-3' : 'text-fg-2')}>{FULL_DAY[d]}</span>
              {isToday && (
                <>
                  <span className="sr-only">, today</span>
                  <span aria-hidden className="ml-auto h-1.5 w-1.5 self-center rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                </>
              )}
            </div>
          );
        })}

        {rows.map((r, i) =>
          r.kind === 'period' ? (
            <div key={`h${r.n}`} className="flex flex-col items-end pr-1 pt-2.5" style={{ gridColumn: 1, gridRow: i + 2 }}>
              <span className="figure text-[17px] text-fg-2">{r.n}</span>
              {startOf(r.sample) && <span className="mono mt-1 text-[10.5px] text-fg-3">{clockOf(startOf(r.sample))}</span>}
            </div>
          ) : (
            <div key={`g${r.after}`} aria-hidden className="flex items-center" style={{ gridColumn: '2 / -1', gridRow: i + 2 }}>
              <span className="h-px flex-1 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.12)_0_4px,transparent_4px_9px)]" />
            </div>
          ),
        )}

        {days.flatMap((d, col) => {
          return (blocksByDay.get(d) ?? []).map((b) => {
            const c = byCode.get(b.code);
            const start = lineOf.get(b.from) ?? 2;
            const end = lineOf.get(b.to) ?? start;
            const live = liveOf(d, b);
            return (
              <Link
                key={`${d}-${b.from}`}
                id={slotId(d, b.periods[0])}
                data-slots={b.periods.map((p) => slotId(d, p)).join(' ')}
                data-on={lit === b.code || undefined}
                href={`/#course-${b.code}`}
                className={cn(
                  'hue-block press z-10 flex min-w-0 flex-col rounded-[16px] p-3',
                  live && '!shadow-[inset_0_0_0_2px_rgba(255,255,255,0.85)]',
                )}
                style={{ gridColumn: col + 2, gridRow: `${start} / ${end + 1}`, '--h': c?.hue ?? 260 } as CSSProperties}
              >
                <span className="sr-only">
                  {FULL_DAY[d]}, period {range(b)}:{' '}
                </span>
                <span className={cn('hue-ink text-[13.5px] font-semibold leading-snug', b.to > b.from ? 'line-clamp-4' : 'line-clamp-2')}>
                  {c?.title ?? b.code}
                </span>
                <span className="hue-meta mt-1 truncate text-[12px]">
                  {typeLabel(b.type)}
                  {b.room ? ` · ${b.room}` : ''}
                </span>
                {b.to > b.from && (
                  <span className="hue-meta mt-auto pt-2 text-[11px] font-semibold opacity-75">{b.to - b.from + 1} periods</span>
                )}
                {live && <span className="absolute right-2 top-2 rounded-full bg-fg px-1.5 py-px text-[10px] font-bold text-black">Now</span>}
              </Link>
            );
          });
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Phones: the week's pattern as the day picker                        */
/* ------------------------------------------------------------------ */

function WeekMap({
  days,
  value,
  onChange,
  rows,
  timetable,
  hues,
  dates,
  today,
  lit,
}: {
  days: string[];
  value: string;
  onChange: (d: string) => void;
  rows: Row[];
  timetable: TimetableDay[];
  hues: Map<string, number>;
  dates: Map<string, Date>;
  today: string;
  lit: string | null;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = days.indexOf(value);
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + days.length) % days.length;
    onChange(days[j]);
    bar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[j]?.focus();
  };
  return (
    <div
      ref={bar}
      role="tablist"
      aria-label="Day"
      onKeyDown={onKey}
      className="mt-5 grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
    >
      {days.map((d) => {
        const selected = d === value;
        const periods = timetable.find((t) => t.day === d)?.periods ?? [];
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={FULL_DAY[d]}
            onClick={() => onChange(d)}
            className={cn(
              'press flex min-w-0 flex-col items-center rounded-[16px] px-1 pb-2 pt-2',
              selected ? 'bg-raised-2 shadow-[inset_0_0_0_1.5px_#f5f5f7]' : 'bg-surface hair',
            )}
          >
            <span className={cn('text-[11px] font-semibold', d === today ? 'text-accent' : 'text-fg-2')}>{d}</span>
            <span className="figure mt-0.5 text-[18px]">{dates.get(d)?.getDate()}</span>
            <span aria-hidden className="mt-2 flex w-full flex-col gap-[3px] px-1">
              {rows.map((r) => {
                if (r.kind === 'gap') return <span key={`g${r.after}`} className="h-[3px]" />;
                const p = periods.find((x) => periodOrder(x) === r.n);
                if (!p) return <span key={r.n} className="h-[6px] rounded-[2px] bg-white/[0.05]" />;
                return (
                  <span
                    key={r.n}
                    data-on={lit === p.subjectCode || undefined}
                    className="hue-cell h-[6px] rounded-[2px]"
                    style={{ '--h': hues.get(p.subjectCode) ?? 260 } as CSSProperties}
                  />
                );
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DayAgenda({
  day,
  date,
  isToday,
  blocks,
  byCode,
  lit,
  liveOf,
}: {
  day: string;
  date: Date;
  isToday: boolean;
  blocks: Block[];
  byCode: Map<string, Course>;
  lit: string | null;
  liveOf: (b: Block) => boolean;
}) {
  const nowIdx = blocks.findIndex(liveOf);
  return (
    <>
      <h2 className="h2 mt-7">
        {FULL_DAY[day]}{' '}
        <span className="font-sans text-[15px] font-medium tracking-normal text-fg-3">
          {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          {isToday ? ' · today' : ''}
        </span>
      </h2>
      <ol className="relative mt-3">
        <span aria-hidden className="absolute bottom-4 left-[21px] top-4 w-px bg-gradient-to-b from-white/[0.14] via-white/[0.08] to-transparent" />
        {blocks.map((b, i) => {
          const c = byCode.get(b.code);
          const prev = blocks[i - 1];
          const free = prev && b.from > prev.to + 1 ? { from: prev.to + 1, to: b.from - 1 } : null;
          const live = i === nowIdx;
          const start = startOf(b.periods[0]);
          return (
            <Fragment key={`${b.from}-${b.code}`}>
              {free && (
                <li aria-hidden className="relative flex items-center gap-3 py-2 pl-[56px] text-[12px] text-fg-3">
                  Free · period{free.to > free.from ? 's' : ''} {range(free)}
                </li>
              )}
              <li
                id={slotId(day, b.periods[0])}
                data-slots={b.periods.map((p) => slotId(day, p)).join(' ')}
                className="relative flex scroll-mt-28 gap-3 py-1.5"
              >
                <span className="relative z-10 flex w-[44px] shrink-0 flex-col items-center pt-3.5">
                  <span className={cn('figure rounded-full bg-black px-1 text-[16px] leading-none', live ? 'text-fg' : 'text-fg-2')}>{range(b)}</span>
                  {start && <span className="mono mt-1.5 bg-black text-[10.5px] text-fg-3">{clockOf(start).split(' ')[0]}</span>}
                </span>
                <Link
                  href={`/#course-${b.code}`}
                  data-on={lit === b.code || undefined}
                  className={cn('hue-block press flex min-w-0 flex-1 items-start justify-between gap-3 rounded-[18px] p-4', live && '!shadow-[inset_0_0_0_2px_rgba(255,255,255,0.85)]')}
                  style={{ '--h': c?.hue ?? 260 } as CSSProperties}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="hue-ink text-[15.5px] font-semibold leading-snug">{c?.title ?? b.code}</span>
                      {live && <span className="shrink-0 rounded-full bg-fg px-2 py-0.5 text-[10.5px] font-bold text-black">Now</span>}
                    </span>
                    <span className="hue-meta mt-1 block text-[13px]">
                      {typeLabel(b.type)}
                      {b.room ? ` · ${b.room}` : ''}
                      {b.to > b.from ? ` · ${b.to - b.from + 1} periods` : ''}
                    </span>
                  </span>
                  {c?.pct != null && (
                    <span className="shrink-0 text-right">
                      <span data-tone={c.status ?? 'none'} className="figure block text-[19px] text-tone">
                        {c.pct}%
                      </span>
                      {c.budget && <span className="hue-meta mt-1 block text-[11px]">{c.budget}</span>}
                    </span>
                  )}
                </Link>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </>
  );
}
