'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePlanner } from './data-context';
import { cn } from './cn';
import { Container, Badge } from './ui';

const LINKS = [
  { href: '/', label: 'Plan' },
  { href: '/history', label: 'History' },
  { href: '/sync', label: 'Sync' },
  { href: '/settings', label: 'Settings' },
];

function ThemeToggle() {
  const { settings, updateSettings } = usePlanner();
  const cycle = () => {
    const next = settings.theme === 'light' ? 'dark' : settings.theme === 'dark' ? 'system' : 'light';
    updateSettings({ theme: next });
  };
  const icon = settings.theme === 'light' ? '☀' : settings.theme === 'dark' ? '☾' : '◐';
  return (
    <button
      onClick={cycle}
      title={`Theme: ${settings.theme} (click to change)`}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-sm dark:border-neutral-700"
    >
      {icon}
    </button>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { sampleMode, hasData, ready } = usePlanner();
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/80 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/80">
      <Container className="flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-sm font-black text-white">
              S
            </span>
            Skipwise
          </Link>
          <nav className="flex items-center gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
                  pathname === l.href &&
                    'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100',
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {ready && hasData && sampleMode && <Badge tone="accent">Sample data</Badge>}
          {ready && hasData && !sampleMode && (
            <Badge tone="good">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live
            </Badge>
          )}
          <ThemeToggle />
        </div>
      </Container>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-neutral-200 py-6 dark:border-neutral-800">
      <Container>
        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          Skipwise is an unofficial student project, not affiliated with KL University. Attendance
          numbers are estimates — always verify against the official ERP.
        </p>
      </Container>
    </footer>
  );
}
