'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { usePlanner } from '@/components/data-context';
import {
  Button,
  Chip,
  Container,
  CountUp,
  EmptyState,
  GlassPanel,
  SectionHeader,
  Sparkline,
} from '@/components/ui';
import { cn } from '@/components/cn';
import { COMPONENT_ORDER, courseTcbr, fmtPct, weightedPct } from '@/lib/math';
import { classKey } from '@/lib/sample-data';
import { api } from '@/lib/api';
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
  all: 'bg-[#34D399]/15 text-[#34D399] font-bold border border-[#34D399]/25',
  some: 'bg-[#E9A13B]/15 text-[#E9A13B] font-bold border border-[#E9A13B]/25',
  none: 'bg-[#F87171]/15 text-[#F87171] font-bold border border-[#F87171]/25',
  unscheduled: 'text-slate-700',
  future: 'text-slate-600',
  unmarked: 'text-slate-500 border border-dashed border-white/15',
};

const STATUS_LABEL: Record<DayStatus, string> = {
  all: 'Full house',
  some: 'Patchy',
  none: 'Ghosted',
  unscheduled: 'Off day',
  future: 'Ahead',
  unmarked: 'Unlogged',
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

  const { weights, tcbr } = settings;

  const totals = useMemo(
    () =>
      subjects.map((s) => {
        let conducted = 0;
        let attended = 0;
        for (const k of COMPONENT_ORDER) {
          conducted += s.components[k]?.conducted ?? 0;
          attended += s.components[k]?.attended ?? 0;
        }
        return { code: s.code, title: s.title, conducted, attended, missed: conducted - attended, pct: weightedPct(s, weights, courseTcbr(s.code, tcbr)) };
      }),
    [subjects, weights, tcbr],
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

  const cells = useMemo(() => {
    const first = new Date(calYear, calMonth, 1);
    const lead = (first.getDay() + 6) % 7;
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
        fetch(api(`/api/erp/attendance?${q}`)),
        fetch(api(`/api/erp/timetable?${q}`)),
      ]);
      const att = await attRes.json();
      const tt = await ttRes.json();
      if (!attRes.ok) throw new Error(att.error ?? 'Could not refresh scores.');
      if (!ttRes.ok) throw new Error(tt.error ?? 'Could not refresh the timetable.');
      loadErpData(att.subjects ?? [], tt.days ?? [], term);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  if (!ready)
    return (
      <Container className="py-10">
        <p className="text-sm text-slate-500">Warming up…</p>
      </Container>
    );

  if (!hasData) {
    return (
      <Container className="py-12">
        <EmptyState
          title="No tape to rewind yet"
          hint="Link the ERP or load sample data and your track record will appear here."
          action={<Link href="/sync"><Button>Link your ERP</Button></Link>}
        />
      </Container>
    );
  }

  const selSummary = selectedDay ? daySummary(selectedDay, timetable, log) : null;
  const selPeriods = selectedDay ? scheduledFor(selectedDay, timetable) : [];
  const selEntries = selectedDay ? log[selectedDay] ?? {} : {};

  const statCards = [
    { kicker: 'Classes logged', big: `${termTotals.attended}`, small: `/ ${termTotals.conducted}`, sub: `${termTotals.conducted - termTotals.attended} slipped` },
    { kicker: 'Hot run', big: `${streaks.current}`, small: ' days', sub: `All-time best: ${streaks.best}` },
    { kicker: 'This week', big: `${thisWeek.went}`, small: `/ ${thisWeek.scheduled}`, sub: 'showed up of scheduled' },
    { kicker: 'Slipping most', big: mm ? mm.code : '—', small: '', sub: mm ? `${mm.missed} slipped · ${mm.title}` : 'Nothing slipped yet' },
  ];

  return (
    <Container className="py-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-bold tracking-[0.22em] text-[#A1A1A8] uppercase">Rewind</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Your track record<span style={{ color: "#E9A13B" }}>.</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {syncedAt && <span className="text-xs text-slate-500">Pulled {new Date(syncedAt).toLocaleString()}</span>}
          {!sampleMode && term && (
            <Button variant="glass" onClick={refreshRecord} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm font-medium text-rose-200">{error}</p>
      )}

      {/* stat cards */}
      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((c, i) => (
          <GlassPanel key={c.kicker} delay={0.05 * i} className="p-5">
            <p className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">{c.kicker}</p>
            <p className="font-display mt-1.5 truncate text-3xl font-bold text-white">
              {c.big}
              <span className="text-base font-medium text-slate-500">{c.small}</span>
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">{c.sub}</p>
          </GlassPanel>
        ))}
      </div>

      <SectionHeader kicker="The tape" title="Day by day" sub="Tap a day to mark the tape — it feeds your runs and weekly rhythm." />
      <div className="grid gap-6 lg:grid-cols-[1fr_330px]">
        <GlassPanel className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <Button variant="ghost" onClick={() => { const d = new Date(calYear, calMonth - 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }}>←</Button>
            <p className="font-display font-bold text-white">{monthName}</p>
            <Button variant="ghost" onClick={() => { const d = new Date(calYear, calMonth + 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }}>→</Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-500">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((c, i) => {
              if (!c) return <div key={i} />;
              const s = daySummary(c.iso, timetable, log);
              const isSel = selectedDay === c.iso;
              return (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.94 }}
                  title={`${c.iso}: ${STATUS_LABEL[s.status]}`}
                  onClick={() => setSelectedDay(isSel ? null : c.iso)}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center rounded-2xl text-sm transition',
                    STATUS_STYLE[s.status],
                    isSel && 'ring-2 ring-[#E9A13B]',
                  )}
                >
                  {c.n}
                </motion.button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#34D399]" />Full house</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#E9A13B]" />Patchy</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#F87171]" />Ghosted</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-dashed border-slate-500" />Unlogged</span>
          </div>
        </GlassPanel>

        {/* day detail */}
        <GlassPanel className="h-fit p-5">
          {selSummary && selectedDay ? (
            <>
              <p className="font-display font-bold text-white">{new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
              <p className="mb-4 text-xs text-slate-500">{STATUS_LABEL[selSummary.status]} · {selSummary.present}/{selSummary.scheduled} showed up</p>
              {selPeriods.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing on the timetable.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {selPeriods.map((p) => {
                    const dayName = timetable.find((t) => t.periods.includes(p))?.day ?? '';
                    const key = classKey(dayName, p.period, p.subjectCode);
                    const v = selEntries[key];
                    return (
                      <div key={key} className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-white">{p.period} · {p.subjectCode}</p>
                          <p className="truncate text-[11px] text-slate-500">{p.subjectTitle}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <motion.button
                            whileTap={{ scale: 0.85 }}
                            title="Showed up"
                            onClick={() => setLogEntry(selectedDay, key, v === true ? null : true)}
                            className={cn('rounded-xl px-2.5 py-1.5 text-xs font-black', v === true ? 'bg-[#34D399] text-[#0A0A0B]' : 'bg-white/[0.06] text-[#A1A1A8]')}
                          >✓</motion.button>
                          <motion.button
                            whileTap={{ scale: 0.85 }}
                            title="Bunked"
                            onClick={() => setLogEntry(selectedDay, key, v === false ? null : false)}
                            className={cn('rounded-xl px-2.5 py-1.5 text-xs font-black', v === false ? 'bg-[#F87171] text-[#0A0A0B]' : 'bg-white/[0.06] text-[#A1A1A8]')}
                          >✗</motion.button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
                Mark the tape and your hot runs plus weekly rhythm build themselves.
              </p>
            </>
          ) : (
            <>
              <p className="font-display font-bold text-white">Mark the tape</p>
              <p className="mt-1 text-sm text-slate-500">Pick a day on the calendar to log what actually happened, class by class.</p>
            </>
          )}
        </GlassPanel>
      </div>

      {/* courses table */}
      <div className="mt-10">
        <SectionHeader kicker="The full picture" title="Course scores" sub="Weighted the official way — lectures, tutorials, labs and skilling all count differently." />
        <GlassPanel className="overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-xs text-slate-500">
                  <th className="p-4 font-bold tracking-wider uppercase">Course</th>
                  <th className="p-4 font-bold tracking-wider uppercase">Showed</th>
                  <th className="p-4 font-bold tracking-wider uppercase">Slipped</th>
                  <th className="p-4 font-bold tracking-wider uppercase">Drift</th>
                  <th className="p-4 text-right font-bold tracking-wider uppercase">Score</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.code} className="border-b border-white/[0.05] last:border-0 transition hover:bg-white/[0.02]">
                    <td className="p-4">
                      <p className="font-bold text-white">{t.code}</p>
                      <p className="text-xs text-slate-500">{t.title}</p>
                    </td>
                    <td className="p-4 text-slate-300">{t.attended}</td>
                    <td className="p-4 text-slate-300">{t.missed}</td>
                    <td className="p-4"><Sparkline values={trends[t.code] ?? []} /></td>
                    <td className="p-4 text-right">
                      <CountUp value={t.pct} className="font-display text-lg font-bold text-white tabular-nums" duration={0.5} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </div>

      {/* weeks table */}
      <div className="mt-10">
        <SectionHeader kicker="Rhythm" title="Week by week" />
        <GlassPanel className="overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-xs text-slate-500">
                  <th className="p-4 font-bold tracking-wider uppercase">Week of</th>
                  <th className="p-4 font-bold tracking-wider uppercase">On deck</th>
                  <th className="p-4 font-bold tracking-wider uppercase">Showed</th>
                  <th className="p-4 font-bold tracking-wider uppercase">Slipped</th>
                  <th className="p-4 text-right font-bold tracking-wider uppercase">Hit rate</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.weekStart} className="border-b border-white/[0.05] last:border-0 transition hover:bg-white/[0.02]">
                    <td className="p-4 font-semibold text-white">
                      {new Date(`${b.weekStart}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="p-4 text-slate-300">{b.scheduled}</td>
                    <td className="p-4 text-slate-300">{b.went}</td>
                    <td className="p-4 text-slate-300">{b.missed}</td>
                    <td className="p-4 text-right font-bold text-white">{fmtPct(b.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {buckets.every((b) => b.scheduled === 0 || (b.went === 0 && b.missed === 0)) && (
            <p className="px-5 py-4 text-xs text-slate-500">
              Quiet so far — mark days on the tape above and the rhythm fills in.
            </p>
          )}
        </GlassPanel>
      </div>

      {sampleMode && (
        <div className="mt-8 flex items-center gap-3">
          <Chip tone="violet">Sample orbit</Chip>
          <Button variant="glass" onClick={loadSample}>Reshuffle sample data</Button>
        </div>
      )}
    </Container>
  );
}
