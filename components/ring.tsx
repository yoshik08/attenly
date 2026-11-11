'use client';

import { Figure } from './motion';
import { cn } from './cn';

/**
 * The one ring: a course's figure on the Attendance cards and NOW / PROJECTED in
 * Forecast. The track is printed in dropout ink (so 0% still reads as a dial),
 * the arc carries the state colour with round caps at both ends, and the figure
 * is inset from the stroke by a fixed gap. Text size comes from the inner
 * diameter, so the ring and the number stay balanced at every size.
 */
export function Ring({
  value,
  size = 76,
  stroke = 7,
  tone,
  countUp = false,
  className,
}: {
  /** 0–100; null prints the track and an em dash. */
  value: number | null;
  size?: number;
  stroke?: number;
  /** Text-colour class for the arc, e.g. 'text-cruise'. */
  tone: string;
  countUp?: boolean;
  className?: string;
}) {
  const pad = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value));
  const inner = size - 2 * (stroke + pad);
  const fontSize = Math.max(11, Math.round(inner * 0.36));
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        {/* The printed track: visible at 0%, quiet beside the arc. */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-dropout" />
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
      <span className="figure relative leading-none" style={{ fontSize }}>
        <Figure value={value} countUp={countUp} />
      </span>
    </span>
  );
}
