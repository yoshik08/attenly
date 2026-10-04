'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlanner } from '@/components/data-context';
import {
  Button,
  Chip,
  Container,
  CountUp,
  FuelGauge,
  GlassPanel,
  SectionHeader,
  Stepper,
  bandChip,
} from '@/components/ui';
import Landing from '@/components/landing';
import { cn } from '@/components/cn';
import {
  COMPONENT_ORDER,
  COMPONENT_SHORT,
  bandLabel,
  classImpact,
  courseTcbr,
  emptyPlan,
  fmtDelta,
  fmtPct,
  fmtRunway,
  neededToReach,
  policyBand,
  sandboxPct,
  skipGuidance,
  skipMargin,
  weightedPct,
  weightedSums,
  type ComponentKey,
  type SandboxPlan,
  type SubjectAttendance,
} from '@/lib/math';
import { SUBJECT_COLORS } from '@/lib/sample-data';
import type { TimetableDay } from '@/lib/erp/parsers';

function colorFor(code: string): string {
  if (SUBJECT_COLORS[code]) return SUBJECT_COLORS[code];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return `hsl(${h}, 80%, 62%)`;
}

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function allPeriods(timetable: TimetableDay[]): string[] {
  const set = new Map<string, { order: number; start: string }>();
  for (const d of timetable) {
    for (const p of d.periods) {
      if (!set.has(p.period)) {
        const n = parseInt(p.period.replace(/\D/g, ''), 10);
        set.set(p.period, { order: Number.isNaN(n) ? 999 : n, start: p.start });
      }
    }
  }
  return [...set.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].start.localeCompare(b[1].start))
    .map(([k]) => k);
}

/** Ceiling score if you show up to everything left this week. */
function ceilingPct(
  subj: SubjectAttendance,
  timetable: TimetableDay[],
  weights: Record<ComponentKey, number>,
): number | null {
  const { attW, condW } = weightedSums(subj, weights);
  if (condW <= 0) return null;
  const jsDay = new Date().getDay();
  const todayIdx = jsDay === 0 ? 7 : jsDay;
  let remW = 0;
  for (const d of timetable) {
    const idx = DAY_ORDER.indexOf(d.day) + 1;
    if (idx < todayIdx) continue;
    for (const p of d.periods) {
      if (p.subjectCode === subj.code) remW += weights[p.type ?? 'L'] ?? 0;
    }
  }
  return Math.ceil(((attW + remW) / (condW + remW)) * 100);
}

export default function PlanPage() {
  const { ready, hasData, subjects, timetable, settings, term, syncedAt } = usePlanner();
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<SandboxPlan>(emptyPlan());

  const periods = useMemo(() => allPeriods(timetable), [timetable]);
  const days = useMemo(
    () => DAY_ORDER.map((d) => timetable.find((t) => t.day === d)).filter(Boolean) as TimetableDay[],
    [timetable],
  );
  const selSubj = useMemo(
    () => subjects.find((s) => s.code === selected) ?? subjects[0] ?? null,
    [subjects, selected],
  );

  const { thresholds, weights, tcbr } = settings;
  const selTcbr = selSubj ? courseTcbr(selSubj.code, tcbr) : undefined;

  const overall = useMemo(() => {
    let attW = 0;
    let condW = 0;
    for (const s of subjects) {
      const t = courseTcbr(s.code, tcbr);
      const p = weightedSums(s, weights, t);
      attW += p.attW;
      condW += p.condW;
    }
    return condW > 0 ? Math.ceil((attW / condW) * 100) : null;
  }, [subjects, weights, tcbr]);

  if (!ready)
    return (
      <Container className="py-10">
        <p className="text-sm text-slate-500">Warming up…</p>
      </Container>
    );

  if (!hasData) {
    return <Landing />;
  }

  const pct = selSubj ? weightedPct(selSubj, weights, selTcbr) : null;
  const ceiling = selSubj ? ceilingPct(selSubj, timetable, weights) : null;
  const band = policyBand(pct, thresholds);
  const guide = selSubj ? skipGuidance(selSubj, weights, thresholds, selTcbr) : null;
  const projected = selSubj ? sandboxPct(selSubj, weights, plan, selTcbr) : null;
  const planActive = COMPONENT_ORDER.some((k) => plan[k].attend > 0 || plan[k].skip > 0);

  const setPlanFor = (k: ComponentKey, patch: Partial<{ attend: number; skip: number }>) =>
    setPlan((p) => ({ ...p, [k]: { ...p[k], ...patch } }));

  const pickCourse = (code: string) => {
    setSelected(code);
    setPlan(emptyPlan());
  };

  return (
    <Container className="py-8">
      {/* hero */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-bold tracking-[0.22em] text-lime-300/90 uppercase">
            Game plan
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Know the cost of
            <span className="bg-gradient-to-r from-violet-400 via-cyan-300 to-lime-300 bg-clip-text text-transparent"> every bunk.</span>
          </h1>
          {term && (
            <p className="mt-2 text-sm text-slate-400">
              {term.academicyear} · {term.semester}
              {syncedAt && <> · pulled {new Date(syncedAt).toLocaleString()}</>}
            </p>
          )}
        </div>
        <GlassPanel className="w-full max-w-xs px-5 py-4">
          <p className="text-[11px] font-bold tracking-[0.18em] text-slate-400 uppercase">Overall score</p>
          <div className="flex items-baseline gap-2">
            <CountUp value={overall} className="font-display text-glow-mint text-5xl font-bold text-white" />
            <span className="text-xs text-slate-500">weighted</span>
          </div>
          <FuelGauge pct={overall} thresholds={thresholds} className="mt-3" />
        </GlassPanel>
      </div>

      {/* course deep-dive */}
      {selSubj && (
        <GlassPanel className="mb-6 p-5 sm:p-6" key={selSubj.code}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: colorFor(selSubj.code), boxShadow: `0 0 12px ${colorFor(selSubj.code)}` }} />
                <p className="text-xs font-bold tracking-[0.18em] text-slate-400 uppercase">{selSubj.code}</p>
                {selTcbr && <Chip tone="cyan">Late-joiner fix on</Chip>}
              </div>
              <h2 className="font-display mt-1 text-2xl font-bold text-white">{selSubj.title}</h2>
            </div>
            <div className="flex items-center gap-3">
              <CountUp value={pct} className="font-display text-4xl font-bold text-white tabular-nums" />
              <Chip tone={bandChip(band)}>{bandLabel(band)}</Chip>
            </div>
          </div>

          <FuelGauge pct={pct} thresholds={thresholds} className="mt-4" />
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
            <span>
              Bunk balance:{' '}
              <b className="text-lime-200">{guide ? fmtRunway(guide.keepCruising) : '—'}</b>{' '}
              <span className="text-slate-500">to stay cruising</span>
            </span>
            {ceiling != null && (
              <span>
                Ceiling this week: <b className="text-cyan-200">{fmtPct(ceiling)}</b>{' '}
                <span className="text-slate-500">if you show up to everything left</span>
              </span>
            )}
          </div>

          {/* per-component bunk balance + catch-up */}
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {COMPONENT_ORDER.map((k, i) => {
              const c = selSubj.components[k];
              if (!c || c.conducted - (selTcbr?.[k] ?? 0) <= 0) return null;
              const margin = skipMargin(selSubj, weights, thresholds.safeAt, k, selTcbr);
              const need = neededToReach(selSubj, weights, thresholds.safeAt, k, selTcbr);
              const cp = (c.attended / c.conducted) * 100;
              return (
                <motion.div
                  key={k}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.4 }}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-300">{COMPONENT_SHORT[k]}</p>
                    <p className="text-xs font-bold text-white tabular-nums">
                      {c.attended}/{c.conducted} <span className="font-normal text-slate-500">· {Math.round(cp)}%</span>
                    </p>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {margin > 0 ? (
                      <>🎯 <b className="text-lime-200">{fmtRunway(margin)}</b> before {thresholds.safeAt}% slips</>
                    ) : need > 0 && Number.isFinite(need) ? (
                      <>🛟 show up <b className="text-amber-200">{need} in a row</b> to climb back to {thresholds.safeAt}%</>
                    ) : (
                      <>🧊 right on the edge — every class counts</>
                    )}
                  </p>
                </motion.div>
              );
            })}
          </div>

          {/* what-if lab */}
          <div className="mt-5 rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-white">
                🧪 What-if lab{' '}
                <span className="font-normal text-slate-400">— rehearse the week before you live it</span>
              </p>
              {planActive && (
                <div className="flex items-center gap-2">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={projected}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="font-display text-xl font-bold text-cyan-200"
                    >
                      → {fmtPct(projected)}
                    </motion.span>
                  </AnimatePresence>
                  <button onClick={() => setPlan(emptyPlan())} className="text-xs font-semibold text-slate-400 hover:text-white hover:underline">
                    reset
                  </button>
                </div>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {COMPONENT_ORDER.map((k) => {
                const c = selSubj.components[k];
                if (!c || c.conducted - (selTcbr?.[k] ?? 0) <= 0) return null;
                return (
                  <div key={k} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                    <span className="text-xs font-semibold text-slate-300">{COMPONENT_SHORT[k]}</span>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-bold tracking-wide text-lime-300/80 uppercase">show up</span>
                        <Stepper small value={plan[k].attend} onChange={(v) => setPlanFor(k, { attend: v })} />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-bold tracking-wide text-rose-300/80 uppercase">bunk</span>
                        <Stepper small value={plan[k].skip} onChange={(v) => setPlanFor(k, { skip: v })} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </GlassPanel>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_330px]">
        {/* timetable */}
        <div>
          <SectionHeader kicker="This week" title="The grid" sub="Tap a class to inspect its course. The chip is what that class is worth if you show up." />
          <GlassPanel className="overflow-hidden">
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-14 p-2 text-left" />
                    {days.map((d) => (
                      <th key={d.day} className="border-b border-white/[0.08] p-2.5 text-left text-xs font-bold tracking-wider text-slate-400 uppercase">
                        {d.day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((per) => (
                    <tr key={per}>
                      <td className="border-b border-white/[0.05] p-2 align-top text-xs font-bold text-slate-500">{per}</td>
                      {days.map((d) => {
                        const p = d.periods.find((x) => x.period === per);
                        if (!p)
                          return <td key={d.day} className="border-b border-white/[0.05] p-1" />;
                        const subj = subjects.find((s) => s.code === p.subjectCode);
                        const impact = subj ? classImpact(subj, weights, p.type ?? 'L', subj.code === selSubj?.code ? selTcbr : courseTcbr(subj.code, tcbr)) : null;
                        const isSel = selSubj?.code === p.subjectCode;
                        return (
                          <td key={d.day} className="border-b border-white/[0.05] p-1 align-top">
                            <motion.button
                              whileHover={{ scale: 1.03, y: -1 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => pickCourse(p.subjectCode)}
                              title={`${p.subjectTitle}${p.room ? ` · ${p.room}` : ''}${p.start ? ` · ${p.start}–${p.end}` : ''}`}
                              className={cn(
                                'w-full rounded-2xl border p-2.5 text-left backdrop-blur transition',
                                isSel
                                  ? 'border-lime-300/50 bg-lime-300/[0.07] shadow-[0_0_20px_-6px_rgba(163,230,53,0.5)]'
                                  : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]',
                              )}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(p.subjectCode), boxShadow: `0 0 8px ${colorFor(p.subjectCode)}` }} />
                                <span className="truncate text-xs font-bold text-white">{p.subjectCode}</span>
                              </div>
                              {p.room && <p className="mt-0.5 truncate text-[11px] text-slate-500">{p.room}</p>}
                              {impact && impact.gain >= 1 && (
                                <span
                                  className="mt-1.5 inline-block rounded-full bg-lime-300/15 px-1.5 py-px text-[11px] font-bold text-lime-200"
                                  title={`Showing up adds ${fmtDelta(impact.gain)} pts · bunking costs ${fmtDelta(impact.loss)} pts`}
                                >
                                  {fmtDelta(impact.gain)}
                                </span>
                              )}
                            </motion.button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassPanel>
        </div>

        {/* course lineup */}
        <div>
          <SectionHeader kicker="The lineup" title="Courses" />
          <div className="flex flex-col gap-3">
            {subjects.map((s, i) => {
              const t = courseTcbr(s.code, tcbr);
              const sp = weightedPct(s, weights, t);
              const b = policyBand(sp, thresholds);
              const g = skipGuidance(s, weights, thresholds, t);
              const isSel = selSubj?.code === s.code;
              return (
                <motion.button
                  key={s.code}
                  initial={{ opacity: 0, x: 24 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.04 * i, duration: 0.4 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => pickCourse(s.code)}
                  className={cn(
                    'rounded-3xl border p-4 text-left backdrop-blur-xl transition',
                    isSel
                      ? 'border-lime-300/40 bg-white/[0.07] shadow-[0_0_28px_-8px_rgba(163,230,53,0.4)]'
                      : 'border-white/[0.08] bg-white/[0.04] hover:border-white/20',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(s.code), boxShadow: `0 0 10px ${colorFor(s.code)}` }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{s.code}</p>
                      <p className="truncate text-xs text-slate-400">{s.title}</p>
                    </div>
                    <CountUp value={sp} className="font-display text-xl font-bold text-white tabular-nums" duration={0.6} />
                  </div>
                  <FuelGauge pct={sp} thresholds={thresholds} className="mt-3" />
                  <div className="mt-2 flex items-center justify-between">
                    <Chip tone={bandChip(b)} className="text-[10px]">{bandLabel(b)}</Chip>
                    <span className="text-[11px] text-slate-500">
                      bunk balance <b className="text-slate-200">{Number.isFinite(g.keepCruising) ? g.keepCruising : '∞'}</b>
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    </Container>
  );
}
