'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, animate, useInView } from 'framer-motion';
import { cn } from './cn';

/* ------------------------------------------------------------------ */
/* Design language — matches the landing:                              */
/*   bg #0A0A0B · card #141416 / #232327 · ink #F5F4F0 · muted #A1A1A8   */
/*   accent amber #E9A13B · safe #34D399 · danger #F87171                */
/*   headlines in Fraunces (font-display)                               */
/* ------------------------------------------------------------------ */

export const AMBER = '#E9A13B';
export const INK = 'text-[#F5F4F0]';
export const MUTED = 'text-[#A1A1A8]';
export const CARD = 'bg-[#141416] border border-[#232327]';

/* ------------------------------------------------------------------ */
/* Background — flat ink with a faint amber dot grid up top            */
/* ------------------------------------------------------------------ */

export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0A0A0B]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(233,161,59,0.10) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
          maskImage: 'radial-gradient(ellipse 90% 55% at 50% 0%, black 10%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 55% at 50% 0%, black 10%, transparent 70%)',
        }}
      />
      <div className="grain absolute inset-0 opacity-[0.04]" />
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
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('rounded-3xl border border-[#232327] bg-[#141416]', className)}
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
        className="mb-1 text-[11px] font-bold tracking-[0.22em] text-[#A1A1A8] uppercase"
      >
        {kicker}
      </motion.p>
      <h2 className="font-display text-2xl font-black tracking-tight text-[#F5F4F0] sm:text-3xl">{title}</h2>
      {sub && <p className="mt-1 max-w-xl text-sm text-[#A1A1A8]">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

type ChipTone = 'mint' | 'violet' | 'cyan' | 'amber' | 'rose' | 'ghost';

const chipClasses: Record<ChipTone, string> = {
  mint: 'border-[#34D399]/30 bg-[#34D399]/10 text-[#34D399]',
  violet: 'border-[#E9A13B]/30 bg-[#E9A13B]/10 text-[#E9A13B]',
  cyan: 'border-[#7DD3FC]/30 bg-[#7DD3FC]/10 text-[#7DD3FC]',
  amber: 'border-[#E9A13B]/30 bg-[#E9A13B]/10 text-[#E9A13B]',
  rose: 'border-[#F87171]/30 bg-[#F87171]/10 text-[#F87171]',
  ghost: 'border-white/10 bg-white/[0.04] text-[#A1A1A8]',
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
  const fill =
    pct == null
      ? 'bg-[#3A3A3F]'
      : pct >= thresholds.safeAt
        ? 'bg-[#34D399]'
        : pct >= thresholds.condonationFrom
          ? 'bg-[#E9A13B]'
          : 'bg-[#F87171]';
  return (
    <div className={cn('relative', className)}>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className={cn('fuel-fill h-full rounded-full', fill, barClassName)}
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
    'bg-[#E9A13B] text-[#0A0A0B] font-bold hover:brightness-110 disabled:opacity-40',
  violet:
    'border border-[#E9A13B]/40 text-[#E9A13B] hover:bg-[#E9A13B]/10 font-semibold disabled:opacity-40',
  ghost: 'text-[#A1A1A8] hover:bg-white/[0.06] hover:text-white font-medium',
  danger:
    'border border-[#F87171]/40 text-[#F87171] hover:bg-[#F87171]/10 font-semibold disabled:opacity-50',
  glass:
    'border border-white/10 bg-white/[0.04] text-[#F5F4F0] hover:bg-white/[0.08] font-semibold',
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
  'w-full rounded-2xl border border-[#2A2A2E] bg-white/[0.04] px-3.5 py-2.5 text-sm text-[#F5F4F0] placeholder:text-[#6B6B72] focus:border-[#E9A13B]/60 focus:outline-none focus:ring-2 focus:ring-[#E9A13B]/20 transition';

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
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-[#F5F4F0]">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[#A1A1A8]">{hint}</p>}
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
        checked ? 'border-[#E9A13B]/50 bg-[#E9A13B]/25' : 'border-white/15 bg-white/[0.06]',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        className={cn(
          'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full shadow',
          checked ? 'right-1 bg-[#E9A13B]' : 'left-1 bg-[#A1A1A8]',
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
    'flex items-center justify-center rounded-xl border border-[#2A2A2E] bg-white/[0.05] font-black text-[#F5F4F0] transition hover:bg-white/[0.12] active:scale-90 disabled:opacity-30',
    small ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-base',
  );
  return (
    <div className="flex items-center gap-1.5">
      <motion.button type="button" whileTap={{ scale: 0.85 }} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">−</motion.button>
      <motion.span
        key={value}
        initial={{ scale: 1.25, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn('min-w-7 text-center font-display font-bold text-[#F5F4F0] tabular-nums', small ? 'text-sm' : 'text-base')}
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
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#E9A13B]/15 text-3xl text-[#E9A13B]"
      >
        ◑
      </motion.div>
      <p className="font-display text-xl font-black text-[#F5F4F0]">{title}</p>
      <p className="max-w-md text-sm text-[#A1A1A8]">{hint}</p>
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
  if (values.length < 2) return <span className="text-xs text-[#6B6B72]">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`)
    .join(' ');
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? '#34D399' : '#F87171';
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
