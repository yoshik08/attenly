'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { usePlanner } from './data-context';
import { cn } from './cn';
import { Container, Chip } from './ui';

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
    <div className="sticky top-0 z-30 px-4 pt-4">
      <motion.header
        initial={{ y: -32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="mx-auto max-w-6xl rounded-3xl border border-white/10 bg-[#0a0c1d]/70 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl"
      >
        <Container className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/" className="group flex items-center gap-2.5">
              <motion.span
                whileHover={{ rotate: 18, scale: 1.08 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-cyan-400 to-lime-300 text-lg font-black text-[#060714] shadow-[0_0_20px_-4px_rgba(139,92,246,0.8)]"
              >
                ✦
              </motion.span>
              <span className="font-display text-lg font-bold tracking-tight text-white">
                Skipwise
              </span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {LINKS.map((l) => {
                const active = pathname === l.href;
                return (
                  <Link key={l.href} href={l.href} className="relative rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition hover:text-white">
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.08]"
                      />
                    )}
                    <span className={cn('relative', active && 'font-semibold text-white')}>{l.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {ready && hasData && sampleMode && <Chip tone="violet">Sample orbit</Chip>}
            {ready && hasData && !sampleMode && (
              <Chip tone="mint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-300" />
                Live link
              </Chip>
            )}
          </div>
        </Container>
        {/* mobile nav row */}
        <Container className="flex gap-1 pb-3 sm:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'flex-1 rounded-xl px-2 py-1.5 text-center text-xs font-medium text-slate-400',
                pathname === l.href && 'bg-white/[0.08] font-semibold text-white',
              )}
            >
              {l.label}
            </Link>
          ))}
        </Container>
      </motion.header>
    </div>
  );
}

export function Footer() {
  const pathname = usePathname();
  const { hasData, ready } = usePlanner();
  if (ready && !hasData && pathname === '/') return null; // landing has its own footer
  return (
    <footer className="mt-20 pb-8">
      <Container>
        <p className="text-center text-xs leading-relaxed text-slate-500">
          Skipwise is a student-built side project, not affiliated with KL University.
          <br />
          Numbers are estimates — always double-check against the official ERP before making the call.
        </p>
      </Container>
    </footer>
  );
}
