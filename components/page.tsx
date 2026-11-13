'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { WarningCircle, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from './cn';

/** One large title per screen, its context line, and the screen's own controls. */
export function PageHeader({
  title,
  sub,
  actions,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-5 lg:pt-12', className)}>
      <div className="min-w-0">
        <h1 className="display balance">{title}</h1>
        {sub && <div className="mt-2.5 text-[14px] text-fg-2">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** "Even Sem 2026-2027 · Change" */
export function TermLine({ term, children }: { term: string; children?: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {term && <span className="tnum">{term}</span>}
      <Link href="/settings#semester" className="link text-[13px] lg-press">
        Change
      </Link>
      {children}
    </span>
  );
}

/** A tinted panel for something that needs saying (an ERP outage, a paused account). */
export function Notice({
  tone = 'condonation',
  title,
  children,
  action,
  role,
  className,
}: {
  tone?: 'condonation' | 'detained' | 'medical';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: 'status' | 'alert';
  className?: string;
}) {
  return (
    <div
      role={role}
      data-tone={tone}
      className={cn('card glow rounded-[20px] p-4 lg lg-card', className)}
      style={{ '--gs': '280px', '--gx': '-130px', '--gy': '-150px' } as CSSProperties}
    >
      <div className="flex gap-3">
        <WarningCircle size={20} weight="fill" className="mt-px shrink-0 text-tone" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{title}</p>
          {children && <div className="mt-1 text-[13.5px] leading-relaxed text-fg-2 pretty">{children}</div>}
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/** An empty screen that still says what will appear here and how. */
export function Empty({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: PhosphorIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card mt-8 flex flex-col items-start p-6 lg:p-8 lg lg-card lg-frost', className)}>
      {Icon && (
        <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-raised hair">
          <Icon size={24} className="text-fg-2" aria-hidden />
        </span>
      )}
      <p className="text-[17px] font-semibold">{title}</p>
      {children && <div className="mt-1.5 max-w-[56ch] text-[14px] leading-relaxed text-fg-2 pretty">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Small print under a screen. */
export function Footnote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('mt-8 max-w-[72ch] text-[12.5px] leading-relaxed text-fg-3 pretty', className)}>{children}</p>;
}
