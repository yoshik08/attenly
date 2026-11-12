'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';

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
const DAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The one day-cell shape: a rounded square that fills its column. Callers add the tone. */
export const dayCellClass =
  'press relative flex aspect-square w-full flex-col items-center justify-center rounded-[14px] text-[14px] font-semibold tnum disabled:cursor-not-allowed';

/**
 * The month grid History, Forecast and the last-instruction-day picker share:
 * the month's name with arrows, Mon–Sun, and one cell per day drawn by the
 * caller so each screen colours its own days.
 */
export function MonthCalendar({
  month,
  onMonthChange,
  renderDay,
  label,
  className,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  renderDay: (date: Date) => React.ReactNode;
  label: string;
  className?: string;
}) {
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <p className="h2 text-[20px]" aria-live="polite">
          {MONTHS[month.getMonth()]} <span className="text-fg-3">{month.getFullYear()}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="icon-btn press"
            onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <CaretLeft size={16} weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn press"
            onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <CaretRight size={16} weight="bold" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-5" role="group" aria-label={label}>
        <div className="grid grid-cols-7 gap-1.5">
          {DAY_HEADS.map((d) => (
            <span key={d} className="pb-1 text-center text-[11.5px] font-semibold text-fg-3" aria-hidden>
              {d}
            </span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1.5">
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

/** A day cell in a state tone. */
export function dayToneClass(state: 'plain' | 'green' | 'amber' | 'red' | 'grey') {
  return {
    plain: 'text-fg bg-surface hair hover:bg-raised',
    green: 'bg-safe/12 text-safe hover:bg-safe/20',
    amber: 'bg-cond/12 text-cond hover:bg-cond/20',
    red: 'bg-det/14 text-det hover:bg-det/22',
    grey: 'bg-raised text-fg-2',
  }[state];
}

