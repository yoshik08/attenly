'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { ArrowsClockwise, Calculator, GoogleLogo, Key } from '@phosphor-icons/react';
import { BASE_PATH, CANONICAL_ORIGIN } from '@/lib/api';
import { LinkForm } from './link-form';
import { useStore } from './store';
import { reducedMotion } from './motion';
import { cn } from './cn';

const AUTH_ERRORS: Record<string, string> = {
  OAuthCallback: 'Google sign-in didn’t finish. Try again.',
  OAuthSignin: 'Google sign-in couldn’t start. Try again.',
  AccessDenied: 'This Google account isn’t allowed to use Attenly.',
  Callback: 'Google sign-in didn’t finish. Try again.',
  OAuthAccountNotLinked: 'Sign in with the same Google account you used before.',
  SessionRequired: 'Sign in to continue.',
  Default: 'Google sign-in didn’t finish. Try again.',
};

/**
 * Three rings drawing themselves in light, each cut at the 85% line. Pure
 * form: no figures, so nothing here pretends to be anyone's attendance.
 */
function HeroRings({ className }: { className?: string }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (reducedMotion()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no sweep: show the end state at once
      setGo(true);
      return;
    }
    const t = window.setTimeout(() => setGo(true), 120);
    return () => window.clearTimeout(t);
  }, []);
  const rings = [
    { r: 128, len: 93, tone: 'safe' },
    { r: 100, len: 79, tone: 'condonation' },
    { r: 72, len: 68, tone: 'medical' },
  ] as const;
  const a = 0.85 * 2 * Math.PI;
  return (
    <div className={cn('relative aspect-square', className)} aria-hidden>
      <div
        className="absolute inset-[8%] rounded-full opacity-70 blur-3xl"
        style={{ background: 'conic-gradient(from 0deg, rgba(52,212,122,0.28), rgba(255,178,62,0.2), rgba(106,168,255,0.24), rgba(52,212,122,0.28))' }}
      />
      <svg viewBox="0 0 300 300" className="relative h-full w-full -rotate-90 overflow-visible">
        {rings.map((ring, i) => (
          <g key={ring.r} data-tone={ring.tone}>
            <circle cx="150" cy="150" r={ring.r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="20" />
            <circle
              cx="150"
              cy="150"
              r={ring.r}
              fill="none"
              strokeWidth="20"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="100"
              strokeDashoffset={go ? 100 - ring.len : 100}
              className="ring-arc"
              style={{ stroke: 'var(--tone)', transition: 'stroke-dashoffset 1600ms cubic-bezier(0.22,1,0.36,1)', transitionDelay: `${i * 160}ms` }}
            />
          </g>
        ))}
        {/* One cut through every ring at the 85% line. */}
        <line x1={150 + 58 * Math.cos(a)} y1={150 + 58 * Math.sin(a)} x2={150 + 142 * Math.cos(a)} y2={150 + 142 * Math.sin(a)} stroke="#000" strokeWidth="3.5" />
      </svg>
    </div>
  );
}

const POINTS = [
  { Icon: Key, title: 'Signs in for you', body: 'It reads the ERP captcha itself. You type your password once.' },
  { Icon: ArrowsClockwise, title: 'Syncs on its own', body: 'Attendance, timetable and grades stay fresh in the background.' },
  { Icon: Calculator, title: 'Says what you can skip', body: 'Per course and class type, by the ERP’s own weighted formula.' },
];

export function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offCanonical, setOffCanonical] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const err = url.searchParams.get('error');
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const off = !local && url.origin !== CANONICAL_ORIGIN;
    // Read once after hydration; the server can't know the query or host.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (err) setError(AUTH_ERRORS[err] ?? AUTH_ERRORS.Default);
    setOffCanonical(off);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (err || url.searchParams.has('signin')) {
      url.searchParams.delete('error');
      const wantsSignIn = url.searchParams.has('signin');
      url.searchParams.delete('signin');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      // Arrived from the other domain's sign-in button: carry on straight away.
      if (wantsSignIn && !off && !started.current) {
        started.current = true;
        void signIn('google', { callbackUrl: BASE_PATH });
      }
    }
  }, []);

  const start = () => {
    setBusy(true);
    void signIn('google', { callbackUrl: BASE_PATH });
  };

  return (
    <section className="page-in grid min-h-[calc(100dvh-var(--bar-h)-var(--safe-t)-40px)] items-center gap-10 py-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:py-12">
      <HeroRings className="mx-auto w-[min(76vw,300px)] lg:order-2 lg:w-full lg:max-w-[460px]" />
      <div className="lg:order-1">
        <h1 className="display balance !text-[42px] !leading-[1.02] sm:!text-[54px] lg:!text-[64px]">Your KL attendance, without the ERP.</h1>
        <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-fg-2 pretty">
          Attenly signs into the ERP for you, keeps your attendance synced on its own, and tells you how many classes you can
          still skip before 85%.
        </p>
        {error && (
          <p role="alert" data-tone="detained" className="mt-6 rounded-[14px] bg-tone/12 px-4 py-3 text-[14px] text-fg">
            {error}
          </p>
        )}
        {offCanonical ? (
          // Google only returns to yoshik.xyz (NEXTAUTH_URL), so sign in there.
          <a href={`${CANONICAL_ORIGIN}${BASE_PATH}?signin=1`} className="btn btn-primary btn-lg press mt-8 w-full sm:w-auto lg lg-btn">
            <GoogleLogo size={19} weight="bold" aria-hidden />
            Continue with Google
          </a>
        ) : (
          <button type="button" onClick={start} disabled={busy} className="btn btn-primary btn-lg press mt-8 w-full sm:w-auto lg lg-btn">
            <GoogleLogo size={19} weight="bold" aria-hidden />
            {busy ? 'Opening Google…' : 'Continue with Google'}
          </button>
        )}
        <ul className="mt-10 grid gap-5 sm:grid-cols-3 sm:gap-4">
          {POINTS.map(({ Icon, title, body }) => (
            <li key={title} className="flex gap-3 sm:flex-col sm:gap-2.5">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-raised hair">
                <Icon size={18} className="text-fg" aria-hidden />
              </span>
              <span>
                <span className="block text-[14px] font-semibold">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-fg-2">{body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-[12.5px] text-fg-3">
          Unofficial student project, not affiliated with KL University.{' '}
          <Link href="/privacy" className="link">
            Privacy
          </Link>
        </p>
      </div>
    </section>
  );
}

export function FirstLink() {
  const { user, onLinked } = useStore();
  return (
    <section className="page-in mx-auto max-w-[480px] pb-6 pt-8 lg:pt-16">
      <h1 className="display balance">Link your ERP account</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-fg-2 pretty">
        {user?.name ? `Signed in as ${user.name}. ` : ''}
        Log in to the KL ERP here once. From then on Attenly signs in and syncs for you.
      </p>
      <div className="card mt-8 p-5 lg:p-6 lg lg-card">
        <LinkForm mode="first" onLinked={(id, snap) => void onLinked(id, snap)} />
      </div>
    </section>
  );
}
