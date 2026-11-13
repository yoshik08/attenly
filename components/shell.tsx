'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowsClockwise,
  UserCircle,
  Calculator,
  CalendarBlank,
  CalendarCheck,
  CaretUpDown,
  ChartLineUp,
  Check,
  ClockCounterClockwise,
  DotsThreeCircle,
  GearSix,
  GraduationCap,
  Plus,
  Receipt,
  SignOut,
  ChartDonut,
  WarningCircle,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { useStore } from './store';
import { Popover, Sheet } from './overlay';
import { LinkForm } from './link-form';
import { cn } from './cn';
import { ago, clock, useNow } from '@/lib/time';
import { termText } from '@/lib/terms';

interface Section {
  href: string;
  label: string;
  /** The phone dock's shorter label. */
  short?: string;
  Icon: PhosphorIcon;
  /** One line for the phone's More sheet. */
  blurb?: string;
}

const MAIN: Section[] = [
  { href: '/', label: 'Attendance', Icon: ChartDonut },
  { href: '/timetable', label: 'Timetable', Icon: CalendarBlank },
  { href: '/plan', label: 'Plan the day', short: 'Plan', Icon: CalendarCheck },
  { href: '/forecast', label: 'Forecast', Icon: ChartLineUp },
  { href: '/history', label: 'History', Icon: ClockCounterClockwise, blurb: 'Every class, day by day' },
];
const RECORDS: Section[] = [
  { href: '/cgpa', label: 'CGPA', Icon: GraduationCap, blurb: 'Grades and SGPA by semester' },
  { href: '/payments', label: 'Payments', Icon: Receipt, blurb: 'Fee orders and receipts' },
  { href: '/calculator', label: 'Calculator', Icon: Calculator, blurb: 'Numbers you have in your head' },
];
const SETTINGS: Section = { href: '/settings', label: 'Settings', Icon: GearSix, blurb: 'Accounts, semester, target' };

/** Four sections keep a slot in the phone dock; the rest live under More. */
const DOCK = MAIN.slice(0, 4);
const MORE = [MAIN[4], ...RECORDS, SETTINGS];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="12" r="5.25" fill="#f5f5f7" />
      <circle cx="17.25" cy="12" r="3.4" fill="none" stroke="#34d47a" strokeWidth="1.9" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { phase } = useStore();
  const signedIn = phase === 'ready' || phase === 'error';
  return (
    <div className={cn('min-h-dvh', signedIn && 'lg:grid lg:grid-cols-[252px_minmax(0,1fr)]')}>
      {signedIn && <Sidebar />}
      <div className="flex min-h-dvh min-w-0 flex-col">
        <TopBar signedIn={signedIn} />
        <main className="page-bottom mx-auto w-full max-w-[1120px] flex-1 px-4 sm:px-6 lg:px-12">{children}</main>
      </div>
      {signedIn && <Dock />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop: the sidebar                                                */
/* ------------------------------------------------------------------ */

function SideLink({ s, pathname }: { s: Section; pathname: string }) {
  const active = isActive(pathname, s.href);
  return (
    <Link href={s.href} aria-current={active ? 'page' : undefined} className="side-link press lg-press">
      <s.Icon size={19} weight={active ? 'fill' : 'regular'} aria-hidden className={active ? 'text-fg' : 'text-fg-3'} />
      {s.label}
    </Link>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const hasAccount = useStore().accounts.length > 0;
  return (
    <aside className="side hidden flex-col px-3 pb-4 pt-5 lg:flex">
      {/* The sidebar's glass is a layer beside its content, never around it: the account
          menu's sheet and popovers live in here, and a backdrop-filter ancestor would trap them.
          Tall, so frosted only. */}
      <span aria-hidden className="lg lg-card lg-frost pointer-events-none absolute inset-0 -z-1 rounded-none shadow-none" />
      <Link href="/" className="press lg-press mx-2 mb-7 flex items-center gap-2.5 self-start rounded-lg px-1 py-1" aria-label="Attenly home">
        <Logo />
        <span className="wordmark">Attenly</span>
      </Link>
      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {MAIN.map((s) => (
          <SideLink key={s.href} s={s} pathname={pathname} />
        ))}
        <div className="mx-3 my-3 h-px bg-line" aria-hidden />
        {RECORDS.map((s) => (
          <SideLink key={s.href} s={s} pathname={pathname} />
        ))}
        <div className="mx-3 my-3 h-px bg-line" aria-hidden />
        <SideLink s={SETTINGS} pathname={pathname} />
      </nav>
      <div className="mt-auto flex flex-col gap-1.5 pt-6">
        {hasAccount && <SyncButton variant="side" />}
        <AccountMenu variant="side" />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Phones: top bar and dock                                            */
/* ------------------------------------------------------------------ */

function TopBar({ signedIn }: { signedIn: boolean }) {
  const hasAccount = useStore().accounts.length > 0;
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header className={cn('topbar material sticky top-0 z-40', signedIn && 'lg:hidden')} data-scrolled={scrolled}>
      <div className="mx-auto flex h-[var(--bar-h)] max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="press lg-press flex shrink-0 items-center gap-2 rounded-lg py-1" aria-label="Attenly home">
          <Logo size={20} />
          <span className="wordmark text-[19px]">Attenly</span>
        </Link>
        {signedIn && (
          <div className="flex min-w-0 items-center gap-2">
            {hasAccount && <SyncButton variant="bar" />}
            <AccountMenu variant="bar" />
          </div>
        )}
      </div>
    </header>
  );
}

function Dock() {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const moreActive = MORE.some((s) => isActive(pathname, s.href));

  const place = useCallback((animate: boolean) => {
    const ul = list.current;
    const p = pill.current;
    if (!ul || !p) return;
    const active = ul.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      p.style.opacity = '0';
      return;
    }
    if (!animate) p.style.transition = 'none';
    p.style.opacity = '1';
    p.style.width = `${active.offsetWidth - 8}px`;
    p.style.transform = `translateX(${active.offsetLeft + 4}px)`;
    if (!animate) {
      void p.offsetWidth;
      p.style.transition = '';
    }
  }, []);

  useIso(() => {
    place(placed.current);
    placed.current = true;
  }, [pathname, place]);

  useEffect(() => {
    const ul = list.current;
    if (!ul || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(ul);
    return () => ro.disconnect();
  }, [place]);

  return (
    <>
      <nav className="lg:hidden" aria-label="Sections">
        <div className="dock-fade z-30" aria-hidden />
        <div className="dock glass z-40 lg lg-card">
          <span ref={pill} className="dock-pill" aria-hidden />
          <ul ref={list} className="relative grid h-full grid-cols-5 px-1">
            {DOCK.map(({ href, label, short, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href} className="min-w-0" data-active={active}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    aria-label={short ? label : undefined}
                    className={cn(
                      'press lg-press flex h-full flex-col items-center justify-center gap-[3px] text-[10.5px] font-semibold',
                      active ? 'text-fg' : 'text-fg-2',
                    )}
                  >
                    <Icon size={23} weight={active ? 'fill' : 'regular'} aria-hidden />
                    <span className="max-w-full truncate px-0.5">{short ?? label}</span>
                  </Link>
                </li>
              );
            })}
            <li className="min-w-0" data-active={moreActive}>
              <button
                type="button"
                onClick={() => setMore(true)}
                aria-expanded={more}
                aria-haspopup="dialog"
                className={cn(
                  'press lg-press flex h-full w-full flex-col items-center justify-center gap-[3px] text-[10.5px] font-semibold',
                  moreActive ? 'text-fg' : 'text-fg-2',
                )}
              >
                <DotsThreeCircle size={23} weight={moreActive ? 'fill' : 'regular'} aria-hidden />
                More
              </button>
            </li>
          </ul>
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <ul className="grid grid-cols-2 gap-2.5">
          {MORE.map(({ href, label, Icon, blurb }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setMore(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'press flex h-full flex-col gap-3 rounded-[20px] p-4 lg lg-card lg-press',
                    active ? 'bg-raised-2 hair' : 'bg-raised hover:bg-raised-2',
                  )}
                >
                  <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden className="text-fg" />
                  <span>
                    <span className="block text-[15px] font-semibold">{label}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-fg-2">{blurb}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-5 text-center text-[12px] text-fg-3">
          Unofficial, not affiliated with KL University.{' '}
          <Link href="/privacy" onClick={() => setMore(false)} className="link">
            Privacy
          </Link>
        </p>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sync state                                                          */
/* ------------------------------------------------------------------ */

/**
 * What the last sync attempt means, in plain words. A fast stop (the ERP was
 * slow or rate-limiting) is not a failure of the data: the last snapshot is
 * still on screen, so the status says so.
 */
function syncMeaning(code: string | null): { text: string; tone: 'condonation' | 'detained' } {
  switch (code) {
    case 'erp_slow':
      return { text: 'ERP slow — showing last sync', tone: 'condonation' };
    case 'rate_limited':
      return { text: 'ERP busy — showing last sync', tone: 'condonation' };
    case 'offline':
      return { text: 'You’re offline', tone: 'condonation' };
    case 'solver_unavailable':
      return { text: 'Captcha reader down', tone: 'detained' };
    case 'bad_captcha':
      return { text: 'ERP captcha unreadable', tone: 'detained' };
    case 'erp_unreachable':
      return { text: 'ERP unreachable', tone: 'detained' };
    case 'db_unavailable':
      return { text: 'Attenly’s database is down', tone: 'detained' };
    default:
      return { text: 'Sync failed', tone: 'detained' };
  }
}

function useSyncView() {
  const store = useStore();
  const { snapshot, sync, stale, activeAccount } = store;
  const now = useNow(20_000);
  const failed = Boolean(!sync.running && sync.message && sync.code !== 'synced' && sync.code !== 'fresh');
  const needsPassword = Boolean(activeAccount?.needsPassword);
  const meaning = syncMeaning(sync.code);
  let tone: 'none' | 'safe' | 'condonation' | 'detained' | 'mark' = 'none';
  let text = snapshot ? `Synced ${ago(snapshot.syncedAt, now)}` : 'Not synced yet';
  if (sync.running) {
    tone = 'mark';
    text = 'Syncing with ERP';
  } else if (needsPassword) {
    tone = 'condonation';
    text = 'Password needed';
  } else if (failed) {
    tone = meaning.tone;
    text = meaning.text;
  } else if (snapshot && !stale) {
    tone = 'safe';
  }
  return { ...store, now, failed, needsPassword, meaning, tone, text };
}

function SyncButton({ variant }: { variant: 'bar' | 'side' }) {
  const v = useSyncView();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const label = (
    <>
      <span data-tone={v.tone} className={cn('dot', v.tone === 'safe' && 'dot-live')} aria-hidden />
      {v.sync.running ? (
        <span className="t-shimmer truncate" data-text="Syncing with ERP">
          Syncing with ERP
        </span>
      ) : (
        <span className="truncate">{v.text}</span>
      )}
    </>
  );
  return (
    <div className="relative min-w-0">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Sync status: ${v.text}`}
        className={cn(
          'press flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg-2 hover:text-fg',
          variant === 'bar'
            ? 'h-9 max-w-[200px] rounded-full bg-raised px-3 hair lg lg-btn'
            : 'h-10 w-full rounded-[12px] px-3 hover:bg-white/[0.045] lg-press',
        )}
      >
        {label}
        {variant === 'side' && (
          <ArrowsClockwise size={15} className={cn('ml-auto shrink-0 text-fg-3', v.sync.running && 'spin')} aria-hidden />
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label="Sync status" placement={variant === 'side' ? 'up' : 'down'}>
        <SyncPanel v={v} onDone={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

function SyncPanel({ v, onDone }: { v: ReturnType<typeof useSyncView>; onDone: () => void }) {
  const { snapshot, sync, failed, needsPassword, meaning, now, freshMs, activeAccount, forceSync } = v;
  const minutes = Math.round((freshMs / 60000) * 2) / 2;
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span data-tone={v.tone} className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tone/15">
          <ArrowsClockwise size={18} className={cn('text-tone', sync.running && 'spin')} aria-hidden />
        </span>
        <div className="min-w-0">
          {snapshot ? (
            <p className="text-[15px] font-semibold">Last synced at {clock(snapshot.syncedAt)}</p>
          ) : (
            <p className="text-[15px] font-semibold">No synced data yet</p>
          )}
          <p className="text-[13px] text-fg-2">
            {snapshot ? ago(snapshot.syncedAt, now) : 'Sync once to pull it from the ERP'}
            {snapshot?.term ? ` · ${termText(snapshot.term)}` : ''}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-fg-2 pretty">
        Attenly signs into the ERP for you whenever your data is older than {minutes} minutes and this app is open, and on
        its own in the background.
      </p>
      {failed && !needsPassword && (
        <div data-tone={meaning.tone} className="mt-3 rounded-[14px] bg-tone/10 p-3">
          <p className="flex gap-2 text-[13px] font-semibold text-tone">
            <WarningCircle size={17} weight="fill" className="mt-px shrink-0" aria-hidden />
            <span>{meaning.text}</span>
          </p>
          <p className="mt-1 pl-[25px] text-[13px] leading-relaxed text-fg-2 pretty">
            {sync.message}
            {meaning.text.includes('showing last sync') && snapshot ? ` The numbers on screen are from ${ago(snapshot.syncedAt, now)}.` : ''}
          </p>
        </div>
      )}
      {needsPassword && (
        <p data-tone="condonation" className="mt-3 flex gap-2 rounded-[14px] bg-tone/10 p-3 text-[13px] text-fg">
          <WarningCircle size={18} weight="fill" className="mt-px shrink-0 text-tone" aria-hidden />
          <span>{activeAccount?.lastError?.message ?? 'Enter your ERP password once to resume syncing.'}</span>
        </p>
      )}
      <button
        type="button"
        data-autofocus
        disabled={sync.running || needsPassword}
        onClick={() => void forceSync()}
        className="btn btn-primary press mt-4 w-full lg lg-btn"
      >
        <ArrowsClockwise size={18} className={sync.running ? 'spin' : ''} aria-hidden />
        {sync.running ? 'Syncing…' : failed ? 'Try again' : 'Sync now'}
      </button>
      {needsPassword && (
        <Link href="/settings#accounts" onClick={onDone} className="btn btn-secondary press mt-2 w-full lg lg-btn">
          Enter password
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

function initialsOf(name: string | null | undefined, email: string | null | undefined) {
  return (name ?? email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

function AccountMenu({ variant }: { variant: 'bar' | 'side' }) {
  const { user, accounts, active, activeAccount, switchAccount, signOut, onLinked } = useStore();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const initials = initialsOf(user?.name, user?.email);
  const short = active ? `…${active.slice(-3)}` : initials;

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={variant === 'bar' ? `Account ${short}` : undefined}
        className={cn(
          'press flex items-center gap-2.5 text-left',
          variant === 'bar'
            ? 'h-9 min-w-9 justify-center rounded-full bg-raised px-2.5 hair lg lg-btn'
            : 'w-full rounded-[12px] px-2 py-2 hover:bg-white/[0.045] lg-press',
        )}
      >
        {variant === 'bar' ? (
          <span className="mono text-[12.5px] font-semibold text-fg">{short}</span>
        ) : (
          <>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#3a3a40] to-[#1f1f23] text-fg hair">
              <UserCircle size={20} weight="fill" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">Account </span>
              <span className="block truncate text-[13.5px] font-semibold text-fg">{user?.name ?? 'Signed in'}</span>
              <span className="mono block truncate text-[11.5px] text-fg-3">
                {activeAccount ? (activeAccount.label ?? activeAccount.universityId) : 'No ERP account yet'}
              </span>
            </span>
            <CaretUpDown size={15} className="shrink-0 text-fg-3" aria-hidden />
          </>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label="Account" placement={variant === 'side' ? 'up' : 'down'}>
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#3a3a40] to-[#1f1f23] text-[14px] font-bold hair">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{user?.name ?? 'Signed in'}</p>
            {user?.email && <p className="truncate text-[13px] text-fg-2">{user.email}</p>}
          </div>
        </div>
        {accounts.length > 0 && (
          <ul className="hair-t px-1.5 py-1.5" aria-label="ERP accounts">
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
                    className="press lg-press flex w-full items-center justify-between gap-3 rounded-[12px] px-2.5 py-2.5 text-left hover:bg-white/[0.05]"
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{a.label ?? a.universityId}</span>
                      <span className="block truncate text-[12px] text-fg-3">
                        {a.label ? <span className="mono">{a.universityId}, </span> : ''}
                        {a.needsPassword ? 'needs password' : a.primary ? 'primary' : 'linked'}
                      </span>
                    </span>
                    {isActive && <Check size={18} weight="bold" className="shrink-0 text-safe" aria-label="Showing" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="hair-t px-1.5 py-1.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setAdding(true);
            }}
            className="press lg-press flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2.5 text-left text-[15px] hover:bg-white/[0.05]"
          >
            <Plus size={18} aria-hidden className="text-fg-2" /> Link another ERP account
          </button>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="press lg-press flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2.5 text-left text-[15px] hover:bg-white/[0.05]"
          >
            <GearSix size={18} aria-hidden className="text-fg-2" /> Settings
          </Link>
        </div>
        <div className="hair-t p-3">
          <button type="button" onClick={() => void signOut()} className="btn btn-danger btn-sm press w-full lg lg-btn">
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
