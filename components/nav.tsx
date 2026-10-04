'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
];

const ACTIVE_ACCOUNT_KEY = 'attenly-active-account';

export function getActiveAccount(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_ACCOUNT_KEY);
}

export function setActiveAccount(universityId: string | null) {
  if (typeof window === 'undefined') return;
  if (universityId) {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, universityId);
  } else {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  }
}

function AccountDropdown() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<{ universityId: string; label: string }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setActive(getActiveAccount());
    fetch(api('/api/erp/accounts'))
      .then(r => r.ok ? r.json() : { accounts: [] })
      .then(d => setAccounts(d.accounts || []))
      .catch(() => {});
  }, []);

  const switchAccount = (universityId: string) => {
    setActiveAccount(universityId);
    setActive(universityId);
    setOpen(false);
    window.location.reload();
  };

  if (accounts.length <= 1 && !open) {
    // Still show dropdown for "Add another" option
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="ERP accounts"
        className="rounded-full border border-[#232327] bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-[#A1A1A8] transition hover:border-white/20 hover:text-white"
      >
        {active ? active.slice(-4) : 'ERP'} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-[#232327] bg-[#141416] p-2 shadow-xl">
            <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#A1A1A8]">
              ERP Accounts
            </p>
            {accounts.map(a => (
              <button
                key={a.universityId}
                onClick={() => switchAccount(a.universityId)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition',
                  active === a.universityId || (!active && accounts[0]?.universityId === a.universityId)
                    ? 'bg-[#E9A13B]/15 text-[#E9A13B]'
                    : 'text-[#F5F4F0] hover:bg-white/[0.05]'
                )}
              >
                <span>{a.label}</span>
                {(active === a.universityId || (!active && accounts[0]?.universityId === a.universityId)) && (
                  <span className="text-xs">✓</span>
                )}
              </button>
            ))}
            <button
              onClick={() => { setShowAdd(true); setOpen(false); }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-[#232327] px-3 py-2.5 text-left text-sm text-[#E9A13B] transition hover:bg-white/[0.05]"
            >
              <span className="text-lg leading-none">+</span> Add another ERP account
            </button>
          </div>
        </>
      )}
      {showAdd && <AddAccountModal onClose={() => setShowAdd(false)} onAdded={() => window.location.reload()} />}
    </div>
  );
}

function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  // Reuses the link flow — simplified inline version
  const [universityId, setUniversityId] = useState('');
  const [password, setPassword] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadCaptcha = async () => {
    setError('');
    setCaptchaText('');
    try {
      // Try auto-solver first
      const auto = await fetch(api('/api/erp/auto-captcha'));
      if (auto.ok) {
        const d = await auto.json();
        setCaptchaImage(d.image);
        setSessionToken(d.sessionToken);
        // Auto-fill after a short delay (mimics typing)
        setTimeout(() => {
          if (d.solution) setCaptchaText(d.solution);
        }, 900);
        return;
      }
      // Fallback to manual captcha
      const res = await fetch(api('/api/erp/captcha'));
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to load captcha');
      setCaptchaImage(d.captchaImage);
      setSessionToken(d.sessionToken);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { loadCaptcha(); }, []);

  const submit = async () => {
    if (!universityId || !password || !captchaText) {
      setError('Fill all fields.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(api('/api/erp/link-and-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universityId, password, captchaText, sessionToken }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Link failed');
      onAdded();
    } catch (e: any) {
      setError(e.message);
      loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70" onClick={onClose}>
      <div className="fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#232327] bg-[#141416] p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-2xl font-black text-[#F5F4F0]">Add ERP Account</h2>
        <p className="mt-1 text-sm text-[#A1A1A8]">Link another KL University login.</p>
        <div className="mt-4 space-y-3">
          <input
            value={universityId}
            onChange={e => setUniversityId(e.target.value)}
            placeholder="University ID"
            className="w-full rounded-xl border border-[#232327] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-[#A1A1A8] focus:border-[#E9A13B] focus:outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="ERP password"
            className="w-full rounded-xl border border-[#232327] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-[#A1A1A8] focus:border-[#E9A13B] focus:outline-none"
          />
          {captchaImage && (
            <img src={captchaImage} alt="Captcha" className="h-12 rounded-lg border border-[#232327]" />
          )}
          <input
            value={captchaText}
            onChange={e => setCaptchaText(e.target.value)}
            placeholder="Type the letters above"
            className="w-full rounded-xl border border-[#232327] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-[#A1A1A8] focus:border-[#E9A13B] focus:outline-none"
          />
          {error && <p className="text-sm text-[#F87171]">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#232327] px-4 py-2.5 text-sm font-semibold text-[#A1A1A8] transition hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={loading}
              className="flex-1 rounded-xl bg-[#E9A13B] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[#d18f2e] disabled:opacity-50"
            >
              {loading ? 'Linking...' : 'Link & pull →'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
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
              <Chip tone="mint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34D399]" />
                Live link
              </Chip>
              <HardSyncButton />
            </>
          )}
          <AccountDropdown />
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
