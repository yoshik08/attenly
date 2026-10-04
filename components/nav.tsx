'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { usePlanner } from './data-context';
import { cn } from './cn';
import { Container, Chip, AMBER } from './ui';

const LINKS = [
  { href: '/', label: 'Game plan' },
  { href: '/history', label: 'Rewind' },
  { href: '/sync', label: 'Link ERP' },
  { href: '/settings', label: 'Control deck' },
];

export function Nav() {
  const pathname = usePathname();
  const { sampleMode, hasData, ready } = usePlanner();
  if (ready && !hasData && pathname === '/') return null; // landing brings its own nav
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#0A0A0B]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black text-[#0A0A0B]"
              style={{ backgroundColor: AMBER }}
            >
              ◑
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-[#F5F4F0]">
              Attenly
            </span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
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
            <Chip tone="mint">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34D399]" />
              Live link
            </Chip>
          )}
        </div>
      </div>
      {/* mobile nav row */}
      <div className="border-t border-white/[0.05] sm:hidden">
        <div className="mx-auto flex max-w-6xl gap-1 px-4 py-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'flex-1 rounded-full px-2 py-1.5 text-center text-xs font-medium text-[#A1A1A8]',
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
  const pathname = usePathname();
  const { hasData, ready } = usePlanner();
  if (ready && !hasData && pathname === '/') return null; // landing has its own footer
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
