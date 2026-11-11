'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from './cn';

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Monday first, the way a printed timetable reads. */
const DAY_HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The one day-cell shape: circular, tabular, 40px. Callers add the tone. */
export const dayCellClass =
  'press flex h-10 w-10 items-center justify-center rounded-full text-[13.5px] font-medium tnum disabled:cursor-not-allowed';

/**
 * The month grid both History and the Forecast date picker use: arrows, the
 * month's name, M T W T F S S, and one cell per day drawn by the caller so each
 * screen can colour its own days without duplicating the scaffolding.
 */
export function MonthCalendar({
  month,
  onMonthChange,
  renderDay,
  label,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  renderDay: (date: Date) => React.ReactNode;
  label: string;
}) {
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="press inline-flex h-9 w-9 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          <CaretLeft size={16} aria-hidden />
        </button>
        <p className="title-s text-[17px]" aria-live="polite">
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </p>
        <button
          type="button"
          className="press inline-flex h-9 w-9 items-center justify-center rounded-full ring-seam text-dropout-text hover:text-mark"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          <CaretRight size={16} aria-hidden />
        </button>
      </div>

      <div className="mt-4" role="group" aria-label={label}>
        <div className="mx-auto grid max-w-[440px] grid-cols-7 justify-items-center gap-y-1">
          {DAY_HEADS.map((d, i) => (
            <span key={`${d}-${i}`} className="text-[11px] font-medium text-dropout-quiet" aria-hidden>
              {d}
            </span>
          ))}
        </div>
        <div className="mx-auto mt-1 grid max-w-[440px] grid-cols-7 justify-items-center gap-y-1">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} aria-hidden />
          ))}
          {Array.from({ length: days }, (_, i) => (
            <span key={i} className="contents">
              {renderDay(new Date(month.getFullYear(), month.getMonth(), i + 1))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A day cell in a state tone, with today outlined and the picked day filled. */
export function dayToneClass(state: 'plain' | 'green' | 'amber' | 'red' | 'grey') {
  return cn(
    {
      plain: 'text-mark hover:bg-[#121826]',
      green: 'bg-[#0d1a14] text-cruise hover:bg-[#12251c]',
      amber: 'bg-[#1a1508] text-thin hover:bg-[#241d0a]',
      red: 'bg-[#2a1210] text-red hover:bg-[#3a1714]',
      grey: 'bg-[#121826] text-dropout-text hover:bg-[#161d2b]',
    }[state],
  );
}
