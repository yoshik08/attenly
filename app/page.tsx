'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { usePlanner } from '@/components/data-context';
import { ErpGate } from '@/components/erp-gate';
import {
  Chip,
  Container,
  CountUp,
  FuelGauge,
  GlassPanel,
  Stepper,
  bandChip,
  AMBER,
  MUTED,
} from '@/components/ui';
import { cn } from '@/components/cn';
import {
  COMPONENT_ORDER,
  COMPONENT_SHORT,
  bandLabel,
  courseTcbr,
  emptyPlan,
  fmtPct,
  policyBand,
  sandboxPct,
  weightedPct,
  weightedSums,
  type SandboxPlan,
  type SubjectAttendance,
} from '@/lib/math';
import { SUBJECT_COLORS } from '@/lib/sample-data';

function colorFor(code: string): string {
  if (SUBJECT_COLORS[code]) return SUBJECT_COLORS[code];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return `hsl(${h}, 80%, 62%)`;
}

function CourseCard({ subj, index }: { subj: SubjectAttendance; index: number }) {
  const { settings } = usePlanner();
  const { thresholds, weights, tcbr } = settings;
  const t = courseTcbr(subj.code, tcbr);
  const pct = weightedPct(subj, weights, t);
  const band = policyBand(pct, thresholds);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<SandboxPlan>(emptyPlan());
  const projected = sandboxPct(subj, weights, plan, t);
  const planActive = COMPONENT_ORDER.some((k) => plan[k].attend > 0 || plan[k].skip > 0);
  const setPlanFor = (k: (typeof COMPONENT_ORDER)[number], patch: Partial<{ attend: number; skip: number }>) =>
    setPlan((p) => ({ ...p, [k]: { ...p[k], ...patch } }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(0.05 * index, 0.4), duration: 0.4 }}
    >
      <GlassPanel className="overflow-hidden">
        <button onClick={() => setOpen((o) => !o)} className="block w-full p-5 text-left sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span
                className="rounded-lg px-2.5 py-1 text-xs font-black tracking-wide text-[#0A0A0B]"
                style={{ backgroundColor: colorFor(subj.code) }}
              >
                {subj.code}
              </span>
              <h2 className="font-display mt-2 text-xl font-black text-[#F5F4F0]">{subj.title}</h2>
            </div>
            <div className="flex items-center gap-3">
              <CountUp value={pct} className="font-display text-4xl font-black tabular-nums" />
              <Chip tone={bandChip(band)}>{bandLabel(band)}</Chip>
            </div>
          </div>
          <FuelGauge pct={pct} thresholds={thresholds} className="mt-4" />
          <div className={cn('mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs', MUTED)}>
            {COMPONENT_ORDER.map((k) => {
              const c = subj.components[k];
              if (!c || c.conducted - (t?.[k] ?? 0) <= 0) return null;
              const cp = c.conducted > 0 ? Math.round((c.attended / c.conducted) * 100) : 0;
              return (
                <span key={k}>
                  {COMPONENT_SHORT[k]} <b className="text-[#F5F4F0] tabular-nums">{c.attended}/{c.conducted}</b>{' '}
                  <span className="text-[#6B6B72]">· {cp}%</span>
                </span>
              );
            })}
          </div>
          <p className="mt-3 text-xs font-semibold text-[#6B6B72]">
            {open ? '▾ hide the what-if' : '▸ what if — rehearse the week'} 
          </p>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="border-t border-[#232327] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-[#F5F4F0]">
                    🧪 What if{' '}
                    <span className="font-normal text-[#A1A1A8]">— rehearse the week before you live it</span>
                  </p>
                  {planActive && (
                    <div className="flex items-center gap-2">
                      <span className="font-display text-xl font-black" style={{ color: AMBER }}>
                        → {fmtPct(projected)}
                      </span>
                      <button
                        onClick={() => setPlan(emptyPlan())}
                        className="text-xs font-semibold text-[#A1A1A8] hover:text-white hover:underline"
                      >
                        reset
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {COMPONENT_ORDER.map((k) => {
                    const c = subj.components[k];
                    if (!c || c.conducted - (t?.[k] ?? 0) <= 0) return null;
                    return (
                      <div key={k} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                        <span className="text-xs font-semibold text-[#F5F4F0]">{COMPONENT_SHORT[k]}</span>
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#34D399]/80">show up</span>
                            <Stepper small value={plan[k].attend} onChange={(v) => setPlanFor(k, { attend: v })} />
                          </div>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#F87171]/80">bunk</span>
                            <Stepper small value={plan[k].skip} onChange={(v) => setPlanFor(k, { skip: v })} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassPanel>
    </motion.div>
  );
}

export default function AttendancePage() {
  const { ready, hasData, subjects, settings, term, syncedAt, loadSnapshot } = usePlanner();
  const { status } = useSession();
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && !hasData) {
      const t = setTimeout(() => setWaited(true), 5000);
      return () => clearTimeout(t);
    }
  }, [status, hasData]);

  const { thresholds, weights, tcbr } = settings;
  const overall = useMemo(() => {
    let attW = 0;
    let condW = 0;
    for (const s of subjects) {
      const p = weightedSums(s, weights, courseTcbr(s.code, tcbr));
      attW += p.attW;
      condW += p.condW;
    }
    return condW > 0 ? Math.ceil((attW / condW) * 100) : null;
  }, [subjects, weights, tcbr]);

  if (!ready || status === 'loading') {
    return (
      <Container className="py-10">
        <p className={cn('text-sm', MUTED)}>Warming up…</p>
      </Container>
    );
  }

  if (!hasData) {
    // Signed in + linked but the snapshot is still arriving — brief patience,
    // then fall through to the gate (covers re-link).
    if (status === 'authenticated' && !waited) {
      return (
        <Container className="py-10">
          <p className={cn('text-sm', MUTED)}>Pulling your latest sync…</p>
        </Container>
      );
    }
    return (
      <Container>
        <ErpGate onLinked={loadSnapshot} />
      </Container>
    );
  }

  return (
    <Container className="py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#A1A1A8]">
            [ Attendance ]
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight text-[#F5F4F0] sm:text-5xl">
            Attendance
          </h1>
          {term && (
            <p className={cn('mt-2 text-sm', MUTED)}>
              {term.academicyear} · {term.semester}
              {syncedAt && <> · synced {new Date(syncedAt).toLocaleString()}</>}
            </p>
          )}
        </div>
        <GlassPanel className="w-full max-w-xs px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#A1A1A8]">Overall</p>
          <div className="flex items-baseline gap-2">
            <CountUp value={overall} className="font-display text-5xl font-black" suffix="%" />
            <span className="text-xs text-[#A1A1A8]">weighted</span>
          </div>
          <FuelGauge pct={overall} thresholds={thresholds} className="mt-3" />
        </GlassPanel>
      </div>

      <div className="flex flex-col gap-4">
        {subjects.map((s, i) => (
          <CourseCard key={s.code} subj={s} index={i} />
        ))}
      </div>
    </Container>
  );
}
