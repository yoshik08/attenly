'use client';

import { cn } from './cn';

/**
 * A percentage ring, used for a course's figure on the Attendance cards and
 * for NOW / PROJECTED in the Forecast tab. The track is printed in dropout ink
 * and the arc carries the state colour; the figure sits in the middle in
 * Archivo, tabular, so two rings side by side never shift.
 */
export function Ring({
  value,
  size = 64,
  stroke = 6,
  tone,
  className,
  children,
}: {
  /** 0–100; null prints an empty track. */
  value: number | null;
  size?: number;
  stroke?: number;
  /** Text-colour class for the arc, e.g. 'text-cruise'. */
  tone: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value));
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-seam-strong" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          className={cn('ring-arc', tone)}
        />
      </svg>
      {children}
    </span>
  );
}
