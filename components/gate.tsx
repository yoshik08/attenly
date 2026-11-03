'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { GoogleLogo } from '@phosphor-icons/react';
import { BASE_PATH, CANONICAL_ORIGIN } from '@/lib/api';
import { LinkForm } from './link-form';
import { useStore } from './store';
import { claimIntro, pencilSweep } from './motion';

const AUTH_ERRORS: Record<string, string> = {
  OAuthCallback: 'Google sign-in didn’t finish. Try again.',
  OAuthSignin: 'Google sign-in couldn’t start. Try again.',
  AccessDenied: 'This Google account isn’t allowed to use Attenly.',
  Callback: 'Google sign-in didn’t finish. Try again.',
  OAuthAccountNotLinked: 'Sign in with the same Google account you used before.',
  SessionRequired: 'Sign in to continue.',
  Default: 'Google sign-in didn’t finish. Try again.',
};

/** Twelve bubbles inking in: the product's whole idea, without a single fake number. */
function SheetMotif() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (claimIntro()) pencilSweep(ref.current);
  }, []);
  const states = ['on', 'on', 'on', 'off', 'on', 'on', 'on', 'on', 'off', 'on', 'on', 'on'];
  return (
    <div ref={ref} className="sheet !gap-2 [--b:18px]" aria-hidden>
      {states.map((s, i) => (
        <span key={i} className="bub" data-s={s} />
      ))}
      <span className="sheet-gap" />
      <span className="bub" data-s="spare" />
      <span className="bub" data-s="spare" />
    </div>
  );
}

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
    <section className="page-in mx-auto flex min-h-[calc(100dvh-var(--bar-h)-80px)] max-w-[520px] flex-col justify-center py-12">
      <SheetMotif />
      <h1 className="title-l mt-8 balance text-[40px] lg:text-[48px]">Your KL attendance, without the ERP.</h1>
      <p className="mt-4 max-w-[46ch] text-[16px] text-dropout-text pretty">
        Attenly signs into the ERP for you, keeps your attendance synced on its own, and tells you how many classes you can
        still skip before 85%.
      </p>
      {error && (
        <p role="alert" className="mt-6 rounded-xl bg-[#1a0d0c] px-3.5 py-3 text-[14px] text-[#ffb4ab]">
          {error}
        </p>
      )}
      {offCanonical ? (
        // Google only returns to yoshik.xyz (NEXTAUTH_URL), so sign in there.
        <a href={`${CANONICAL_ORIGIN}${BASE_PATH}?signin=1`} className="btn btn-mark press mt-8 w-full sm:w-auto sm:self-start">
          <GoogleLogo size={18} weight="bold" aria-hidden />
          Continue with Google
        </a>
      ) : (
        <button type="button" onClick={start} disabled={busy} className="btn btn-mark press mt-8 w-full sm:w-auto sm:self-start">
          <GoogleLogo size={18} weight="bold" aria-hidden />
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
      )}
      <p className="mt-6 text-[12px] text-dropout-quiet">
        Unofficial student project, not affiliated with KL University.{' '}
        <Link href="/privacy" className="underline hover:text-mark">
          Privacy
        </Link>
      </p>
    </section>
  );
}

export function FirstLink() {
  const { user, onLinked } = useStore();
  return (
    <section className="page-in mx-auto max-w-[460px] py-10">
      <h1 className="title-l balance">Link your ERP account</h1>
      <p className="mt-3 text-[15px] text-dropout-text pretty">
        {user?.name ? `Signed in as ${user.name}. ` : ''}
        Log in to the KL ERP here once. From then on Attenly signs in and syncs for you.
      </p>
      <div className="mt-8">
        <LinkForm mode="first" onLinked={(id, snap) => void onLinked(id, snap)} />
      </div>
    </section>
  );
}
