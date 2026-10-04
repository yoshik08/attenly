'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePlanner } from './data-context';
import { cn } from './cn';
import { Container, Chip } from './ui';
import { api } from '@/lib/api';

const LINKS = [
  { href: '/', label: 'Attendance' },
  { href: '/timetable', label: 'Timetable' },
  { href: '/cgpa', label: 'CGPA' },
  { href: '/calculator', label: 'Calculator' },
  { href: '/internals', label: 'Internals' },
];

function TermSelects() {
  const { termOptions, term } = usePlanner();

  if (!termOptions || termOptions.years.length === 0) return null;

  const selectClass =
    'rounded-full border border-[#232327] bg-white/[0.03] px-2.5 py-1.5 text-xs font-semibold text-[#A1A1A8] transition hover:border-white/20 hover:text-white focus:outline-none';
  return (
    <>
      <select
        aria-label="Academic year"
        defaultValue={term?.academicyear || termOptions.years[0]?.id || ''}
        className={selectClass}
      >
        {termOptions.years.map((y) => (
          <option key={y.id} value={y.id} className="bg-[#141416]">
            {y.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Semester"
        defaultValue={term?.semesterid || termOptions.semesters[0]?.id || ''}
        className={selectClass}
      >
        {termOptions.semesters.map((s) => (
          <option key={s.id} value={s.id} className="bg-[#141416]">
            {s.label}
          </option>
        ))}
      </select>
    </>
  );
}

function HardSyncButton() {
  const { loadSnapshot } = usePlanner();
  const [syncing, setSyncing] = useState(false);

  const hardSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(api('/api/erp/hard-sync'), { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.data) {
        loadSnapshot(data.data);
      } else {
        alert(data.error || 'Sync failed. Try again.');
      }
    } catch {
      alert('Sync failed. Check your connection and try again.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      onClick={hardSync}
      disabled={syncing}
      title="Hard sync — re-login to the ERP and pull everything fresh"
      className="rounded-full border border-[#E9A13B]/40 px-3 py-1.5 text-xs font-bold text-[#E9A13B] transition hover:bg-[#E9A13B]/10 disabled:cursor-wait disabled:opacity-50"
    >
      {syncing ? '⟳ syncing…' : '⟳ hard sync'}
    </button>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { sampleMode, hasData, ready } = usePlanner();
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#0A0A0B]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E9A13B] text-lg font-black text-[#0A0A0B]">
              ◑
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-[#F5F4F0]">
              Attenly
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    'rounded-full px-3.5 py-2 text-sm font-medium transition',
                    active ? 'bg-white/[0.08] font-semibold text-white' : 'text-[#A1A1A8] hover:text-white',
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {ready && hasData && sampleMode && <Chip tone="amber">Sample orbit</Chip>}
          {ready && hasData && !sampleMode && (
            <>
              <TermSelects />
              <Chip tone="mint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34D399]" />
                Live link
              </Chip>
              <HardSyncButton />
            </>
          )}
          <Link
            href="/settings"
            title="Settings"
            className={cn(
              'rounded-full px-3 py-2 text-sm text-[#A1A1A8] transition hover:text-white',
              pathname === '/settings' && 'bg-white/[0.08] text-white',
            )}
          >
            ⚙
          </Link>
        </div>
      </div>
      {/* mobile nav row */}
      <div className="border-t border-white/[0.05] md:hidden">
        <div className="thin-scroll mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'flex-1 whitespace-nowrap rounded-full px-2 py-1.5 text-center text-xs font-medium text-[#A1A1A8]',
                pathname === l.href && 'bg-white/[0.08] font-semibold text-white',
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 border-t border-white/[0.07] pb-8 pt-8">
      <Container>
        <p className="text-center text-xs leading-relaxed text-[#A1A1A8]">
          <span className="font-bold text-[#F5F4F0]">Attenly</span> — a student-built ERP front, not affiliated with KL University.
          <br />
          Numbers are estimates — always double-check against the official ERP before making the call.
        </p>
      </Container>
    </footer>
  );
}
