'use client';

import Link from 'next/link';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { Notice } from './page';
import { cn } from './cn';
import { ago, useNow } from '@/lib/time';
import { courseTitle } from '@/lib/insights';

/** Names and titles the ERP shouts, set in title case ("VINAY KUMAR" → "Vinay Kumar"). */
export const nameCase = (s: string) => courseTitle(s, '');

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dayShort = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** "2026-11-13", "2026-11-13 16:23:07" or "04-08-2025" → a Date (local), or null. */
export function dateOf(s: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  return null;
}

/** "13 Nov 2026"; this year's dates drop the year when `short`. */
export function fmtDate(s: string, short = false): string {
  const d = dateOf(s);
  if (!d) return s;
  return short && d.getFullYear() === new Date().getFullYear() ? dayShort.format(d) : dayFmt.format(d);
}

export const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;

/** Marks without float noise: 16.4, 82, 6.5. */
export const marks = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 100) / 100));

/** "Read from the ERP 3 min ago · Refresh" under a screen's title. */
export function RecordLine({
  fetchedAt,
  loading,
  onRefresh,
  children,
}: {
  fetchedAt: string | null;
  loading: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  const now = useNow(30_000);
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {children}
      <span className="text-fg-3">
        {loading ? (
          <span className="t-shimmer" data-text="Reading the ERP">
            Reading the ERP
          </span>
        ) : fetchedAt ? (
          `Read from the ERP ${ago(fetchedAt, now)}`
        ) : (
          'Not read yet'
        )}
      </span>
      <button type="button" onClick={onRefresh} disabled={loading} className="link inline-flex items-center gap-1 text-[13px] disabled:opacity-50">
        <ArrowsClockwise size={13} className={loading ? 'spin' : ''} aria-hidden /> Refresh
      </button>
    </span>
  );
}

/** What went wrong reading the ERP, in the screen's own words. */
export function RecordProblem({ error, code, hasData }: { error: string | null; code: string | null; hasData: boolean }) {
  if (!error) return null;
  if (code === 'needs_password') {
    return (
      <Notice
        className="mt-6"
        title="Attenly needs your ERP password again"
        action={
          <Link href="/settings#accounts" className="btn btn-primary btn-sm press">
            Enter password
          </Link>
        }
      >
        {error}
      </Notice>
    );
  }
  return (
    <Notice className="mt-6" role="status" title={hasData ? 'Showing the last copy' : 'Couldn’t read the ERP'}>
      {error}
    </Notice>
  );
}

/** Placeholder cards while the first read is on its way. */
export function RecordSkeleton({ cards = 4, tall = false }: { cards?: number; tall?: boolean }) {
  return (
    <div className="mt-7 grid gap-3 md:grid-cols-2 lg:gap-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="card p-5">
          <div className="skel h-3 w-24" />
          <div className="skel mt-3 h-5 w-3/4" />
          <div className={cn('skel mt-5 w-full rounded-[12px]', tall ? 'h-28' : 'h-12')} />
        </div>
      ))}
    </div>
  );
}

/** A thin neutral meter: how much of a maximum was scored. Colour stays reserved for bands. */
export function Meter({ value, max, className }: { value: number | null | undefined; max: number | null | undefined; className?: string }) {
  const pct = value != null && max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className={cn('block h-[5px] overflow-hidden rounded-full bg-white/[0.08]', className)} aria-hidden>
      <span className="block h-full rounded-full bg-fg/85 shadow-[0_0_10px_rgba(255,255,255,0.25)]" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** "1.A" → "Q1.A"; outcome labels ("CO2") stay as they are. */
export const questionLabel = (label: string) => (/^co/i.test(label) ? label.toUpperCase() : `Q${label}`);

/**
 * One question's (or outcome's) marks. A question the student didn't write is shown as
 * such, dashed and dim, so it never reads as a scored 0.
 */
export function QuestionChip({ label, got, max, notWritten }: { label: string; got: number | null; max?: number | null; notWritten: boolean }) {
  return (
    <span
      className={cn(
        'rounded-[10px] px-2.5 py-2 text-center',
        notWritten ? 'border border-dashed border-white/15' : 'bg-white/[0.04] hair',
      )}
    >
      <span className="block text-[11.5px] text-fg-3">{questionLabel(label)}</span>
      {notWritten ? (
        <span className="block whitespace-nowrap text-[12px] font-medium leading-[21px] text-fg-3">Not written</span>
      ) : (
        <span className="block text-[14px] font-semibold tnum">
          {marks(got)}
          {max != null && <span className="font-normal text-fg-3">/{marks(max)}</span>}
        </span>
      )}
    </span>
  );
}
