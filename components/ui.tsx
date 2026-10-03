'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, animate, useInView } from 'framer-motion';
import { cn } from './cn';

/* ------------------------------------------------------------------ */
/* Aurora background — fixed, drifting gradient blobs                  */
/* ------------------------------------------------------------------ */

export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#060714]">
      <div className="aurora-blob left-[-12%] top-[-18%] h-[55vmax] w-[55vmax] bg-[#8b5cf6]" />
      <div className="aurora-blob right-[-15%] top-[22%] h-[48vmax] w-[48vmax] bg-[#22d3ee] [animation-delay:-8s]" />
      <div className="aurora-blob bottom-[-22%] left-[28%] h-[52vmax] w-[52vmax] bg-[#a3e635] [animation-delay:-16s]" />
      <div className="absolute inset-0 bg-[#060714]/72" />
      <div className="grain absolute inset-0 opacity-[0.05]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

export function GlassPanel({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 22, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'rounded-3xl border border-white/10 bg-white/[0.045] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl',
        className,
      )}
    >
      {children}
    </motion.section>
  );
}

export function SectionHeader({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-5">
      <motion.p
        initial={{ opacity: 0, x: -12 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4 }}
        className="mb-1 text-[11px] font-bold tracking-[0.22em] text-lime-300/90 uppercase"
      >
        {kicker}
      </motion.p>
      <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
      {sub && <p className="mt-1 max-w-xl text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

type ChipTone = 'mint' | 'violet' | 'cyan' | 'amber' | 'rose' | 'ghost';

const chipClasses: Record<ChipTone, string> = {
  mint: 'border-lime-300/30 bg-lime-300/10 text-lime-200',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  cyan: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200',
  amber: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
  rose: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  ghost: 'border-white/10 bg-white/[0.04] text-slate-300',
};

export function Chip({
  children,
  tone = 'ghost',
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
}) {
  return (
    <motion.span
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold whitespace-nowrap',
        chipClasses[tone],
        className,
      )}
    >
      {children}
    </motion.span>
  );
}

export function bandChip(band: 'cruising' | 'thin-ice' | 'in-the-red'): ChipTone {
  return band === 'cruising' ? 'mint' : band === 'thin-ice' ? 'amber' : 'rose';
}

/* ------------------------------------------------------------------ */
/* Fuel gauge — horizontal shimmer bar, never a ring                    */
/* ------------------------------------------------------------------ */

export function FuelGauge({
  pct,
  thresholds,
  className,
  barClassName,
}: {
  pct: number | null;
  thresholds: { safeAt: number; condonationFrom: number };
  className?: string;
  barClassName?: string;
}) {
  const v = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const gradient =
    pct == null
      ? 'bg-slate-600'
      : pct >= thresholds.safeAt
        ? 'from-lime-300 to-emerald-400'
        : pct >= thresholds.condonationFrom
          ? 'from-amber-300 to-orange-400'
          : 'from-rose-400 to-red-500';
  return (
    <div className={cn('relative', className)}>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className={cn('fuel-fill h-full rounded-full bg-gradient-to-r', gradient, barClassName)}
          initial={{ width: 0 }}
          whileInView={{ width: `${v}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
        <div className="fuel-shimmer" />
      </div>
      {/* red-line ticks */}
      <div
        className="absolute -top-0.5 h-3.5 w-px bg-white/50"
        style={{ left: `${thresholds.condonationFrom}%` }}
        title={`Floor ${thresholds.condonationFrom}%`}
      />
      <div
        className="absolute -top-0.5 h-3.5 w-px bg-white/70"
        style={{ left: `${thresholds.safeAt}%` }}
        title={`Cruise line ${thresholds.safeAt}%`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CountUp — animated percentage                                       */
/* ------------------------------------------------------------------ */

export function CountUp({
  value,
  suffix = '%',
  className,
  duration = 0.9,
}: {
  value: number | null;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView || value == null) return;
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, duration]);
  if (value == null) return <span ref={ref} className={className}>—</span>;
  return (
    <span ref={ref} className={className}>
      {Math.round(display)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons / inputs                                                    */
/* ------------------------------------------------------------------ */

type BtnVariant = 'primary' | 'violet' | 'ghost' | 'danger' | 'glass';

const btnVariants: Record<BtnVariant, string> = {
  primary:
    'bg-lime-300 text-[#0b0f0a] font-bold shadow-[0_0_24px_-6px_rgba(163,230,53,0.7)] hover:bg-lime-200 disabled:bg-lime-300/40',
  violet:
    'bg-violet-500/90 text-white font-semibold shadow-[0_0_24px_-8px_rgba(139,92,246,0.8)] hover:bg-violet-400 disabled:bg-violet-500/40',
  ghost: 'text-slate-300 hover:bg-white/[0.06] hover:text-white font-medium',
  danger:
    'border border-rose-400/40 text-rose-200 hover:bg-rose-400/10 font-semibold disabled:opacity-50',
  glass:
    'border border-white/12 bg-white/[0.05] text-slate-100 hover:bg-white/[0.09] font-semibold backdrop-blur',
};

export function Button({
  children,
  onClick,
  type = 'button',
  disabled,
  variant = 'primary',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  variant?: BtnVariant;
  className?: string;
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.03, y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm transition-colors disabled:cursor-not-allowed',
        btnVariants[variant],
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

export const inputClass =
  'w-full rounded-2xl border border-white/12 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 backdrop-blur focus:border-lime-300/60 focus:outline-none focus:ring-2 focus:ring-lime-300/20 transition';

export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-slate-200">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/* ---------- animated toggle ---------- */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border transition-colors duration-300',
        checked ? 'border-lime-300/50 bg-lime-300/25' : 'border-white/15 bg-white/[0.06]',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        className={cn(
          'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full shadow',
          checked ? 'right-1 bg-lime-300' : 'left-1 bg-slate-400',
        )}
      />
    </button>
  );
}

/* ---------- stepper (− / +) ---------- */

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  small,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  small?: boolean;
}) {
  const btn = cn(
    'flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] font-black text-slate-200 transition hover:bg-white/[0.12] active:scale-90 disabled:opacity-30',
    small ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-base',
  );
  return (
    <div className="flex items-center gap-1.5">
      <motion.button type="button" whileTap={{ scale: 0.85 }} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">−</motion.button>
      <motion.span
        key={value}
        initial={{ scale: 1.25, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn('min-w-7 text-center font-display font-bold text-white tabular-nums', small ? 'text-sm' : 'text-base')}
      >
        {value}
      </motion.span>
      <motion.button type="button" whileTap={{ scale: 0.85 }} className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase">+</motion.button>
    </div>
  );
}

/* ---------- empty state ---------- */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <GlassPanel className="flex flex-col items-center gap-4 px-6 py-20 text-center">
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-3xl"
      >
        ✦
      </motion.div>
      <p className="font-display text-xl font-bold text-white">{title}</p>
      <p className="max-w-md text-sm text-slate-400">{hint}</p>
      {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
    </GlassPanel>
  );
}

/* ---------- sparkline ---------- */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return <span className="text-xs text-slate-600">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`)
    .join(' ');
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? '#a3e635' : '#fb7185';
  const id = `sg-${Math.abs(pts.length % 997)}`;
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#${id})`} />
      <motion.polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </svg>
  );
}
