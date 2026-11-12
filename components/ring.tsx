'use client';

import { useEffect, useState } from 'react';
import { Figure } from './motion';
import { cn } from './cn';
import type { Status } from '@/lib/math';

/**
 * The one ring: a course's figure on Attendance, NOW / PROJECTED in Forecast,
 * the calculator's answer. A quiet track, an arc in the band's colour that
 * glows on black, and a notch where the target sits, so "past the line" reads
 * without a number. The figure is sized from the inner diameter.
 */
export function Ring({
  value,
  size = 88,
  stroke = 8,
  tone,
  target,
  countUp = false,
  delay = 0,
  className,
}: {
  /** 0–100; null prints the track and an em dash. */
  value: number | null;
  size?: number;
  stroke?: number;
  /** The band (sets the arc's colour), or null for a neutral arc. */
  tone: Status | 'mark' | null;
  /** Draws a notch at this percentage. */
  target?: number;
  /** Sweep the arc in from zero and count the figure up (first paint only). */
  countUp?: boolean;
  /** Stagger for the sweep, in ms. */
  delay?: number;
  className?: string;
}) {
  const v = value == null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value));
  const [shown, setShown] = useState(countUp ? 0 : v);
  useEffect(() => {
    if (!countUp) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the arc follows the value
      setShown(v);
      return;
    }
    const t = window.setTimeout(() => setShown(v), 30 + delay);
    return () => window.clearTimeout(t);
  }, [v, countUp, delay]);

  const pad = 3;
  const r = (size - stroke) / 2 - pad;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const small = size < 64;
  const inner = size - 2 * (stroke + pad);
  const fontSize = Math.max(12, Math.round(inner * (small ? 0.4 : 0.36)));

  // Notch: a short cut across the ring at the target, plus a tick just outside it.
  let notch: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (target != null) {
    const a = (target / 100) * 2 * Math.PI; // the SVG is turned -90°, so 0 is at the top
    const r1 = r - stroke / 2 - 1;
    const r2 = r + stroke / 2 + 1;
    notch = { x1: cx + r1 * Math.cos(a), y1: cx + r1 * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cx + r2 * Math.sin(a) };
  }

  return (
    <span
      data-tone={tone ?? 'none'}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90 overflow-visible" aria-hidden="true">
        <circle cx={cx} cy={cx} r={r} fill="none" strokeWidth={stroke} stroke="rgba(255,255,255,0.085)" />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={value == null ? c : c * (1 - shown / 100)}
          className="ring-arc"
          data-small={small}
          style={{ stroke: 'var(--tone)', transitionDelay: countUp ? `${delay}ms` : undefined, opacity: value == null ? 0 : 1 }}
        />
        {notch && (
          <line {...notch} stroke="#000" strokeWidth={small ? 2 : 2.5} strokeLinecap="butt" />
        )}
      </svg>
      <span className="figure relative flex items-start leading-none" style={{ fontSize }}>
        <Figure value={value} suffix="" countUp={countUp} />
        {value != null && (
          <span className="ml-[1px] mt-[0.08em] font-sans font-semibold text-fg-2" style={{ fontSize: Math.round(fontSize * 0.42) }}>
            %
          </span>
        )}
      </span>
    </span>
  );
}
