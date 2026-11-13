'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, CircleNotch } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import type { ClientSnapshot } from '@/lib/db/snapshots';
import { cn } from './cn';

type Captcha = { image: string; token: string; auto: boolean };

/**
 * Link an ERP account: University ID, password, and the ERP captcha (read by
 * the solver and shown for a glance, or typed by hand when it is down).
 *   first  — the first account, on the home screen
 *   add    — another account, from the account menu
 *   repair — re-enter the password of an account whose sync is paused
 */
export function LinkForm({
  mode,
  universityId: fixedId,
  onLinked,
}: {
  mode: 'first' | 'add' | 'repair';
  universityId?: string;
  onLinked: (universityId: string, snapshot: ClientSnapshot) => void;
}) {
  const [universityId, setUniversityId] = useState(fixedId ?? '');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaState, setCaptchaState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: 'id' | 'password' | 'captcha' | null; text: string } | null>(null);
  const loadSeq = useRef(0);
  const captchaInput = useRef<HTMLInputElement>(null);

  const loadCaptcha = useCallback(async () => {
    const seq = ++loadSeq.current;
    setCaptchaState('loading');
    setSlow(false);
    const slowTimer = window.setTimeout(() => {
      if (seq === loadSeq.current) setSlow(true);
    }, 4000);
    try {
      const auto = await fetch(api('/api/erp/auto-captcha'), { cache: 'no-store' });
      if (seq !== loadSeq.current) return;
      if (auto.status === 401) throw new Error('signed_out');
      if (auto.ok) {
        const d = await auto.json();
        setCaptcha({ image: d.image, token: d.sessionToken, auto: true });
        setCaptchaText(d.solution ?? '');
        setCaptchaState('ready');
        return;
      }
      const res = await fetch(api('/api/erp/captcha'), { cache: 'no-store' });
      if (seq !== loadSeq.current) return;
      if (res.status === 401) throw new Error('signed_out');
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'Attenly could not load a captcha from the ERP.');
      setCaptcha({ image: d.captchaImage, token: d.sessionToken, auto: false });
      setCaptchaText('');
      setCaptchaState('ready');
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setCaptcha(null);
      setCaptchaState('error');
      const msg = e instanceof Error ? e.message : '';
      setError({
        field: null,
        text:
          msg === 'signed_out'
            ? 'Your Google session ended. Reload the page to sign in again.'
            : msg || 'Attenly could not reach the ERP. Try again in a moment.',
      });
    } finally {
      window.clearTimeout(slowTimer);
    }
  }, []);

  useEffect(() => {
    // Fetch the first captcha on mount; its loading state is part of the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCaptcha();
    const seq = loadSeq;
    return () => {
      seq.current++; // drop answers to captcha requests still in flight
    };
  }, [loadCaptcha]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const id = universityId.trim();
    if (!id) return setError({ field: 'id', text: 'Enter your University ID.' });
    if (!password) return setError({ field: 'password', text: 'Enter your ERP password.' });
    if (!captcha) return setError({ field: 'captcha', text: 'Wait for the captcha to load.' });
    if (!captchaText.trim()) return setError({ field: 'captcha', text: 'Type the letters from the captcha.' });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api('/api/erp/link-and-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universityId: id, password, captchaText, sessionToken: captcha.token, label: label || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok && d.snapshot) {
        setPassword('');
        onLinked(id, d.snapshot as ClientSnapshot);
        return;
      }
      const code: string = d.code ?? '';
      if (code === 'bad_captcha' || code === 'captcha_expired') {
        setError({ field: 'captcha', text: 'The captcha didn’t match. Here’s a fresh one.' });
        await loadCaptcha();
        captchaInput.current?.focus();
      } else if (code === 'bad_credentials') {
        setError({ field: 'password', text: d.error || 'The ERP rejected that University ID or password.' });
        void loadCaptcha();
      } else if (res.status === 401 && code === 'auth_required') {
        setError({ field: null, text: 'Your Google session ended. Reload the page to sign in again.' });
      } else {
        setError({ field: null, text: d.error || 'Linking stopped partway. Try again in a moment.' });
        void loadCaptcha();
      }
    } catch {
      setError({ field: null, text: 'You look offline. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  const invalid = (f: 'id' | 'password' | 'captcha') => (error?.field === f ? true : undefined);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {mode === 'repair' ? (
        <p className="flex items-center justify-between rounded-[13px] bg-raised px-3.5 py-3 text-[14px] text-fg-2 hair">
          University ID <span className="mono font-semibold text-fg">{fixedId}</span>
        </p>
      ) : (
        <div>
          <label className="label" htmlFor={`uid-${mode}`}>
            University ID
          </label>
          <input
            id={`uid-${mode}`}
            className="field tnum lg lg-input"
            value={universityId}
            onChange={(e) => setUniversityId(e.target.value.replace(/\s/g, ''))}
            inputMode="numeric"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={32}
            aria-invalid={invalid('id')}
            aria-describedby={error?.field === 'id' ? 'link-error' : undefined}
          />
        </div>
      )}
      <div>
        <label className="label" htmlFor={`pwd-${mode}`}>
          ERP password
        </label>
        <input
          id={`pwd-${mode}`}
          type="password"
          className="field lg lg-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          maxLength={128}
          aria-invalid={invalid('password')}
          aria-describedby={error?.field === 'password' ? 'link-error' : undefined}
          autoFocus={mode === 'repair'}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="label !mb-0" htmlFor={`cap-${mode}`}>
            Captcha
          </label>
          <button
            type="button"
            onClick={() => void loadCaptcha()}
            disabled={captchaState === 'loading' || busy}
            className="press -mr-2 inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-fg-2 hover:text-fg disabled:opacity-40 lg-press"
          >
            <ArrowClockwise size={15} aria-hidden /> New captcha
          </button>
        </div>
        <div className="flex items-stretch gap-3">
          <div className="flex h-12 w-[136px] shrink-0 items-center justify-center overflow-hidden rounded-[13px] bg-fg">
            {captchaState === 'ready' && captcha ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL from the ERP; next/image can't optimise it
              <img src={captcha.image} alt="ERP captcha" className="h-full w-full object-contain p-1" />
            ) : captchaState === 'loading' ? (
              <CircleNotch size={20} className="spin text-black/50" aria-label="Loading captcha" />
            ) : (
              <span className="px-2 text-center text-[11px] font-semibold text-black/60">No captcha</span>
            )}
          </div>
          <input
            ref={captchaInput}
            id={`cap-${mode}`}
            className="field mono flex-1 tracking-[0.14em] lg lg-input"
            value={captchaText}
            onChange={(e) => setCaptchaText(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={12}
            aria-invalid={invalid('captcha')}
            aria-describedby={`cap-hint-${mode}${error?.field === 'captcha' ? ' link-error' : ''}`}
          />
        </div>
        <p id={`cap-hint-${mode}`} className="mt-2 text-[12.5px] text-fg-3" aria-live="polite">
          {captchaState === 'loading'
            ? slow
              ? 'Waking the captcha reader. The first read can take half a minute.'
              : 'Reading the captcha…'
            : captcha?.auto
              ? 'Read automatically. Check it against the image.'
              : captchaState === 'ready'
                ? 'Type the letters you see.'
                : 'Load a new captcha to continue.'}
        </p>
      </div>

      {mode === 'add' && (
        <div>
          <label className="label" htmlFor="label-add">
            Name for this account <span className="text-fg-3">(optional)</span>
          </label>
          <input id="label-add" className="field lg lg-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
        </div>
      )}

      {error && (
        <p id="link-error" role="alert" data-tone="detained" className="rounded-[14px] bg-tone/12 px-4 py-3 text-[14px] text-fg ring-1 ring-inset ring-tone/30">
          {error.text}
        </p>
      )}

      <button type="submit" disabled={busy || captchaState !== 'ready'} className={cn('btn btn-primary btn-lg press mt-1 w-full lg lg-btn', busy && 'cursor-wait')}>
        {busy ? (
          <>
            <CircleNotch size={18} className="spin" aria-hidden />
            <span>Signing in and syncing…</span>
          </>
        ) : mode === 'repair' ? (
          'Save password and sync'
        ) : (
          'Link and sync'
        )}
      </button>
      {busy && <p className="-mt-2 text-center text-[12.5px] text-fg-3">This takes about 20 seconds.</p>}

      <p className="text-[12.5px] leading-relaxed text-fg-3 pretty">
        Attenly keeps your University ID and ERP password with your Google account so it can sign in and sync for you.
        They are stored as you typed them, not encrypted.
      </p>
    </form>
  );
}
