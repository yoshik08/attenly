'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowsClockwise,
  Calculator,
  CalendarBlank,
  CalendarCheck,
  ChartLineUp,
  Check,
  ClockCounterClockwise,
  DotsThree,
  GearSix,
  GraduationCap,
  Plus,
  RadioButton,
  Receipt,
  SignOut,
  WarningCircle,
} from '@phosphor-icons/react';
import { useStore } from './store';
import { Popover, Sheet } from './overlay';
import { LinkForm } from './link-form';
import { cn } from './cn';
import { ago, clock, useNow } from '@/lib/time';

const TABS = [
  { href: '/', label: 'Attendance', Icon: RadioButton },
  { href: '/timetable', label: 'Timetable', Icon: CalendarBlank },
  { href: '/plan', label: 'Plan the day', Icon: CalendarCheck },
  { href: '/forecast', label: 'Forecast', Icon: ChartLineUp },
  { href: '/history', label: 'History', Icon: ClockCounterClockwise },
  { href: '/payments', label: 'Payments', Icon: Receipt },
  { href: '/cgpa', label: 'CGPA', Icon: GraduationCap },
  { href: '/calculator', label: 'Calculator', Icon: Calculator },
  { href: '/settings', label: 'Settings', Icon: GearSix },
] as const;

/** The five sections that keep a slot in the phone bar; the rest live under More. */
const PHONE_PRIMARY = ['/', '/timetable', '/plan', '/forecast', '/history'] as const;
const inPhoneBar = (href: string) => (PHONE_PRIMARY as readonly string[]).includes(href);

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { phase } = useStore();
  const signedIn = phase === 'ready' || phase === 'error';
  return (
    <>
      <TopBar signedIn={signedIn} />
      <main className="page-bottom mx-auto w-full max-w-[1160px] flex-1 px-4 lg:px-8">{children}</main>
      {signedIn && <TabBar />}
    </>
  );
}

function TopBar({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const hasAccount = useStore().accounts.length > 0;
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header className="topbar material sticky top-0 z-40" data-scrolled={scrolled}>
      <div className="mx-auto flex h-[var(--bar-h)] max-w-[1160px] items-center justify-between gap-3 px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" className="wordmark press shrink-0 rounded-md" aria-label="Attenly home">
            Attenly
          </Link>
          {signedIn && (
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
              {TABS.map((t) => {
                const active = isActive(pathname, t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'press whitespace-nowrap rounded-full px-3 py-2 text-[14px] font-medium',
                      active ? 'bg-[#121826] text-mark' : 'text-dropout-text hover:text-mark',
                    )}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
        {signedIn && (
          <div className="flex items-center gap-2">
            {hasAccount && <SyncPill />}
            <AccountMenu />
          </div>
        )}
      </div>
    </header>
  );
}

function TabBar() {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const primary = TABS.filter((t) => inPhoneBar(t.href));
  const rest = TABS.filter((t) => !inPhoneBar(t.href));
  const moreActive = rest.some((t) => isActive(pathname, t.href));
  return (
    <>
      <nav className="tabbar material fixed inset-x-0 bottom-0 z-40 lg:hidden" aria-label="Sections">
        <ul className="mx-auto grid h-[var(--tab-h)] max-w-[560px] grid-cols-6">
          {primary.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="min-w-0">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'press flex h-full flex-col items-center justify-center gap-1 px-0.5 text-center text-[9px] font-medium leading-[1.15]',
                    active ? 'text-mark' : 'text-dropout-quiet',
                  )}
                >
                  <Icon size={21} weight={active ? 'fill' : 'regular'} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => setMore(true)}
              aria-expanded={more}
              aria-haspopup="dialog"
              className={cn(
                'press flex h-full w-full flex-col items-center justify-center gap-1 px-0.5 text-center text-[9px] font-medium leading-[1.15]',
                moreActive ? 'text-mark' : 'text-dropout-quiet',
              )}
            >
              <DotsThree size={21} weight={moreActive ? 'bold' : 'regular'} aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <ul className="py-1">
          {rest.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setMore(false)}
                  aria-current={active ? 'page' : undefined}
                  className="press flex items-center gap-3 px-1 py-3 text-[15px] hover:text-mark"
                >
                  <Icon size={20} weight={active ? 'fill' : 'regular'} className={active ? 'text-mark' : 'text-dropout-text'} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sync state                                                          */
/* ------------------------------------------------------------------ */

function SyncPill() {
  const { snapshot, sync, stale, activeAccount, forceSync, freshMs } = useStore();
  const now = useNow(20_000);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const failed = !sync.running && sync.message && sync.code !== 'synced' && sync.code !== 'fresh';
  const needsPassword = Boolean(activeAccount?.needsPassword);
  let dot = 'bg-dropout';
  let text: ReactNode = snapshot ? `Synced ${ago(snapshot.syncedAt, now)}` : 'Not synced yet';
  if (sync.running) {
    dot = 'bg-mark';
    text = (
      <span className="t-shimmer" data-text="Syncing with ERP">
        Syncing with ERP
      </span>
    );
  } else if (needsPassword) {
    dot = 'bg-thin';
    text = 'Password needed';
  } else if (failed) {
    dot = 'bg-red';
    text = 'Sync failed';
  } else if (snapshot && !stale) {
    dot = 'bg-cruise';
  }

  const minutes = Math.round(freshMs / 60000 * 2) / 2;
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="press inline-flex h-9 max-w-[52vw] items-center gap-2 rounded-full px-3 text-[13px] font-medium text-dropout-text ring-seam hover:text-mark"
      >
        <span className={cn('dot', dot)} aria-hidden />
        <span className="truncate">{text}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label="Sync status">
        <div className="p-4">
          {snapshot ? (
            <p className="text-[15px] font-semibold">
              Last synced at {clock(snapshot.syncedAt)}
              <span className="font-normal text-dropout-text">, {ago(snapshot.syncedAt, now)}</span>
            </p>
          ) : (
            <p className="text-[15px] font-semibold">No synced data yet</p>
          )}
          <p className="mt-1 text-[13px] text-dropout-text pretty">
            Attenly signs into the ERP for you whenever your data is older than {minutes} minutes and this app is open,
            and on its own in the background.
          </p>
          {(failed || needsPassword) && (
            <p className="mt-3 flex gap-2 rounded-xl bg-[#1a0d0c] p-3 text-[13px] text-[#ffb4ab]">
              <WarningCircle size={18} className="mt-px shrink-0" aria-hidden />
              <span>{needsPassword ? (activeAccount?.lastError?.message ?? 'Enter your ERP password once to resume syncing.') : sync.message}</span>
            </p>
          )}
          <button
            type="button"
            data-autofocus
            disabled={sync.running || needsPassword}
            onClick={() => void forceSync()}
            className="btn btn-mark press mt-4 w-full"
          >
            <ArrowsClockwise size={18} className={sync.running ? 'spin' : ''} aria-hidden />
            {sync.running ? 'Syncing…' : 'Sync now'}
          </button>
          {needsPassword && (
            <Link href="/settings#accounts" onClick={() => setOpen(false)} className="btn btn-line press mt-2 w-full">
              Enter password
            </Link>
          )}
        </div>
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

function AccountMenu() {
  const { user, accounts, active, switchAccount, signOut, onLinked } = useStore();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const initials = (user?.name ?? user?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Account ${active ? `…${active.slice(-3)}` : initials}`}
        className="press inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-[#121826] px-2.5 text-[13px] font-semibold text-mark"
      >
        {active ? <span className="figure text-[13px] tracking-normal">…{active.slice(-3)}</span> : initials}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label="Account">
        <div className="seam-b px-4 pb-3 pt-4">
          <p className="truncate text-[15px] font-semibold">{user?.name ?? 'Signed in'}</p>
          {user?.email && <p className="truncate text-[13px] text-dropout-text">{user.email}</p>}
        </div>
        {accounts.length > 0 && (
          <ul className="seam-b py-1.5" aria-label="ERP accounts">
            {accounts.map((a) => {
              const isActive = a.universityId === active;
              return (
                <li key={a.universityId}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) void switchAccount(a.universityId);
                    }}
                    className="press flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[#0f1420]"
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{a.label ?? a.universityId}</span>
                      <span className="block truncate text-[12px] text-dropout-quiet tnum">
                        {a.label ? `${a.universityId}, ` : ''}
                        {a.needsPassword ? 'needs password' : a.primary ? 'primary' : 'linked'}
                      </span>
                    </span>
                    {isActive && <Check size={18} className="shrink-0 text-cruise" aria-label="Showing" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="py-1.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setAdding(true);
            }}
            className="press flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-[#0f1420]"
          >
            <Plus size={18} aria-hidden /> Link another ERP account
          </button>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="press flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-[#0f1420]"
          >
            <GearSix size={18} aria-hidden /> Settings
          </Link>
        </div>
        <div className="seam-t p-3">
          <button type="button" onClick={() => void signOut()} className="btn btn-danger btn-sm press w-full">
            <SignOut size={16} aria-hidden /> Sign out of Google
          </button>
        </div>
      </Popover>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Link another ERP account">
        {adding && (
          <LinkForm
            mode="add"
            onLinked={(id, snap) => {
              setAdding(false);
              void onLinked(id, snap);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
