'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Tweens 0 → `to` over `ms` with anime.js's out(4) curve, calling `frame` each frame.
 * Returns a cancel function. Small enough that the count-up needs no animation library.
 */
function tween(to: number, ms: number, frame: (v: number) => void, done: () => void): () => void {
  let raf = 0;
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / ms);
    frame(to * (1 - (1 - p) ** 4));
    if (p < 1) raf = requestAnimationFrame(step);
    else done();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const PAINTED_KEY = 'attenly:painted';

/** True the first time this session the orchestrated intro may play. */
export function claimIntro(): boolean {
  if (reducedMotion()) return false;
  try {
    if (sessionStorage.getItem(PAINTED_KEY)) return false;
    sessionStorage.setItem(PAINTED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * A figure that counts up once on its first paint, and afterwards pops in
 * only the digits that changed. The text lives outside React's tree so the
 * animation never fights reconciliation; screen readers get the aria-label.
 */
export function Figure({
  value,
  suffix = '%',
  className,
  countUp = false,
  decimals = 0,
}: {
  value: number | null;
  suffix?: string;
  className?: string;
  countUp?: boolean;
  decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null | undefined>(undefined);
  const fmt = (v: number) => v.toFixed(decimals);
  const text = value == null ? '—' : `${fmt(value)}${suffix}`;

  useIso(() => {
    const el = ref.current;
    if (!el) return;
    const before = prev.current;
    prev.current = value;

    if (value == null) {
      el.textContent = '—';
      return;
    }
    if (before === undefined) {
      if (countUp && !reducedMotion()) {
        el.textContent = `${fmt(0)}${suffix}`;
        const cancel = tween(
          value,
          520,
          (v) => {
            el.textContent = `${fmt(decimals ? v : Math.round(v))}${suffix}`;
          },
          () => {
            el.textContent = `${fmt(value)}${suffix}`;
          },
        );
        return () => {
          cancel();
          el.textContent = `${fmt(value)}${suffix}`;
        };
      }
      el.textContent = `${fmt(value)}${suffix}`;
      return;
    }
    if (before === value || before == null || reducedMotion()) {
      el.textContent = `${fmt(value)}${suffix}`;
      return;
    }
    // Number pop-in (transitions.dev): shared leading digits stay still.
    const next = `${fmt(value)}${suffix}`;
    const old = `${fmt(before)}${suffix}`;
    let same = 0;
    while (same < next.length && same < old.length && next[same] === old[same]) same++;
    const group = document.createElement('span');
    group.className = 't-digit-group';
    let k = 0;
    for (let i = 0; i < next.length; i++) {
      const d = document.createElement('span');
      d.className = 't-digit';
      d.textContent = next[i];
      if (i < same) d.setAttribute('data-same', '');
      else d.style.setProperty('--i', String(k++));
      group.appendChild(d);
    }
    el.replaceChildren(group);
    void group.offsetWidth;
    group.classList.add('is-animating');
  }, [value]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </span>
  );
}
