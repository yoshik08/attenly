'use client';

import { useMemo, useState } from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Empty, Footnote, PageHeader, TermLine } from '@/components/page';
import { MonthCalendar, dayCellClass, dayKey, MONTHS } from '@/components/month-calendar';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, type ComponentKey } from '@/lib/math';
import { clockOf, courseTitle, sortPeriods, startOf, WEEK } from '@/lib/insights';
import type { ClassRecord } from '@/lib/erp/parsers';
import { useNow } from '@/lib/time';
import { termText } from '@/lib/terms';

type DayTone = 'all' | 'some' | 'none' | 'empty';
type RowState = 'present' | 'absent' | 'not-taken';

function toneOf(records: ClassRecord[] | undefined): DayTone {
  if (!records || records.length === 0) return 'empty';
  const present = records.filter((r) => r.present).length;
  if (present === records.length) return 'all';
  if (present === 0) return 'none';
  return 'some';
}

const CELL_TONE: Record<DayTone, string> = {
  all: 'bg-safe/12 text-fg hover:bg-safe/18',
  some: 'bg-cond/12 text-fg hover:bg-cond/18',
  none: 'bg-det/14 text-fg hover:bg-det/20',
  empty: 'text-fg-3/60',
};

const STATE: Record<RowState, { label: string; tone: string }> = {
  present: { label: 'Attended', tone: 'safe' },
  absent: { label: 'Absent', tone: 'detained' },
  'not-taken': { label: 'Not taken', tone: 'none' },
};

export default function HistoryPage() {
  return (
    <DataGate title="History">
      <History />
    </DataGate>
  );
}

function History() {
  const { snapshot } = useStore();
  const now = useNow(60_000);
  const today = useMemo(() => new Date(now), [now]);
  const classes = useMemo(() => snapshot?.classes ?? [], [snapshot]);
  const timetable = useMemo(() => snapshot?.timetable ?? [], [snapshot]);
  const byCode = useMemo(
    () => new Map((snapshot?.attendance ?? []).map((s) => [s.code, { ...s, title: courseTitle(s.title, s.code) }])),
    [snapshot],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, ClassRecord[]>();
    for (const c of classes) {
      const list = m.get(c.date);
      if (list) list.push(c);
      else m.set(c.date, [c]);
    }
    return m;
  }, [classes]);

  const dates = useMemo(() => [...byDate.keys()].sort(), [byDate]);
  const latest = dates[dates.length - 1] ?? dayKey(today);
  const [month, setMonth] = useState(() => {
    // Open on the newest month that has records: that is the one being asked about.
    const base = dates.length > 0 ? new Date(`${dates[dates.length - 1]}T00:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [picked, setPicked] = useState<string | null>(null);
  const pickedDate = picked ?? (byDate.has(dayKey(today)) ? dayKey(today) : latest);
  const firstClassDate = dates[0] ?? '';

  /** The period rows of one day: what the register says, plus timetable slots it never saw. */
  const dayRows = useMemo(() => {
    const records = byDate.get(pickedDate) ?? [];
    const date = new Date(`${pickedDate}T00:00:00`);
    const slots = Number.isNaN(date.getTime()) ? [] : sortPeriods(timetable.find((t) => t.day === WEEK[date.getDay()])?.periods ?? []);
    const timeOf = (period: string) => {
      const slot = slots.find((p) => p.period.replace(/\D/g, '') === period);
      return slot ? startOf(slot) : '';
    };
    const rows: { key: string; period: string; time: string; code: string; title: string; component: string; state: RowState }[] = [];
    for (const r of records) {
      rows.push({
        key: `r-${r.code}-${r.component}-${r.period}`,
        period: r.period,
        time: timeOf(r.period),
        code: r.code,
        title: byCode.get(r.code)?.title ?? r.code,
        component: r.component,
        state: r.present ? 'present' : 'absent',
      });
    }
    // A period the timetable had that the register never recorded did not happen.
    const inTerm = firstClassDate && pickedDate >= firstClassDate && date <= today;
    if (inTerm) {
      for (const p of slots) {
        const period = p.period.replace(/\D/g, '');
        if (rows.some((r) => r.code === p.subjectCode && r.period === period)) continue;
        rows.push({
          key: `t-${p.period}-${p.subjectCode}`,
          period,
          time: startOf(p),
          code: p.subjectCode,
          title: byCode.get(p.subjectCode)?.title ?? courseTitle(p.subjectTitle, p.subjectCode),
          component: p.type ?? '',
          state: 'not-taken',
        });
      }
    }
    return rows.sort((a, b) => (Number(a.period) || 99) - (Number(b.period) || 99) || a.code.localeCompare(b.code));
  }, [byDate, byCode, pickedDate, timetable, firstClassDate, today]);

  const counts = dayRows.reduce(
    (n, r) => ({ ...n, [r.state]: n[r.state] + 1 }),
    { present: 0, absent: 0, 'not-taken': 0 } as Record<RowState, number>,
  );

  // The shown month in two numbers.
  const monthTotals = useMemo(() => {
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    let present = 0;
    let absent = 0;
    for (const c of classes) {
      if (!c.date.startsWith(prefix)) continue;
      if (c.present) present++;
      else absent++;
    }
    return { present, absent };
  }, [classes, month]);

  if (classes.length === 0) {
    return (
      <section className="page-in">
        <PageHeader title="History" sub={<TermLine term={termText(snapshot?.term)} />} />
        <Empty icon={ClockCounterClockwise} title="No day-by-day records yet.">
          History is read from each course&rsquo;s attendance register in the ERP. Those pages are fetched on a background
          sync (about every five minutes) because there is one per course; the manual sync button skips them to stay quick.
          It fills in on its own.
        </Empty>
      </section>
    );
  }

  const pickedDay = new Date(`${pickedDate}T00:00:00`);

  return (
    <div className="page-in">
      <PageHeader title="History" sub={<TermLine term={termText(snapshot?.term)} />} />

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10">
        <section aria-label="Attendance calendar" className="card self-start p-4 sm:p-6 lg lg-card lg-frost">
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            label="Days of the attendance calendar"
            renderDay={(date) => {
              const key = dayKey(date);
              const records = byDate.get(key);
              const t = toneOf(records);
              const isToday = key === dayKey(today);
              const selected = key === pickedDate;
              const summary = records ? `${records.filter((r) => r.present).length} of ${records.length} attended` : 'no classes recorded';
              const ordered = records ? [...records].sort((a, b) => Number(a.present) - Number(b.present) || (Number(a.period) || 99) - (Number(b.period) || 99)) : [];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${date.getDate()} ${MONTHS[date.getMonth()]}: ${summary}`}
                  disabled={t === 'empty'}
                  onClick={() => setPicked(key)}
                  className={cn(
                    dayCellClass,
                    'gap-1.5',
                    CELL_TONE[t],
                    isToday && 'underline decoration-2 underline-offset-4',
                    selected && '!shadow-[inset_0_0_0_2px_#f5f5f7]',
                  )}
                >
                  {date.getDate()}
                  {ordered.length > 0 && (
                    <span className="flex max-w-full justify-center gap-[2.5px] px-1" aria-hidden>
                      {ordered.slice(0, 6).map((r, i) => (
                        <span key={i} className={cn('h-[4.5px] w-[4.5px] shrink-0 rounded-full', r.present ? 'bg-safe' : 'bg-det')} />
                      ))}
                    </span>
                  )}
                </button>
              );
            }}
          />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-fg-2" aria-label="Legend">
              <li className="inline-flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-safe" aria-hidden /> attended
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-det" aria-hidden /> missed
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded-[5px] bg-cond/25" aria-hidden /> missed some
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded-[5px] hair" aria-hidden /> nothing recorded
              </li>
            </ul>
            <p className="text-[12.5px] text-fg-3 tnum">
              {MONTHS[month.getMonth()]}: {monthTotals.present} attended · {monthTotals.absent} missed
            </p>
          </div>
        </section>

        <section className="self-start" aria-label={`Periods on ${pickedDate}`}>
          <h2 className="h2 text-[22px]">{pickedDay.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span data-tone="safe" className="chip tnum lg lg-pill">
              {counts.present} attended
            </span>
            <span data-tone={counts.absent > 0 ? 'detained' : 'none'} className="chip tnum lg lg-pill">
              {counts.absent} missed
            </span>
            {counts['not-taken'] > 0 && (
              <span data-tone="none" className="chip tnum lg lg-pill">
                {counts['not-taken']} not taken
              </span>
            )}
          </div>
          {dayRows.length === 0 ? (
            <p className="mt-5 text-[14px] text-fg-3">No classes were recorded on this day.</p>
          ) : (
            <ol className="card mt-4 px-4 lg lg-card lg-frost">
              {dayRows.map((r, i) => (
                <li key={r.key} data-tone={STATE[r.state].tone} className={cn('flex items-center justify-between gap-3 py-3.5', i > 0 && 'hair-t')}>
                  <span className="flex min-w-0 items-center gap-3.5">
                    <span className="figure w-6 shrink-0 text-center text-[17px] text-fg-2">{r.period || '—'}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold">{r.title}</span>
                      <span className="block truncate text-[12px] text-fg-3">
                        <span className="mono">{r.code}</span>
                        {r.component ? ` · ${COMPONENT_LABELS[r.component as ComponentKey] ?? r.component}` : ''}
                        {r.time ? ` · ${clockOf(r.time)}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className="chip shrink-0 lg lg-pill">
                    <span className="dot" aria-hidden />
                    {STATE[r.state].label}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Footnote className="mt-5">
            Read from the ERP&rsquo;s class registers. &ldquo;Not taken&rdquo; is a timetable period the register never
            recorded, so the class did not happen.
          </Footnote>
        </section>
      </div>
    </div>
  );
}
