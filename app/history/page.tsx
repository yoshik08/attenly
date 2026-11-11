'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { MonthCalendar, dayCellClass, dayKey, dayToneClass, MONTHS } from '@/components/month-calendar';
import { cn } from '@/components/cn';
import { COMPONENT_LABELS, type ComponentKey } from '@/lib/math';
import { sortPeriods, WEEK } from '@/lib/insights';
import type { ClassRecord } from '@/lib/erp/parsers';
import { useNow } from '@/lib/time';
import { termText } from '@/lib/terms';

type DayTone = 'all' | 'some' | 'none' | 'empty';

const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function toneOf(records: ClassRecord[] | undefined): DayTone {
  if (!records || records.length === 0) return 'empty';
  const present = records.filter((r) => r.present).length;
  if (present === records.length) return 'all';
  if (present === 0) return 'none';
  return 'some';
}

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
  const byCode = useMemo(() => new Map((snapshot?.attendance ?? []).map((s) => [s.code, s])), [snapshot]);

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
  const latest = dates[dates.length - 1] ?? keyOf(today);
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
    const rows: { key: string; period: string; time: string; code: string; title: string; component: string; state: 'present' | 'absent' | 'not-taken' }[] = [];
    for (const r of records) {
      const subj = byCode.get(r.code);
      rows.push({
        key: `r-${r.code}-${r.component}-${r.period}`,
        period: r.period,
        time: '',
        code: r.code,
        title: subj?.title ?? r.code,
        component: r.component,
        state: r.present ? 'present' : 'absent',
      });
    }
    // A period the timetable had that the register never recorded did not happen.
    const date = new Date(`${pickedDate}T00:00:00`);
    const inTerm = firstClassDate && pickedDate >= firstClassDate && date <= today;
    if (inTerm && !Number.isNaN(date.getTime())) {
      const weekday = WEEK[date.getDay()];
      for (const p of sortPeriods(timetable.find((t) => t.day === weekday)?.periods ?? [])) {
        const period = p.period.replace(/\D/g, '');
        const already = rows.some((r) => r.code === p.subjectCode && r.period === period);
        if (already) continue;
        rows.push({
          key: `t-${p.period}-${p.subjectCode}`,
          period,
          time: p.start ?? '',
          code: p.subjectCode,
          title: byCode.get(p.subjectCode)?.title ?? p.subjectTitle ?? p.subjectCode,
          component: p.type ?? '',
          state: 'not-taken',
        });
      }
    }
    return rows.sort((a, b) => (Number(a.period) || 99) - (Number(b.period) || 99) || a.code.localeCompare(b.code));
  }, [byDate, byCode, pickedDate, timetable, firstClassDate, today]);

  const counts = dayRows.reduce(
    (n, r) => ({ ...n, [r.state]: n[r.state] + 1 }),
    { present: 0, absent: 0, 'not-taken': 0 } as Record<'present' | 'absent' | 'not-taken', number>,
  );

  if (classes.length === 0) {
    return (
      <section className="page-in py-8">
        <h1 className="title-l">History</h1>
        <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">{termText(snapshot?.term)}</p>
        <p className="mt-8 text-[15px] font-semibold">No day-by-day records yet.</p>
        <p className="mt-1 max-w-[58ch] text-[13px] text-dropout-text pretty">
          History is read from each course&rsquo;s attendance register in the ERP. Those pages are fetched on a
          background sync (about every five minutes) because there is one per course; the manual sync button skips
          them to stay quick. It fills in on its own.
        </p>
      </section>
    );
  }


  const chip: Record<'present' | 'absent' | 'not-taken', string> = {
    present: 'bg-[#0d1a14] text-cruise',
    absent: 'bg-[#2a1210] text-red',
    'not-taken': 'bg-[#121826] text-dropout-text',
  };
  const pickedDay = new Date(`${pickedDate}T00:00:00`);

  return (
    <div className="page-in py-6 lg:py-10">
      <div>
        <h1 className="title-l">History</h1>
        <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">{termText(snapshot?.term)}</p>
      </div>

      <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        <section aria-label="Attendance calendar">
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            label={`Days of the attendance calendar`}
            renderDay={(date) => {
              const key = dayKey(date);
              const records = byDate.get(key);
              const t = toneOf(records);
              const isToday = key === dayKey(today);
              const selected = key === pickedDate;
              const summary = records
                ? `${records.filter((r) => r.present).length} of ${records.length} attended`
                : 'no classes recorded';
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
                    dayToneClass(t === 'all' ? 'green' : t === 'some' ? 'amber' : t === 'none' ? 'red' : 'plain'),
                    t === 'empty' && 'opacity-50 ring-seam',
                    isToday && 'ring-2 ring-inset ring-mark',
                    selected && 'ring-2 ring-inset ring-focus',
                  )}
                >
                  {date.getDate()}
                </button>
              );
            }}
          />

          <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-dropout-text" aria-label="Legend">
            <li className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[4px] bg-[#0d1a14] ring-1 ring-inset ring-[#3ddc97]/40" aria-hidden /> went to all
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[4px] bg-[#1a1508] ring-1 ring-inset ring-[#f5b544]/40" aria-hidden /> missed some
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[4px] bg-[#2a1210] ring-1 ring-inset ring-[#ff6b5e]/40" aria-hidden /> missed all
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[4px] ring-1 ring-inset ring-seam-strong" aria-hidden /> nothing recorded
            </li>
          </ul>
        </section>

        <section className="mt-8 lg:mt-0" aria-label={`Periods on ${pickedDate}`}>
          <h2 className="title-s">
            {pickedDay.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <p className="mt-1 text-[13px] text-dropout-text tnum">
            {counts.present} attended · {counts.absent} missed
            {counts['not-taken'] > 0 ? ` · ${counts['not-taken']} not taken` : ''}
          </p>
          {dayRows.length === 0 ? (
            <p className="mt-4 text-[14px] text-dropout-quiet">No classes were recorded on this day.</p>
          ) : (
            <ol className="mt-3">
              {dayRows.map((r) => (
                <li key={r.key} className="seam-b flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="w-6 shrink-0 text-[12px] text-dropout-quiet tnum">{r.period || '—'}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{r.title}</span>
                      <span className="block text-[12px] text-dropout-quiet tnum">
                        {r.code}
                        {r.component ? ` · ${COMPONENT_LABELS[r.component as ComponentKey] ?? r.component}` : ''}
                        {r.time ? ` · ${r.time}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold', chip[r.state])}>
                    {r.state === 'present' ? 'Attended' : r.state === 'absent' ? 'Absent' : 'Not taken'}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-[12px] text-dropout-quiet pretty">
            Read from the ERP&rsquo;s class registers. &ldquo;Not taken&rdquo; is a timetable period the register never
            recorded, so the class did not happen.
          </p>
        </section>
      </div>
    </div>
  );
}


