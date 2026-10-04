'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { signIn } from 'next-auth/react';
import { Button, Chip, Field, GlassPanel, SectionHeader, inputClass } from '@/components/ui';
import { api } from '@/lib/api';
import type { SnapshotData } from '@/components/data-context';

type DecodeState = 'idle' | 'decoding' | 'filled' | 'manual';

interface Me {
  signedIn: boolean;
  googleConfigured: boolean;
  linked: boolean;
  universityId: string | null;
  name: string | null;
}

/**
 * The single front door: Google sign-in first, then the one-time ERP link.
 * After this the backend keeps data fresh — the visitor never sees login
 * forms again.
 */
export function ErpGate({ onLinked }: { onLinked: (snap: SnapshotData) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(true);
  const [decodeState, setDecodeState] = useState<DecodeState>('idle');
  const [solverAvailable, setSolverAvailable] = useState<boolean | null>(null);
  const [universityId, setUniversityId] = useState('');
  const [password, setPassword] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(api('/api/me'))
      .then((r) => r.json())
      .then((d) => setMe(d))
      .catch(() => setMe({ signedIn: false, googleConfigured: false, linked: false, universityId: null, name: null }));
  }, []);

  const loadManualCaptcha = useCallback(async () => {
    const res = await fetch(api('/api/erp/captcha'));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Could not load the captcha.');
    setCaptchaImage(data.captchaImage);
    setSessionToken(data.sessionToken);
    setCaptchaText('');
  }, []);

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setError(null);
    setDecodeState('idle');
    if (decodeTimer.current) clearTimeout(decodeTimer.current);
    try {
      const auto = await fetch(api('/api/erp/auto-captcha'));
      if (auto.ok) {
        const data = await auto.json();
        setSolverAvailable(true);
        setCaptchaImage(data.image);
        setSessionToken(data.sessionToken);
        setCaptchaText('');
        setDecodeState('decoding');
        decodeTimer.current = setTimeout(() => {
          setCaptchaText(data.solution ?? '');
          setDecodeState('filled');
        }, 900);
      } else if (auto.status === 501) {
        setSolverAvailable(false);
        setDecodeState('manual');
        await loadManualCaptcha();
      } else {
        const data = await auto.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Auto-decode failed.');
      }
    } catch {
      setSolverAvailable(false);
      setDecodeState('manual');
      try {
        await loadManualCaptcha();
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : 'Could not reach the ERP.');
      }
    } finally {
      setCaptchaLoading(false);
    }
  }, [loadManualCaptcha]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCaptcha();
    return () => {
      if (decodeTimer.current) clearTimeout(decodeTimer.current);
    };
  }, [loadCaptcha]);

  async function handleLink(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api('/api/erp/link-and-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universityId, password, captchaText, sessionToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === 'bad_captcha' || data.code === 'captcha_expired') loadCaptcha();
        throw new Error(data.error ?? 'Link failed.');
      }
      setPassword('');
      onLinked(data.data as SnapshotData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-10">
      <SectionHeader
        kicker="Link-up"
        title="Connect your ERP"
        sub="Sign in with Google, link your KL University login once — then everything stays fresh on its own."
      />
      <GlassPanel className="p-6 sm:p-8">
        {!me ? (
          <p className="text-center text-sm text-slate-500">Warming up…</p>
        ) : !me.signedIn ? (
          <div>
            <Button onClick={() => signIn('google', { callbackUrl: '/' })} className="w-full py-3">
              Continue with Google
            </Button>
            <p className="mt-3 text-center text-xs text-slate-500">
              Your ERP login gets remembered against your Google account — sealed, never in plaintext.
            </p>
          </div>
        ) : (
          <form onSubmit={handleLink} className="flex flex-col gap-5">
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm text-slate-300">
              Signed in as <span className="font-semibold text-white">{me.name ?? 'you'}</span> — link
              your ERP below. The backend re-syncs every 10 minutes after this.
            </p>
            <Field label="University ID" htmlFor="uid">
              <input
                id="uid"
                className={inputClass}
                value={universityId}
                onChange={(e) => setUniversityId(e.target.value)}
                placeholder="e.g. 25XXXXXXX"
                autoComplete="username"
                required
              />
            </Field>
            <Field label="ERP password" htmlFor="pwd">
              <input
                id="pwd"
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your ERP password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="Captcha">
              <div className="flex items-center gap-3">
                <div className="relative flex h-16 w-44 items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-black/30">
                  {captchaLoading ? (
                    <span className="text-xs text-slate-500">Loading…</span>
                  ) : captchaImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={captchaImage} alt="ERP captcha" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs text-slate-500">Unavailable</span>
                  )}
                  <AnimatePresence>
                    {decodeState === 'decoding' && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center bg-[#0A0A0B]/80 backdrop-blur-sm"
                      >
                        <span className="decoding text-xs font-bold text-[#E9A13B]">Decoding</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={loadCaptcha}
                    className="text-xs font-bold text-[#E9A13B] hover:brightness-110 hover:underline"
                  >
                    ↻ New captcha
                  </button>
                  {solverAvailable && <Chip tone="amber" className="text-[10px]">Auto-decode on</Chip>}
                </div>
              </div>
              <input
                className={`${inputClass} mt-2.5`}
                value={captchaText}
                onChange={(e) => {
                  setCaptchaText(e.target.value);
                  if (decodeState === 'filled') setDecodeState('manual');
                }}
                placeholder={decodeState === 'filled' ? 'Decoded — edit if it looks wrong' : 'Type the letters above'}
                autoComplete="off"
                required
              />
            </Field>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm font-medium text-rose-200"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <Button type="submit" disabled={busy || captchaLoading || !sessionToken} className="w-full py-3">
              {busy ? 'Linking & pulling…' : 'Link & pull →'}
            </Button>
            <p className="text-xs leading-relaxed text-slate-500">
              <b className="text-slate-300">Private by design:</b> your password only logs you in —
              it&apos;s sealed (AES-256-GCM) against your Google account, never stored in plaintext.
            </p>
          </form>
        )}
      </GlassPanel>
    </div>
  );
}
