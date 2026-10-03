'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePlanner } from '@/components/data-context';
import { Button, Card, Container, EmptyState, SectionTitle, Sparkline } from '@/components/ui';
import { cn } from '@/components/cn';
import { fmtPct, weightedPct, COMPONENT_ORDER } from '@/lib/math';
import { classKey } from '@/lib/sample-data';
import {
  daySummary,
  computeStreaks,
  weekBuckets,
  trendsFromLog,
  missedMost,
  scheduledFor,
  isoOf,
  type DayStatus,
} from '@/lib/history';

const STATUS_STYLE: Record<DayStatus, string> = {
  all: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold',
  some: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold',
  none: 'bg-red-500/15 text-red-700 dark:text-red-400 font-bold',
  unscheduled: 'text-neutral-300 dark:text-neutral-700',
  future: 'text-neutral-400 dark:text-neutral-600',
  unmarked: 'text-neutral-500 dark:text-neutral-400 border border-dashed border-neutral-300 dark:border-neutral-700',
};

const STATUS_LABEL: Record<DayStatus, string> = {
  all: 'Went to all',
  some: 'Missed some',
  none: 'Missed all',
  unscheduled: 'No classes',
  future: 'Upcoming',
  unmarked: 'Not marked',
};

export default function HistoryPage() {
  const {
    ready, hasData, subjects, timetable, log, trends: storedTrends,
    settings, sampleMode, term, syncedAt, loadSample, loadErpData, setLogEntry,
  } = usePlanner();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { weights } = settings;

  const totals = useMemo(
    () =>
      subjects.map((s) => {
        let conducted = 0;
        let attended = 0;
        for (const k of COMPONENT_ORDER) {
          conducted += s.components[k]?.conducted ?? 0;
          attended += s.components[k]?.attended ?? 0;
        }
        return { code: s.code, title: s.title, conducted, attended, missed: conducted - attended, pct: weightedPct(s, weights) };
      }),
    [subjects, weights],
  );
  const termTotals = useMemo(
    () => totals.reduce((a, t) => ({ conducted: a.conducted + t.conducted, attended: a.attended + t.attended }), { conducted: 0, attended: 0 }),
    [totals],
  );
  const streaks = useMemo(() => computeStreaks(timetable, log), [timetable, log]);
  const mm = useMemo(() => missedMost(subjects), [subjects]);
  const buckets = useMemo(() => weekBuckets(timetable, log, 8), [timetable, log]);
  const trends = useMemo(
    () => (sampleMode ? storedTrends : trendsFromLog(timetable, log, subjects.map((s) => s.code))),
    [sampleMode, storedTrends, timetable, log, subjects],
  );

  const thisWeek = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7;
    let scheduled = 0;
    let went = 0;
    for (let d = 0; d <= dow; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - (dow - d));
      const iso = isoOf(date);
      const periods = scheduledFor(iso, timetable);
      const entries = log[iso] ?? {};
      const dayName = timetable.find((t) => t.day === ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()])?.day ?? '';
      for (const p of periods) {
        scheduled++;
        if (entries[classKey(dayName, p.period, p.subjectCode)] === true) went++;
      }
    }
    return { scheduled, went };
  }, [timetable, log]);

  // Calendar cells
  const cells = useMemo(() => {
    const first = new Date(calYear, calMonth, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const dim = new Date(calYear, calMonth + 1, 0).getDate();
    const arr: Array<{ iso: string; n: number } | null> = [];
    for (let i = 0; i < lead; i++) arr.push(null);
    for (let n = 1; n <= dim; n++) {
      arr.push({ iso: `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`, n });
    }
    return arr;
  }, [calYear, calMonth]);

  const monthName = new Date(calYear, calMonth, 1).toLocaleString('en', { month: 'long', year: 'numeric' });

  async function refreshRecord() {
    if (sampleMode || !term) return;
    setRefreshing(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        academicyear: term.academicyear,
        semesterid: term.semesterid,
        semester: term.semester,
      }).toString();
      const [attRes, ttRes] = await Promise.all([
        fetch(`/api/erp/attendance?${q}`),
        fetch(`/api/erp/timetable?${q}`),
      ]);
      const att = await attRes.json();
      const tt = await ttRes.json();
      if (!attRes.ok) throw new Error(att.error ?? 'Could not refresh attendance.');
      if (!ttRes.ok) throw new Error(tt.error ?? 'Could not refresh the timetable.');
      loadErpData(att.subjects ?? [], tt.days ?? [], term);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  if (!ready) return <Container className="py-10"><p className="text-sm text-neutral-500">Loading…</p></Container>;

  if (!hasData) {
    return (
      <Container className="py-10">
        <EmptyState
          title="No history yet"
          hint="Sync with the ERP or load sample data to see your attendance record."
          action={<Link href="/sync"><Button>Sync with the ERP</Button></Link>}
        />
      </Container>
    );
  }

  const selSummary = selectedDay ? daySummary(selectedDay, timetable, log) : null;
  const selPeriods = selectedDay ? scheduledFor(selectedDay, timetable) : [];
  const selEntries = selectedDay ? log[selectedDay] ?? {} : {};

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Your record</p>
          <h1 className="text-3xl font-bold">History</h1>
        </div>
        <div className="flex items-center gap-2">
          {syncedAt && <span className="text-xs text-neutral-500">Updated {new Date(syncedAt).toLocaleString()}</span>}
          {!sampleMode && term && (
            <Button variant="secondary" onClick={refreshRecord} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh the record'}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
      )}

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Classes this term</p>
          <p className="mt-1 text-2xl font-bold">{termTotals.attended}<span className="text-sm font-normal text-neutral-400">/{termTotals.conducted}</span></p>
          <p className="text-xs text-neutral-500">{termTotals.conducted - termTotals.attended} missed</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Streak</p>
          <p className="mt-1 text-2xl font-bold">{streaks.current}<span className="text-sm font-normal text-neutral-400"> days</span></p>
          <p className="text-xs text-neutral-500">Best: {streaks.best} days</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">This week</p>
          <p className="mt-1 text-2xl font-bold">{thisWeek.went}<span className="text-sm font-normal text-neutral-400">/{thisWeek.scheduled}</span></p>
          <p className="text-xs text-neutral-500">attended of scheduled</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Missed most</p>
          <p className="mt-1 truncate text-2xl font-bold">{mm ? mm.code : '—'}</p>
          <p className="truncate text-xs text-neutral-500">{mm ? `${mm.missed} missed · ${mm.title}` : 'Nothing missed yet'}</p>
        </Card>
      </div>

      {/* Calendar */}
      <SectionTitle eyebrow="Every day" title="Day by day" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="animate-rise p-4">
          <div className="mb-3 flex items-center justify-between">
            <Button variant="ghost" onClick={() => { const d = new Date(calYear, calMonth - 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }}>←</Button>
            <p className="font-bold">{monthName}</p>
            <Button variant="ghost" onClick={() => { const d = new Date(calYear, calMonth + 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }}>→</Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-neutral-400">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c, i) => {
              if (!c) return <div key={i} />;
              const s = daySummary(c.iso, timetable, log);
              const isSel = selectedDay === c.iso;
              return (
                <button
                  key={i}
                  title={`${c.iso}: ${STATUS_LABEL[s.status]}`}
                  onClick={() => setSelectedDay(isSel ? null : c.iso)}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition hover:ring-1 hover:ring-indigo-500',
                    STATUS_STYLE[s.status],
                    isSel && 'ring-2 ring-indigo-500',
                  )}
                >
                  {c.n}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Went to all</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Missed some</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Missed all</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-dashed border-neutral-400" />Not marked</span>
          </div>
        </Card>

        {/* Day detail / manual tracker */}
        <Card className="h-fit p-4">
          {selSummary && selectedDay ? (
            <>
              <p className="font-bold">{new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
              <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">{STATUS_LABEL[selSummary.status]} · {selSummary.present}/{selSummary.scheduled} attended</p>
              {selPeriods.length === 0 ? (
                <p className="text-sm text-neutral-500">No classes scheduled.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {selPeriods.map((p) => {
                    const dayName = timetable.find((t) => t.periods.includes(p))?.day ?? '';
                    const key = classKey(dayName, p.period, p.subjectCode);
                    const v = selEntries[key];
                    return (
                      <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold">{p.period} · {p.subjectCode}</p>
                          <p className="truncate text-[11px] text-neutral-500">{p.subjectTitle}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            title="Present"
                            onClick={() => setLogEntry(selectedDay, key, v === true ? null : true)}
                            className={cn('rounded-md px-2 py-1 text-xs font-bold', v === true ? 'bg-emerald-500 text-white' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800')}
                          >✓</button>
                          <button
                            title="Absent"
                            onClick={() => setLogEntry(selectedDay, key, v === false ? null : false)}
                            className={cn('rounded-md px-2 py-1 text-xs font-bold', v === false ? 'bg-red-500 text-white' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800')}
                          >✗</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                Tap ✓ / ✗ to track classes manually — this builds your streaks and weekly trends.
              </p>
            </>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Select a day to see its classes and mark attendance.
            </p>
          )}
        </Card>
      </div>

      {/* By subject */}
      <div className="mt-8">
        <SectionTitle eyebrow="By subject" title="Weighted, official-style" />
        <Card className="animate-rise overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="p-3 font-semibold">Subject</th>
                  <th className="p-3 font-semibold">Went</th>
                  <th className="p-3 font-semibold">Missed</th>
                  <th className="p-3 font-semibold">Trend</th>
                  <th className="p-3 text-right font-semibold">%</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.code} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td className="p-3">
                      <p className="font-bold">{t.code}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t.title}</p>
                    </td>
                    <td className="p-3">{t.attended}</td>
                    <td className="p-3">{t.missed}</td>
                    <td className="p-3"><Sparkline values={trends[t.code] ?? []} /></td>
                    <td className="p-3 text-right font-bold">{fmtPct(t.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* By week */}
      <div className="mt-8">
        <SectionTitle eyebrow="By week" title="Weekly record" />
        <Card className="animate-rise overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="p-3 font-semibold">Week of</th>
                  <th className="p-3 font-semibold">Classes</th>
                  <th className="p-3 font-semibold">Went</th>
                  <th className="p-3 font-semibold">Missed</th>
                  <th className="p-3 text-right font-semibold">%</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.weekStart} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td className="p-3 font-semibold">
                      {new Date(`${b.weekStart}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="p-3">{b.scheduled}</td>
                    <td className="p-3">{b.went}</td>
                    <td className="p-3">{b.missed}</td>
                    <td className="p-3 text-right font-bold">{fmtPct(b.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {buckets.every((b) => b.scheduled === 0 || (b.went === 0 && b.missed === 0)) && (
            <p className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
              No tracked days yet — mark classes on the calendar above to build weekly trends.
            </p>
          )}
        </Card>
      </div>

      {sampleMode && (
        <div className="mt-6">
          <Button variant="secondary" onClick={() => { loadSample(); }}>
            Reset sample data
          </Button>
        </div>
      )}
    </Container>
  );
}
