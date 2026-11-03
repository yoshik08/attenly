'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { MapPin } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Segmented } from '@/components/segmented';
import { BAND_INK } from '@/components/course';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, fmtPct } from '@/lib/math';
import { minutesOf, periodOrder, sortPeriods, summarize, WEEK, type CourseSummary } from '@/lib/insights';
import type { TimetableDay, TimetablePeriod } from '@/lib/erp/parsers';
import { useNow } from '@/lib/time';
import { termText } from '@/lib/terms';

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

function timeOf(p: TimetablePeriod) {
  return p.start ? `${p.start}${p.end ? `–${p.end}` : ''}` : p.period.replace(/^P/, 'Period ');
}

function budgetShort(s: CourseSummary | undefined): string | null {
  if (!s || s.pct == null) return null;
  const pick = (f: (c: CourseSummary['components'][number]) => number | undefined) => {
    let best: number | null = null;
    for (const c of s.components) {
      const v = f(c);
      if (v != null && Number.isFinite(v) && (best == null || v > best)) best = v;
    }
    return best;
  };
  if (s.band === 'cruising') {
    const spare = pick((c) => c.cruise?.spare);
    return spare ? `${spare} to spare` : 'none to spare';
  }
  const need = s.components
    .map((c) => (s.band === 'thin-ice' ? c.cruise?.needed : c.floor?.needed))
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
  return need.length ? `attend ${Math.min(...need)}` : null;
}

function Timetable() {
  const { snapshot, settings } = useStore();
  const now = useNow(60_000);
  const timetable: TimetableDay[] = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const days = useMemo(
    () => ORDER.filter((d) => (timetable.find((t) => t.day === d)?.periods.length ?? 0) > 0),
    [timetable],
  );
  const byCode = useMemo(() => {
    const m = new Map<string, CourseSummary>();
    for (const s of snapshot?.attendance ?? []) m.set(s.code, summarize(s, settings));
    return m;
  }, [snapshot, settings]);

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

  // Deep link from a course's "Next class": ?day=Tue#slot-Tue-P3
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('day');
    // Read once after hydration; the server render can't see the query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q && ORDER.includes(q)) setPicked(q);
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('slot-')) {
      requestAnimationFrame(() => {
        const el = document.getElementById(hash);
        if (!el) return;
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
      });
    }
  }, []);

  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
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

  if (days.length === 0) {
    return (
      <section className="page-in py-8">
        <h1 className="title-l">Timetable</h1>
        <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">{term}</p>
        <p className="mt-8 text-[15px] font-semibold">The ERP has no timetable for this semester.</p>
        <p className="mt-1 text-[13px] text-dropout-text">
          It shows up here after the next sync once your department publishes it.{' '}
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
          <h1 className="title-l">Timetable</h1>
          <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">
            {term}{' '}
            <Link href="/settings#semester" className="ml-1 rounded font-medium text-dropout-text underline decoration-seam-strong hover:text-mark">
              Change
            </Link>
          </p>
        </div>
      </div>

      {/* Phones: one day at a time */}
      <div className="lg:hidden">
        <div className="-mx-4 mt-5 overflow-x-auto px-4 pb-1">
          <Segmented
            label="Day"
            value={day}
            onChange={setPicked}
            options={days.map((d) => ({ value: d, label: d, hint: d === today ? `${FULL[d]} (today)` : FULL[d] }))}
            size="sm"
          />
        </div>
        <h2 className="title-s mt-6">
          {FULL[day]}
          {isToday && <span className="ml-2 text-[13px] font-medium text-dropout-text">today</span>}
        </h2>
        <ol className="mt-3">
          {periods.map((p) => {
            const s = byCode.get(p.subjectCode);
            const state = p === current ? 'Now' : p === upcoming ? 'Next' : null;
            return (
              <li key={`${p.period}-${p.subjectCode}`} id={`slot-${day}-${p.period}`} className="seam-b scroll-mt-28">
                <Link href={`/#course-${p.subjectCode}`} className="press grid grid-cols-[72px_1fr_auto] items-start gap-3 py-4">
                  <span className="pt-0.5 text-[13px] text-dropout-text tnum">
                    {p.start || p.period.replace(/^P/, 'P ')}
                    {p.end && <span className="block text-[12px] text-dropout-quiet">{p.end}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">{s?.title ?? p.subjectCode}</span>
                      {state && (
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', state === 'Now' ? 'bg-mark text-black' : 'bg-[#121826] text-mark')}>
                          {state}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-dropout-text">
                      {typeLabel(p)}
                      {p.room && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={13} aria-hidden /> {p.room}
                        </span>
                      )}
                    </span>
                  </span>
                  {s && s.pct != null && (
                    <span className="text-right">
                      <span className={cn('figure block text-[18px]', BAND_INK[s.band])}>{fmtPct(s.pct)}</span>
                      <span className="text-[11px] text-dropout-quiet">{budgetShort(s)}</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Desktop: the week */}
      <Week timetable={timetable} days={days} today={today} byCode={byCode} />
    </div>
  );
}

function Week({
  timetable,
  days,
  today,
  byCode,
}: {
  timetable: TimetableDay[];
  days: string[];
  today: string;
  byCode: Map<string, CourseSummary>;
}) {
  const rows = useMemo(() => {
    const m = new Map<string, TimetablePeriod>();
    for (const d of timetable) for (const p of d.periods) if (!m.has(p.period)) m.set(p.period, p);
    return [...m.values()].sort((a, b) => periodOrder(a) - periodOrder(b) || (minutesOf(a.start) ?? 0) - (minutesOf(b.start) ?? 0));
  }, [timetable]);

  return (
    <div className="mt-8 hidden lg:block">
      <div
        className="grid gap-px overflow-hidden rounded-2xl bg-seam ring-seam"
        style={{ gridTemplateColumns: `88px repeat(${days.length}, minmax(0, 1fr))` }}
        role="table"
        aria-label="Weekly timetable"
      >
        <div className="contents" role="row">
          <div className="bg-black p-3" role="columnheader">
            <span className="sr-only">Time</span>
          </div>
          {days.map((d) => (
            <div key={d} role="columnheader" className={cn('p-3 text-[13px] font-semibold', d === today ? 'bg-[#121826] text-mark' : 'bg-black text-dropout-text')}>
              {FULL[d]}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.period} className="contents" role="row">
            <div role="rowheader" className="bg-black p-3 text-[12px] text-dropout-text tnum">
              {row.start ? (
                <>
                  {row.start}
                  {row.end && <span className="block text-dropout-quiet">{row.end}</span>}
                </>
              ) : (
                row.period.replace(/^P/, 'Period ')
              )}
            </div>
            {days.map((d) => {
              const p = timetable.find((t) => t.day === d)?.periods.find((x) => x.period === row.period);
              if (!p) return <div key={d} className={cn('bg-black', d === today && 'bg-[#05070b]')} role="cell" />;
              const s = byCode.get(p.subjectCode);
              return (
                <Link
                  key={d}
                  id={`slot-${d}-${p.period}`}
                  href={`/#course-${p.subjectCode}`}
                  role="cell"
                  className={cn('press block min-h-[84px] p-3 hover:bg-[#0c111b]', d === today ? 'bg-[#05070b]' : 'bg-black')}
                  title={timeOf(p)}
                >
                  <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{s?.title ?? p.subjectCode}</span>
                  <span className="mt-1 block text-[12px] text-dropout-text">
                    {typeLabel(p)}
                    {p.room ? ` in ${p.room}` : ''}
                  </span>
                  {s && s.pct != null && <span className={cn('mt-1 block text-[12px] font-semibold tnum', BAND_INK[s.band])}>{fmtPct(s.pct)}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
