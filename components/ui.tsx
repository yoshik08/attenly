'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

/* ---------- layout primitives ---------- */

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4', className)}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-neutral-200 bg-white shadow-none dark:border-neutral-800 dark:bg-neutral-900',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{eyebrow}</p>
      <h2 className="text-2xl font-bold">{title}</h2>
    </div>
  );
}

/* ---------- badges / pills ---------- */

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  bad: 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30',
  accent: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function bandTone(band: 'safe' | 'condonation' | 'below'): Tone {
  return band === 'safe' ? 'good' : band === 'condonation' ? 'warn' : 'bad';
}

/* ---------- progress bar ---------- */

export function ProgressBar({
  pct,
  thresholds,
  className,
}: {
  pct: number | null;
  thresholds: { safeAt: number; condonationFrom: number };
  className?: string;
}) {
  const v = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const color =
    pct == null
      ? 'bg-neutral-300 dark:bg-neutral-700'
      : pct >= thresholds.safeAt
        ? 'bg-emerald-500'
        : pct >= thresholds.condonationFrom
          ? 'bg-amber-500'
          : 'bg-red-500';
  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800', className)}>
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${v}%` }} />
      {/* threshold markers */}
      <div
        className="absolute top-0 h-full w-px bg-neutral-900/40 dark:bg-white/40"
        style={{ left: `${thresholds.condonationFrom}%` }}
        title={`Condonation from ${thresholds.condonationFrom}%`}
      />
      <div
        className="absolute top-0 h-full w-px bg-neutral-900/40 dark:bg-white/40"
        style={{ left: `${thresholds.safeAt}%` }}
        title={`Safe at ${thresholds.safeAt}%`}
      />
    </div>
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
  if (values.length < 2) return <span className="text-xs text-neutral-400">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`)
    .join(' ');
  const last = values[values.length - 1];
  const first = values[0];
  const stroke = last >= first ? '#10b981' : '#ef4444';
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- buttons / inputs ---------- */

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
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
}) {
  const variants: Record<string, string> = {
    primary:
      'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-indigo-900',
    secondary:
      'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800',
    danger:
      'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950',
    ghost: 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export const inputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100';

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
    <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-md text-sm text-neutral-500 dark:text-neutral-400">{hint}</p>
      {action}
    </Card>
  );
}
