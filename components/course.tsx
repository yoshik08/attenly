'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CaretDown, MapPin, Minus, Plus } from '@phosphor-icons/react';
import { BubbleSheet, type Future } from './bubbles';
import { Figure } from './motion';
import { cn } from './cn';
import {
  bandLabel,
  courseTcbr,
  countOf,
  emptyPlan,
  policyBand,
  sandboxPct,
  COMPONENT_PLURAL,
  type ComponentKey,
  type SandboxPlan,
  type SubjectAttendance,
} from '@/lib/math';
import { whenLabel, type CourseDelta, type CourseSummary, type NextClass } from '@/lib/insights';
import type { Settings } from './store';

export const BAND_INK = {
  cruising: 'text-cruise',
  'thin-ice': 'text-thin',
  'in-the-red': 'text-red',
} as const;

function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        className="press inline-flex h-11 w-11 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark disabled:opacity-30"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        aria-label={`${label}: one fewer`}
      >
        <Minus size={16} aria-hidden />
      </button>
      <span className="figure w-8 text-center text-[20px]" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="press inline-flex h-11 w-11 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark disabled:opacity-30"
        onClick={() => onChange(Math.min(60, value + 1))}
        disabled={value >= 60}
        aria-label={`${label}: one more`}
      >
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
}

export function CourseRow({
  subject,
  summary,
  settings,
  delta,
  next,
  onSeen,
  countUp,
}: {
  subject: SubjectAttendance;
  summary: CourseSummary;
  settings: Settings;
  delta: CourseDelta[];
  next: NextClass | null;
  onSeen: (code: string) => void;
  countUp: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<SandboxPlan>(emptyPlan);
  const ref = useRef<HTMLElement>(null);
  const tcbr = courseTcbr(subject.code, settings.tcbr);
  const planning = Object.values(plan).some((p) => p.attend > 0 || p.skip > 0);
  const projected = planning ? sandboxPct(subject, settings.weights, plan, tcbr) : summary.pct;
  const projectedBand = policyBand(projected, settings.thresholds);
  const { thresholds } = settings;
  const hasDelta = delta.length > 0;

  // A change from the last sync stays lit until the row has been in view.
  useEffect(() => {
    if (!hasDelta || !ref.current || typeof IntersectionObserver === 'undefined') return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) timer = window.setTimeout(() => onSeen(subject.code), 1600);
        else if (timer) window.clearTimeout(timer);
      },
      { threshold: 0.6 },
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [hasDelta, onSeen, subject.code]);

  const setFor = (k: ComponentKey, patch: Partial<{ attend: number; skip: number }>) =>
    setPlan((p) => ({ ...p, [k]: { ...p[k], ...patch } }));

  const futureFor = (k: ComponentKey): Future => {
    if (planning) return { kind: 'plan', attend: plan[k].attend, skip: plan[k].skip };
    const c = summary.components.find((x) => x.k === k);
    if (!c || summary.pct == null) return null;
    if (summary.band === 'cruising') return c.cruise ? { kind: 'spare', count: c.cruise.spare } : null;
    if (summary.band === 'thin-ice') return c.cruise ? { kind: 'need', count: c.cruise.needed, tone: 'thin' } : null;
    return c.floor ? { kind: 'need', count: c.floor.needed, tone: 'red' } : null;
  };

  const deltaText = delta
    .map((d) => [d.attended > 0 && `+${countOf(d.attended, d.k)} attended`, d.missed > 0 && `+${countOf(d.missed, d.k)} missed`].filter(Boolean).join(', '))
    .join(', ');

  return (
    <article ref={ref} id={`course-${subject.code}`} className="seam-b scroll-mt-24 py-5" aria-label={summary.title}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-snug pretty">{summary.title}</h3>
          <p className="mt-0.5 text-[13px] text-dropout-quiet tnum">{subject.code}</p>
          {hasDelta && (
            <p className="mt-2 inline-flex rounded-full bg-[#0d1a14] px-2.5 py-1 text-[12px] font-medium text-cruise">
              {deltaText} since you last looked
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {summary.pct == null ? (
            <p className="pt-1 text-[13px] text-dropout-quiet">No classes yet</p>
          ) : (
            <>
              <Figure value={summary.pct} countUp={countUp} className="figure block text-[34px]" />
              <p className={cn('mt-1 text-[13px] font-semibold', BAND_INK[summary.band])}>{bandLabel(summary.band)}</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {summary.components.map((c) => {
          const d = delta.find((x) => x.k === c.k);
          const pre = tcbr?.[c.k] ?? 0;
          return (
            <div key={c.k} className="grid grid-cols-[88px_1fr] items-start gap-3">
              <p className="text-[12px] leading-[14px] text-dropout-text">
                {c.label}
                <span className="mt-0.5 block text-[12px] text-mark tnum">
                  {c.attended}/{Math.max(0, c.effective)}
                </span>
              </p>
              <BubbleSheet
                attended={c.attended}
                conducted={c.conducted}
                pre={pre}
                future={futureFor(c.k)}
                newAttended={d?.attended ?? 0}
                newMissed={d?.missed ?? 0}
                label={`${c.label}: attended ${c.attended} of ${Math.max(0, c.effective)}`}
              />
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[14px] text-mark pretty">{summary.verdict}</p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {next ? (
          <Link
            href={`/timetable?day=${next.day}#slot-${next.day}-${next.period.period}`}
            className="press inline-flex min-h-9 items-center gap-1.5 rounded-full text-[13px] text-dropout-text hover:text-mark"
          >
            <MapPin size={15} aria-hidden />
            Next class {whenLabel(next)}
            {next.period.room ? ` in ${next.period.room}` : ''}
          </Link>
        ) : (
          <span />
        )}
        {summary.pct != null && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`plan-${subject.code}`}
          className="t-acc press inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-mark ring-seam"
          data-open={open}
        >
          Plan the week
          <span className="t-acc-chevron">
            <CaretDown size={14} aria-hidden />
          </span>
        </button>
        )}
      </div>

      <div className="t-acc" data-open={open}>
        <div className="t-acc-panel" id={`plan-${subject.code}`}>
          <div className="t-acc-panel-inner">
            <div className="mt-4 rounded-2xl bg-[#05070b] p-4 ring-seam" inert={!open}>
              <div className="flex flex-col gap-3">
                {summary.components
                  .filter((c) => c.effective > 0)
                  .map((c) => (
                    <div key={c.k} className="grid grid-cols-[1fr] gap-y-1 sm:grid-cols-[96px_1fr_1fr] sm:items-center sm:gap-x-4">
                      <p className="text-[13px] font-medium">{c.label}</p>
                      <div className="grid grid-cols-[52px_auto] items-center justify-start">
                        <span className="text-[12px] text-dropout-text">Attend</span>
                        <Stepper value={plan[c.k].attend} onChange={(v) => setFor(c.k, { attend: v })} label={`Attend upcoming ${COMPONENT_PLURAL[c.k]}`} />
                      </div>
                      <div className="grid grid-cols-[52px_auto] items-center justify-start">
                        <span className="text-[12px] text-dropout-text">Skip</span>
                        <Stepper value={plan[c.k].skip} onChange={(v) => setFor(c.k, { skip: v })} label={`Skip upcoming ${COMPONENT_PLURAL[c.k]}`} />
                      </div>
                    </div>
                  ))}
              </div>
              <div className="seam-t mt-4 flex items-end justify-between gap-3 pt-4">
                <div>
                  <p className="text-[13px] text-dropout-text">{planning ? 'After that plan' : 'Add classes to see where you’d land'}</p>
                  {planning && (
                    <p className={cn('mt-1 text-[13px] font-semibold', BAND_INK[projectedBand])}>
                      {bandLabel(projectedBand)}
                      {projected != null && projected < thresholds.safeAt && projected >= thresholds.condonationFrom ? `, under ${thresholds.safeAt}%` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-end gap-3">
                  {planning && (
                    <button type="button" className="press min-h-9 rounded-full px-3 text-[13px] text-dropout-text hover:text-mark" onClick={() => setPlan(emptyPlan())}>
                      Reset
                    </button>
                  )}
                  <Figure value={projected} className={cn('figure text-[40px]', planning ? BAND_INK[projectedBand] : 'text-dropout-quiet')} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
