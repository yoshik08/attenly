'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { animate, stagger, waapi, utils } from 'animejs';

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
 * The signature moment: attended bubbles ink in left to right, like a pencil
 * sweeping the answer sheet. Compositor-only (WAAPI transform + opacity),
 * capped at half a second whatever the number of bubbles, cleaned up after.
 */
export function pencilSweep(root: HTMLElement | null) {
  if (!root) return;
  const marks = root.querySelectorAll<HTMLElement>('.bub[data-s="on"]');
  if (marks.length === 0) return;
  // Whole sweep ≤ ~480 ms: ≤ 280 ms of stagger plus a 200 ms ink-in.
  const step = Math.min(4, 280 / marks.length);
  const anim = waapi.animate(marks, {
    scale: [0.35, 1],
    opacity: [0, 1],
    duration: 200,
    delay: stagger(step),
    ease: 'cubic-bezier(0.23, 1, 0.32, 1)',
  });
  void anim.then(() => anim.revert());
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
        const o = { v: 0 };
        el.textContent = `${fmt(0)}${suffix}`;
        const a = animate(o, {
          v: value,
          duration: 640,
          ease: 'out(4)',
          modifier: decimals ? (x: number) => x : utils.round(0),
          onUpdate: () => {
            el.textContent = `${fmt(o.v)}${suffix}`;
          },
          onComplete: () => {
            el.textContent = `${fmt(value)}${suffix}`;
          },
        });
        return () => {
          a.cancel();
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
