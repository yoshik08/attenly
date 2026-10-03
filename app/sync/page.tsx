'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlanner, type TermInfo } from '@/components/data-context';
import { Button, Chip, Container, Field, GlassPanel, SectionHeader, inputClass } from '@/components/ui';

type TermOption = TermInfo;

function defaultTerm(): TermInfo {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const odd = m >= 7;
  return {
    academicyear: odd ? `${y}-${y + 1}` : `${y - 1}-${y}`,
    semesterid: odd ? '1' : '2',
    semester: odd ? 'Odd Sem' : 'Even Sem',
  };
}

type DecodeState = 'idle' | 'decoding' | 'filled' | 'manual';

export default function SyncPage() {
  const router = useRouter();
  const { loadErpData, loadSample, ready } = usePlanner();

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
  const [loggedIn, setLoggedIn] = useState(false);
  const [termOptions, setTermOptions] = useState<TermOption[]>([]);
  const [termIdx, setTermIdx] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const decodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadManualCaptcha = useCallback(async () => {
    const res = await fetch('/api/erp/captcha');
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
      // Prefer the auto-decoder when a solver is configured; it 501s otherwise.
      const auto = await fetch('/api/erp/auto-captcha');
      if (auto.ok) {
        const data = await auto.json();
        setSolverAvailable(true);
        setCaptchaImage(data.image);
        setSessionToken(data.sessionToken);
        setCaptchaText('');
        setDecodeState('decoding');
        // Brief beat so the "decoding" shimmer reads, then fill the field.
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
    } catch (e) {
      // Any failure → quiet fallback to the manual captcha.
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
    // Data fetch on mount — the canonical exception to no-setState-in-effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCaptcha();
    return () => {
      if (decodeTimer.current) clearTimeout(decodeTimer.current);
    };
  }, [loadCaptcha]);

  const term: TermInfo =
    termOptions.length > 0 ? termOptions[Math.min(termIdx, termOptions.length - 1)] : defaultTerm();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/erp/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universityId, password, captchaText, sessionToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? 'Login failed.');
      }
      setPassword(''); // drop the password from memory immediately
      setLoggedIn(true);
      const opts: TermOption[] = data.termOptions ?? [];
      setTermOptions(opts);
      setTermIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed.');
      loadCaptcha(); // captcha is single-use — always refresh after an attempt
    } finally {
      setBusy(false);
    }
  }

  async function handleFetch() {
    setFetching(true);
    setError(null);
    setSnapshotMsg(null);
    setSavedAt(null);
    try {
      const q = new URLSearchParams({
        academicyear: term.academicyear,
        semesterid: term.semesterid,
        semester: term.semester,
      }).toString();
      const [attRes, ttRes] = await Promise.all([
        fetch(`/api/erp/attendance?${q}`),
        fetch(`/api/erp/timetable?${q}`),
      ]);
      const att = await attRes.json();
      const tt = await ttRes.json();
      if (!attRes.ok) {
        if (att.code === 'session_expired') {
          setLoggedIn(false);
          loadCaptcha();
        }
        throw new Error(att.error ?? 'Could not fetch scores.');
      }
      if (!ttRes.ok) throw new Error(tt.error ?? 'Could not fetch the timetable.');
      const subjects = att.subjects ?? [];
      const days = tt.days ?? [];
      loadErpData(subjects, days, term);
      // Stash a MongoDB snapshot: scores + timetable only — never the password.
      try {
        const snapRes = await fetch('/api/snapshots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ universityId, term, attendance: subjects, timetable: days }),
        });
        const snap = await snapRes.json();
        if (snapRes.ok && snap.ok) {
          setSavedAt(
            new Date(snap.savedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          );
          setSnapshotMsg('ok');
        } else {
          setSnapshotMsg(snap.error ?? 'Could not stash in MongoDB.');
        }
      } catch {
        setSnapshotMsg('Could not reach the snapshot API.');
      }
      setFetched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pull failed.');
    } finally {
      setFetching(false);
    }
  }

  async function handleRestore() {
    const id = universityId.trim();
    if (!id) {
      setError('Enter your University ID first.');
      return;
    }
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/snapshots?universityId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'No snapshot found.');
      const s = data.snapshot;
      loadErpData(s.attendance ?? [], s.timetable ?? [], s.term ?? defaultTerm());
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  }

  if (!ready)
    return (
      <Container className="py-10">
        <p className="text-sm text-slate-500">Warming up…</p>
      </Container>
    );

  return (
    <Container className="max-w-2xl py-8">
      <SectionHeader
        kicker="Link-up"
        title="Connect your ERP"
        sub="One login pulls your timetable and scores straight from the KL University portal."
      />

      {!loggedIn ? (
        <GlassPanel className="p-6 sm:p-8">
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
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
                        className="absolute inset-0 flex items-center justify-center bg-[#060714]/80 backdrop-blur-sm"
                      >
                        <span className="decoding text-xs font-bold text-cyan-200">Decoding</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={loadCaptcha}
                    className="text-xs font-bold text-cyan-300 hover:text-cyan-200 hover:underline"
                  >
                    ↻ New captcha
                  </button>
                  {solverAvailable && (
                    <Chip tone="cyan" className="text-[10px]">Auto-decode on</Chip>
                  )}
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
              <p className="mt-1.5 text-xs text-slate-500">
                {solverAvailable
                  ? 'We take a crack at the captcha for you — fix it by hand if it misreads.'
                  : 'Straight from the ERP — type what you see.'}
              </p>
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
              {busy ? 'Linking…' : 'Link & pull →'}
            </Button>
          </form>

          <div className="mt-7 border-t border-white/[0.08] pt-5">
            <p className="text-xs leading-relaxed text-slate-500">
              <b className="text-slate-300">Private by design:</b> your password only logs you in —
              it&apos;s never stored anywhere. Synced scores live in this browser; only an encrypted
              session cookie sits on the server.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="glass" className="w-full" onClick={() => { loadSample(); router.push('/'); }}>
                Take the sample orbit instead
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleRestore} disabled={restoring}>
                {restoring ? 'Picking up…' : 'Pick up where you left off'}
              </Button>
            </div>
          </div>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-300/15 text-xl"
            >
              ✓
            </motion.span>
            <div>
              <p className="font-display text-lg font-bold text-white">You&apos;re linked.</p>
              <p className="text-sm text-slate-400">Pick a term, then pull your data.</p>
            </div>
          </div>

          {termOptions.length > 0 ? (
            <div className="mt-5">
              <Field label="Term" htmlFor="term">
                <select
                  id="term"
                  className={`${inputClass} appearance-none`}
                  value={termIdx}
                  onChange={(e) => setTermIdx(Number(e.target.value))}
                >
                  {termOptions.map((t, i) => (
                    <option key={`${t.academicyear}-${t.semesterid}-${i}`} value={i} className="bg-[#0a0c1d]">
                      {t.academicyear} · {t.semester || `Sem ${t.semesterid}`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-500">
              Using {term.academicyear} · {term.semester} (no term list found on the ERP page).
            </p>
          )}

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm font-medium text-rose-200"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="mt-5 flex gap-2">
            <Button onClick={handleFetch} disabled={fetching} className="flex-1 py-3">
              {fetching ? 'Pulling…' : '↓ Pull my data'}
            </Button>
            <Button
              variant="glass"
              onClick={() => { setLoggedIn(false); loadCaptcha(); }}
              disabled={fetching}
            >
              Relink
            </Button>
          </div>

          {snapshotMsg === 'ok' && savedAt && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 text-sm font-bold text-lime-200"
            >
              ✓ Snapshot stashed in MongoDB · {savedAt}
            </motion.p>
          )}
          {snapshotMsg && snapshotMsg !== 'ok' && (
            <p className="mt-4 text-sm text-amber-200/80">
              MongoDB stash skipped: {snapshotMsg}
            </p>
          )}
          {fetched && (
            <Button onClick={() => router.push('/')} className="mt-5 w-full py-3">
              Open my game plan →
            </Button>
          )}
        </GlassPanel>
      )}
    </Container>
  );
}
