'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CaretDown, MapPin, Minus, Plus } from '@phosphor-icons/react';
import { BubbleSheet, type Future } from './bubbles';
import { Figure } from './motion';
import { Ring } from './ring';
import { cn } from './cn';
import {
  courseTcbr,
  countOf,
  emptyPlan,
  sandboxPct,
  COMPONENT_PLURAL,
  STATUS_LABEL,
  statusOf,
  type ComponentKey,
  type SandboxPlan,
  type Status,
  type SubjectAttendance,
} from '@/lib/math';
import { whenLabel, type CourseDelta, type CourseSummary, type NextClass } from '@/lib/insights';
import type { Settings } from './store';

export const STATUS_INK: Record<Status, string> = {
  safe: 'text-cruise',
  condonation: 'text-thin',
  // The medical band shares the red ink with a detention (a dimmed red failed
  // AA); the badge says which one it is, and only detention is filled solid.
  medical: 'text-red',
  detained: 'text-red',
};

/** Badge for a course's band: tinted with its ink, filled solid only when detained. */
export const STATUS_BADGE: Record<Status, string> = {
  safe: 'text-cruise bg-[#3ddc97]/10 ring-[#3ddc97]/30',
  condonation: 'text-thin bg-[#f5b544]/10 ring-[#f5b544]/30',
  medical: 'text-red bg-[#ff6b5e]/10 ring-[#ff6b5e]/25',
  detained: 'bg-[#ff6b5e] text-black ring-[#ff6b5e]',
};

export function StatusBadge({ status, className }: { status: Status | null; className?: string }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        STATUS_BADGE[status],
        className,
      )}
    >
      <span className="dot bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        className="press inline-flex h-9 w-9 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark disabled:opacity-30"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        aria-label={`${label}: one fewer`}
      >
        <Minus size={15} aria-hidden />
      </button>
      <span className="figure w-7 text-center text-[18px]" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="press inline-flex h-9 w-9 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark disabled:opacity-30"
        onClick={() => onChange(Math.min(60, value + 1))}
        disabled={value >= 60}
        aria-label={`${label}: one more`}
      >
        <Plus size={15} aria-hidden />
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
  const projectedStatus = statusOf(projected);
  const status = summary.status;
  const { target } = settings;
  const hasDelta = delta.length > 0;
  const detailId = `detail-${subject.code}`;

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

  // Arriving from the timetable (#course-CODE) opens the card's plan.
  useEffect(() => {
    const go = () => {
      if (decodeURIComponent(window.location.hash.slice(1)) === `course-${subject.code}`) setOpen(true);
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [subject.code]);

  const setFor = (k: ComponentKey, patch: Partial<{ attend: number; skip: number }>) =>
    setPlan((p) => ({ ...p, [k]: { ...p[k], ...patch } }));

  const futureFor = (k: ComponentKey): Future => {
    if (planning) return { kind: 'plan', attend: plan[k].attend, skip: plan[k].skip };
    const c = summary.components.find((x) => x.k === k);
    if (!c || summary.pct == null || !c.budget) return null;
    if (summary.pct >= target) return { kind: 'spare', count: c.budget.spare };
    return { kind: 'need', count: c.budget.needed, tone: status === 'condonation' ? 'thin' : 'red' };
  };

  const deltaText = delta
    .map((d) =>
      [
        d.attended > 0 && `+${countOf(d.attended, d.k)} attended`,
        d.missed > 0 && `+${countOf(d.missed, d.k)} missed`,
      ]
        .filter(Boolean)
        .join(', '),
    )
    .join(', ');


  return (
    <article ref={ref} id={`course-${subject.code}`} className="scroll-mt-24 rounded-2xl p-4 ring-seam" aria-label={summary.title}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={detailId}
        className="press flex w-full items-start justify-between gap-4 text-left"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-dropout-quiet tnum">{subject.code}</span>
            <StatusBadge status={status} />
          </span>
          <span className="mt-1.5 block text-[16px] font-semibold leading-snug pretty">{summary.title}</span>
          <span className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {summary.components.map((c) => (
              <span key={c.k} className="text-[12px] text-dropout-text">
                {c.label}{' '}
                <span className="font-semibold text-mark tnum">
                  {c.attended}/{Math.max(0, c.effective)}
                </span>
              </span>
            ))}
            {summary.components.length === 0 && (
              <span className="text-[12px] text-dropout-quiet">No classes counted yet</span>
            )}
          </span>
          {hasDelta && (
            <span className="mt-2.5 inline-flex rounded-full bg-[#0d1a14] px-2.5 py-1 text-[12px] font-medium text-cruise">
              {deltaText} since you last looked
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-2.5">
          <Ring value={summary.pct} tone={status ? STATUS_INK[status] : 'text-dropout'} size={64} stroke={6}>
            <Figure value={summary.pct} countUp={countUp} className="figure text-[17px]" />
          </Ring>
          <span className="inline-flex items-center gap-1 text-[12px] text-dropout-text">
            {open ? 'Hide plan' : 'Plan'}
            <span className="t-acc-chevron" aria-hidden>
              <CaretDown size={13} />
            </span>
          </span>
        </span>
      </button>

      {next && (
        <Link
          href={`/timetable?day=${next.day}#slot-${next.day}-${next.period.period}`}
          className="press mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full text-[13px] text-dropout-text hover:text-mark"
        >
          <MapPin size={15} aria-hidden />
          Next class {whenLabel(next)}
          {next.period.room ? ` in ${next.period.room}` : ''}
        </Link>
      )}


      <div className="t-acc" data-open={open}>
        <div className="t-acc-panel" id={detailId}>
          <div className="t-acc-panel-inner">
            <div className="pt-4" inert={!open}>
              <div className="flex flex-col gap-4">
                {summary.components.map((c) => {
                  const d = delta.find((x) => x.k === c.k);
                  const pre = tcbr?.[c.k] ?? 0;
                  return (
                    <div key={c.k}>
                      <p className="text-[13px] text-dropout-text">
                        {c.label}{' '}
                        <span className="font-semibold text-mark tnum">
                          {c.attended}/{Math.max(0, c.effective)}
                        </span>
                      </p>
                      <div className="mt-2">
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
                      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] text-dropout-text">Attend</span>
                          <Stepper
                            value={plan[c.k].attend}
                            onChange={(v) => setFor(c.k, { attend: v })}
                            label={`Attend upcoming ${COMPONENT_PLURAL[c.k]}`}
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] text-dropout-text">Skip</span>
                          <Stepper
                            value={plan[c.k].skip}
                            onChange={(v) => setFor(c.k, { skip: v })}
                            label={`Skip upcoming ${COMPONENT_PLURAL[c.k]}`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>


              <div className="seam-t mt-4 flex flex-wrap items-end justify-between gap-3 pt-4">
                <div className="min-w-0">
                  <p className="text-[13px] text-dropout-text">
                    {planning ? 'After that plan' : 'Add classes to see where you’d land'}
                  </p>
                  {planning && projectedStatus && (
                    <p className={cn('mt-1 text-[13px] font-semibold', STATUS_INK[projectedStatus])}>
                      {STATUS_LABEL[projectedStatus]}
                      {projected != null && projected < target && projected >= 75 ? `, under ${target}%` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-end gap-3">
                  {planning && (
                    <button
                      type="button"
                      className="press min-h-9 rounded-full px-3 text-[13px] text-dropout-text hover:text-mark"
                      onClick={() => setPlan(emptyPlan())}
                    >
                      Reset
                    </button>
                  )}
                  <Figure
                    value={projected}
                    className={cn('figure text-[34px]', planning && projectedStatus ? STATUS_INK[projectedStatus] : 'text-dropout-quiet')}
                  />
                </div>
              </div>

              <p className="mt-3 text-[14px] text-mark pretty">{summary.verdict}</p>
              {planning && (
                <p className="mt-2 text-[12px] text-dropout-quiet">
                  A projection only: recorded attendance is untouched.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

