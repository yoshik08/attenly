'use client';

import { useRef } from 'react';
import { cn } from './cn';
import { WEEK } from '@/lib/insights';

export const FULL_DAY: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};
export const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The next date a weekday falls on, today included. */
export function nextDateOf(day: string, now: Date): Date {
  const want = WEEK.indexOf(day as (typeof WEEK)[number]);
  const offset = (want - now.getDay() + 7) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

/** Days with classes, rolling from today: Thu 12, Fri 13, Sat 14, Mon 16… */
export function rollingDays(days: string[], now: Date): string[] {
  return [...days].sort((a, b) => nextDateOf(a, now).getTime() - nextDateOf(b, now).getTime());
}

/** The day to open on: today when it has classes, else the next day that does. */
export function defaultDayOf(days: string[], now: Date): string {
  return rollingDays(days, now)[0] ?? 'Mon';
}

/**
 * A week of days as tabs, starting today: the weekday over its next date, the
 * picked one filled. Arrow keys move along it.
 */
export function DayStrip({
  days,
  value,
  onChange,
  now,
  label,
  className,
}: {
  days: string[];
  value: string;
  onChange: (d: string) => void;
  now: Date;
  label: string;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const ordered = rollingDays(days, now);
  const today = WEEK[now.getDay()];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = ordered.indexOf(value);
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + ordered.length) % ordered.length;
    onChange(ordered[j]);
    bar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[j]?.focus();
  };
  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 no-bar sm:mx-0 sm:px-0', className)}>
      <div ref={bar} role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1.5">
        {ordered.map((d) => {
          const selected = d === value;
          const date = nextDateOf(d, now);
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={selected}
              title={`${FULL_DAY[d]} ${date.getDate()}${isToday ? ' (today)' : ''}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(d)}
              className={cn(
                'press flex h-[70px] min-w-[52px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[18px] sm:max-w-[84px]',
                selected ? 'bg-fg text-black' : 'bg-surface text-fg hair hover:bg-raised',
              )}
            >
              <span className={cn('text-[11.5px] font-semibold', selected ? 'text-black/60' : 'text-fg-2')}>{d}</span>
              <span className="figure text-[20px]">{date.getDate()}</span>
              <span
                aria-hidden
                className={cn('h-[4px] w-[4px] rounded-full', isToday ? (selected ? 'bg-black' : 'bg-accent') : 'bg-transparent')}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
