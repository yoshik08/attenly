'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from './cn';

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Segmented control with a sliding pill (transitions.dev "tabs sliding").
 * The first paint and resizes place the pill without a transition so it never
 * animates in from the left edge. Arrow keys move between options.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = 'md',
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: 'md' | 'sm';
}) {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  const place = useCallback((animate: boolean) => {
    const b = bar.current;
    const p = pill.current;
    if (!b || !p) return;
    const active = b.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (!active) return;
    if (!animate) p.style.transition = 'none';
    p.style.width = `${active.offsetWidth}px`;
    p.style.height = `${active.offsetHeight}px`;
    p.style.top = `${active.offsetTop}px`;
    p.style.transform = `translateX(${active.offsetLeft}px)`;
    if (!animate) {
      void p.offsetWidth;
      p.style.transition = '';
    }
  }, []);

  useIso(() => {
    place(placed.current);
    placed.current = true;
  }, [value, options.length, place]);

  useEffect(() => {
    const b = bar.current;
    if (!b || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(b);
    return () => ro.disconnect();
  }, [place]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[j].value);
    bar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[j]?.focus();
  };

  return (
    <div
      ref={bar}
      role="tablist"
      aria-label={label}
      className={cn('t-tabs max-w-full', className)}
      onKeyDown={onKey}
    >
      <span ref={pill} className="t-tabs-pill" aria-hidden />
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn('t-tab tnum', size === 'sm' && '!h-[30px] !px-3 !text-[13px]')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
