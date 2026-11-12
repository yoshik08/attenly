'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { CalendarBlank, MapPin } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { DayStrip, defaultDayOf, FULL_DAY, nextDateOf, WEEK_ORDER } from '@/components/day-strip';
import { Empty, PageHeader, TermLine } from '@/components/page';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS } from '@/lib/math';
import { clockOf, minutesOf, periodOrder, sortPeriods, summarize, WEEK, type CourseSummary } from '@/lib/insights';
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

function typeLabel(p: TimetablePeriod) {
  return p.type ? COMPONENT_LABELS[p.type] : 'Class';
}

/** "9:00" over "am": the clock split for a narrow column. */
function Clock({ hhmm, className, small = false }: { hhmm: string; className?: string; small?: boolean }) {
  const [t, ap] = clockOf(hhmm).split(' ');
  return (
    <span className={cn('mono tnum', className)}>
      {t || hhmm}
      {ap && <span className={cn('ml-0.5 text-fg-3', small ? 'text-[10px]' : 'text-[11px]')}>{ap}</span>}
    </span>
  );
}

/** The shortest honest budget for a course: the most you can skip, or the fewest you must attend. */
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

function minutesText(m: number) {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}

function Timetable() {
  const { snapshot, settings } = useStore();
  const now = useNow(60_000);
  const date = useMemo(() => new Date(now), [now]);
  const timetable: TimetableDay[] = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const days = useMemo(
    () => WEEK_ORDER.filter((d) => (timetable.find((t) => t.day === d)?.periods.length ?? 0) > 0),
    [timetable],
  );
  const byCode = useMemo(() => {
    const m = new Map<string, CourseSummary>();
    for (const s of snapshot?.attendance ?? []) m.set(s.code, summarize(s, settings));
    return m;
  }, [snapshot, settings]);

  const today = WEEK[date.getDay()];
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : defaultDayOf(days, date);

  // Deep link from a course's "Next class": ?day=Tue#slot-Tue-P3
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('day');
    // Read once after hydration; the server render can't see the query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q && WEEK_ORDER.includes(q)) setPicked(q);
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('slot-')) {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`#${CSS.escape(hash)} > a, #${CSS.escape(hash)}`);
        if (!el) return;
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
      });
    }
  }, []);

  const nowMin = date.getHours() * 60 + date.getMinutes();
  const periods = sortPeriods(timetable.find((t) => t.day === day)?.periods ?? []);
  const isToday = day === today;
  const current = isToday
    ? periods.find((p) => {
        const s = minutesOf(p.start);
        const e = minutesOf(p.end);
        return s != null && e != null && s <= nowMin && nowMin < e;
      })
    : undefined;
  const upcoming = isToday && !current ? periods.find((p) => (minutesOf(p.start) ?? -1) > nowMin) : undefined;
  const term = termText(snapshot?.term);
  const dayDate = nextDateOf(day, date);

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
    <div className="page-in">
      <PageHeader title="Timetable" sub={<TermLine term={term} />} />

      {/* Phones: one day at a time */}
      <div className="lg:hidden">
        <DayStrip className="mt-6" label="Day" days={days} value={day} onChange={setPicked} now={date} />
        <h2 className="h2 mt-7">
          {FULL_DAY[day]}{' '}
          <span className="font-sans text-[15px] font-medium tracking-normal text-fg-3">
            {dayDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            {isToday ? ' · today' : ''}
          </span>
        </h2>
        <ol className="mt-3 flex flex-col gap-2">
          {periods.map((p, i) => {
            const s = byCode.get(p.subjectCode);
            const state = p === current ? 'Now' : p === upcoming ? 'Next' : null;
            const prev = periods[i - 1];
            const gap = prev ? (minutesOf(p.start) ?? 0) - (minutesOf(prev.end) ?? minutesOf(p.start) ?? 0) : 0;
            return (
              <Fragment key={`${p.period}-${p.subjectCode}`}>
                {gap >= 15 && (
                  <li aria-hidden className="flex items-center gap-3 py-1 pl-1 text-[12px] text-fg-3">
                    <span className="h-px flex-1 bg-line" />
                    Free for {minutesText(gap)}
                    <span className="h-px flex-1 bg-line" />
                  </li>
                )}
                <li id={`slot-${day}-${p.period}`} className="scroll-mt-28">
                  <Link
                    href={`/#course-${p.subjectCode}`}
                    data-tone={s?.status ?? 'none'}
                    className={cn('card press flex items-center gap-4 p-4', state === 'Now' && '!shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.5)]')}
                  >
                    <span className="flex w-[58px] shrink-0 flex-col gap-0.5">
                      {p.start ? <Clock hhmm={p.start} className="text-[14px] font-semibold text-fg" /> : <span className="mono text-[13px]">{p.period}</span>}
                      {p.end && <Clock hhmm={p.end} small className="text-[12px] text-fg-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold">{s?.title ?? (p.subjectTitle || p.subjectCode)}</span>
                        {state && (
                          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', state === 'Now' ? 'bg-fg text-black' : 'bg-raised-2 text-fg')}>
                            {state}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-fg-2">
                        {typeLabel(p)}
                        {p.room && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={13} aria-hidden /> {p.room}
                          </span>
                        )}
                      </span>
                    </span>
                    {s && s.pct != null && (
                      <span className="shrink-0 text-right">
                        <span className="figure block text-[20px] text-tone">{s.pct}%</span>
                        <span className="mt-0.5 block text-[11px] text-fg-3">{budgetShort(s, settings.target)}</span>
                      </span>
                    )}
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>

      {/* Desktop: the week */}
      <Week timetable={timetable} days={days} today={today} byCode={byCode} nowMin={nowMin} target={settings.target} />
    </div>
  );
}

function Week({
  timetable,
  days,
  today,
  byCode,
  nowMin,
  target,
}: {
  timetable: TimetableDay[];
  days: string[];
  today: string;
  byCode: Map<string, CourseSummary>;
  nowMin: number;
  target: number;
}) {
  const rows = useMemo(() => {
    const m = new Map<string, TimetablePeriod>();
    for (const d of timetable) for (const p of d.periods) if (!m.has(p.period)) m.set(p.period, p);
    return [...m.values()].sort((a, b) => periodOrder(a) - periodOrder(b) || (minutesOf(a.start) ?? 0) - (minutesOf(b.start) ?? 0));
  }, [timetable]);

  return (
    <div className="mt-10 hidden lg:block">
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `72px repeat(${days.length}, minmax(0, 1fr))` }}
        role="table"
        aria-label="Weekly timetable"
      >
        <div className="contents" role="row">
          <div role="columnheader">
            <span className="sr-only">Time</span>
          </div>
          {days.map((d) => (
            <div key={d} role="columnheader" className={cn('flex items-center gap-2 px-1 pb-2 text-[13px] font-semibold', d === today ? 'text-fg' : 'text-fg-2')}>
              {FULL_DAY[d]}
              {d === today && (
                <span data-tone="mark" className="rounded-full bg-fg px-1.5 py-px text-[10.5px] font-bold text-black">
                  Today
                </span>
              )}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.period} className="contents" role="row">
            <div role="rowheader" className="flex flex-col gap-0.5 pr-2 pt-3">
              {row.start ? (
                <>
                  <Clock hhmm={row.start} className="text-[12.5px] font-semibold text-fg-2" small />
                  {row.end && <Clock hhmm={row.end} className="text-[11.5px] text-fg-3" small />}
                </>
              ) : (
                <span className="mono text-[12px] text-fg-2">{row.period.replace(/^P/, 'Period ')}</span>
              )}
            </div>
            {days.map((d) => {
              const p = timetable.find((t) => t.day === d)?.periods.find((x) => x.period === row.period);
              if (!p) {
                return <div key={d} role="cell" className="min-h-[96px] rounded-[16px] border border-dashed border-white/[0.06]" />;
              }
              const s = byCode.get(p.subjectCode);
              const live = d === today && (minutesOf(p.start) ?? -1) <= nowMin && nowMin < (minutesOf(p.end) ?? -1);
              return (
                <Link
                  key={d}
                  id={`slot-${d}-${p.period}`}
                  href={`/#course-${p.subjectCode}`}
                  role="cell"
                  data-tone={s?.status ?? 'none'}
                  className={cn(
                    'card press flex min-h-[96px] flex-col rounded-[16px] p-3 hover:bg-raised',
                    d === today && 'bg-[#101013]',
                    live && '!shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.55)]',
                  )}
                  title={`${s?.title ?? p.subjectCode}, ${typeLabel(p)}${p.room ? ` in ${p.room}` : ''}`}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-14 -top-16 -z-10 h-[140px] w-[140px]"
                    style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--tone) 20%, transparent), transparent)' }}
                  />
                  <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{s?.title ?? (p.subjectTitle || p.subjectCode)}</span>
                  <span className="mt-1 block truncate text-[12px] text-fg-2">
                    {typeLabel(p)}
                    {p.room ? ` · ${p.room}` : ''}
                  </span>
                  <span className="mt-auto flex items-baseline justify-between gap-2 pt-2">
                    {s && s.pct != null ? (
                      <>
                        <span className="figure text-[16px] text-tone">{s.pct}%</span>
                        <span className="truncate text-[11px] text-fg-3">{budgetShort(s, target)}</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-fg-3">{live ? 'Now' : ''}</span>
                    )}
                  </span>
                  {live && (
                    <span className="absolute right-2.5 top-2.5 rounded-full bg-fg px-1.5 py-px text-[10px] font-bold text-black">Now</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
