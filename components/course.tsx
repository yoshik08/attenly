'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CaretDown, Clock, Minus, Plus } from '@phosphor-icons/react';
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
import { whenLabel, type ComponentSummary, type CourseDelta, type CourseSummary, type NextClass } from '@/lib/insights';
import type { Settings } from './store';

/** The college's band, in its exact words. Detained is the one that shouts. */
export function Band({ status, className }: { status: Status | null; className?: string }) {
  if (!status) return null;
  if (status === 'detained') {
    return (
      <span data-tone="detained" className={cn('band inline-flex items-center rounded-full bg-det px-2 py-[3px] text-black', className)}>
        {STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <span data-tone={status} className={cn('band inline-flex items-center gap-1.5 text-tone', className)}>
      <span className="dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "2 to spare", "attend 3", "out of reach" for one class type. */
function BudgetTag({ c, pct, target }: { c: ComponentSummary; pct: number | null; target: number }) {
  if (pct == null || !c.budget) return <span className="w-[86px] text-right text-[12.5px] text-fg-3">—</span>;
  if (pct >= target) {
    const n = c.budget.spare;
    return (
      <span data-tone={n > 0 ? 'safe' : 'none'} className="w-[86px] text-right text-[12.5px] font-semibold text-tone tnum">
        {!Number.isFinite(n) ? 'plenty spare' : n > 0 ? `${n} to spare` : 'none spare'}
      </span>
    );
  }
  const n = c.budget.needed;
  const tone = statusOf(pct) === 'condonation' ? 'condonation' : 'detained';
  return (
    <span data-tone={tone} className="w-[86px] text-right text-[12.5px] font-semibold text-tone tnum">
      {Number.isFinite(n) ? `attend ${n}` : 'out of reach'}
    </span>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        className="icon-btn press !h-9 !w-9"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        aria-label={`${label}: one fewer`}
      >
        <Minus size={14} weight="bold" aria-hidden />
      </button>
      <span className="figure w-8 text-center text-[19px]" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="icon-btn press !h-9 !w-9"
        onClick={() => onChange(Math.min(60, value + 1))}
        disabled={value >= 60}
        aria-label={`${label}: one more`}
      >
        <Plus size={14} weight="bold" aria-hidden />
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
  index = 0,
}: {
  subject: SubjectAttendance;
  summary: CourseSummary;
  settings: Settings;
  delta: CourseDelta[];
  next: NextClass | null;
  onSeen: (code: string) => void;
  countUp: boolean;
  index?: number;
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

  // A change from the last sync stays lit until the card has been in view.
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
      [d.attended > 0 && `+${countOf(d.attended, d.k)} attended`, d.missed > 0 && `+${countOf(d.missed, d.k)} missed`]
        .filter(Boolean)
        .join(', '),
    )
    .join(', ');

  return (
    <article
      ref={ref}
      id={`course-${subject.code}`}
      data-tone={status ?? 'none'}
      className="card rise scroll-mt-24 p-5"
      style={{ '--i': index } as CSSProperties}
      aria-label={summary.title}
    >
      {/* The light sits behind the ring, top right. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 -z-10 h-[300px] w-[300px]"
        style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--tone) 22%, transparent), transparent)' }}
      />
      {/* The whole head toggles the plan for a pointer; keyboards use the Plan button. */}
      <div
        onClick={() => setOpen((o) => !o)}
        className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4"
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="mono text-[12px] text-fg-3">{subject.code}</span>
            <Band status={status} />
          </p>
          <h3 className="mt-2 line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] pretty">{summary.title}</h3>
          <p className="mt-1.5 text-[14px] leading-snug text-fg-2 pretty">{summary.verdict}</p>
        </div>
        <Ring value={summary.pct} tone={status} target={target} countUp={countUp} delay={Math.min(index, 8) * 70} size={92} stroke={8} />
      </div>

      {summary.components.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1" aria-label={`${summary.title}: classes by type`}>
          {summary.components.map((c) => (
            <li key={c.k} className="flex items-center justify-between gap-3 rounded-[12px] bg-white/[0.035] px-3 py-[7px] text-[13px]">
              <span className="text-fg-2">{c.label}</span>
              <span className="flex items-center gap-3">
                <span className="tnum font-semibold">
                  {c.attended}
                  <span className="font-normal text-fg-3">/{Math.max(0, c.effective)}</span>
                </span>
                <BudgetTag c={c} pct={summary.pct} target={target} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[13px] text-fg-3">No classes counted yet</p>
      )}

      {hasDelta && (
        <p data-tone="safe" className="chip mt-3">
          {deltaText} since you last looked
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 hair-t pt-3.5">
        {next ? (
          <Link
            href={`/timetable?day=${next.day}#slot-${next.day}-${next.period.period}`}
            className="press inline-flex min-w-0 items-center gap-1.5 rounded-full text-[13px] text-fg-2 hover:text-fg"
          >
            <Clock size={14} aria-hidden className="shrink-0" />
            <span className="truncate">
              Next class {whenLabel(next)}
              {next.period.room ? ` · ${next.period.room}` : ''}
            </span>
          </Link>
        ) : (
          <span className="text-[13px] text-fg-3">No class scheduled</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={detailId}
          className="press inline-flex shrink-0 items-center gap-1 rounded-full bg-raised px-3 py-1.5 text-[13px] font-semibold text-fg hair hover:bg-raised-2"
        >
          {open ? 'Hide plan' : 'Plan'}
          <span className="t-acc-chevron" aria-hidden>
            <CaretDown size={12} weight="bold" />
          </span>
        </button>
      </div>

      <div className="t-acc" data-open={open}>
        <div className="t-acc-panel" id={detailId}>
          <div className="t-acc-panel-inner">
            <div className="pt-4" inert={!open}>
              <ul className="mb-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-fg-3" aria-label="How to read the bubbles">
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-full bg-fg" aria-hidden /> attended
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-full shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.26)]" aria-hidden /> missed
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-full shadow-[inset_0_0_0_1.5px_var(--color-safe)]" aria-hidden /> can skip
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-full shadow-[inset_0_0_0_1.5px_var(--color-cond)]" aria-hidden /> must attend
                </li>
              </ul>
              <div className="flex flex-col gap-2">
                {summary.components.map((c) => {
                  const d = delta.find((x) => x.k === c.k);
                  const pre = tcbr?.[c.k] ?? 0;
                  return (
                    <div key={c.k} className="rounded-[16px] bg-white/[0.035] p-3.5">
                      <p className="flex items-baseline justify-between text-[13px] text-fg-2">
                        <span>{c.label}</span>
                        <span className="tnum font-semibold text-fg">
                          {c.attended}
                          <span className="font-normal text-fg-3">/{Math.max(0, c.effective)}</span>
                        </span>
                      </p>
                      <div className="mt-2.5">
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
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] text-fg-2">Attend</span>
                          <Stepper
                            value={plan[c.k].attend}
                            onChange={(v) => setFor(c.k, { attend: v })}
                            label={`Attend upcoming ${COMPONENT_PLURAL[c.k]}`}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] text-fg-2">Skip</span>
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

              <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-fg-2">{planning ? 'After that plan' : 'Add classes to see where you’d land'}</p>
                  {planning && projectedStatus && (
                    <p data-tone={projectedStatus} className="mt-1 text-[13px] font-semibold text-tone">
                      {STATUS_LABEL[projectedStatus]}
                      {projected != null && projected < target && projected >= 75 ? `, under ${target}%` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  {planning && (
                    <button type="button" className="btn btn-ghost btn-sm press" onClick={() => setPlan(emptyPlan())}>
                      Reset
                    </button>
                  )}
                  <span data-tone={planning && projectedStatus ? projectedStatus : 'none'}>
                    <Figure value={projected} className={cn('figure text-[38px]', planning && projectedStatus ? 'text-tone' : 'text-fg-3')} />
                  </span>
                </div>
              </div>
              {planning && <p className="mt-2 text-[12px] text-fg-3">A projection only: recorded attendance is untouched.</p>}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
