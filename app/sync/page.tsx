'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { usePlanner, type TermInfo } from '@/components/data-context';
import { Button, Card, Container, SectionTitle, inputClass } from '@/components/ui';
import { cn } from '@/components/cn';

type TermOption = TermInfo;

function defaultTerm(): TermInfo {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  // Odd sem ~Jul–Dec, even sem ~Jan–Jun.
  const odd = m >= 7;
  return {
    academicyear: odd ? `${y}-${y + 1}` : `${y - 1}-${y}`,
    semesterid: odd ? '1' : '2',
    semester: odd ? 'Odd Sem' : 'Even Sem',
  };
}

export default function SyncPage() {
  const router = useRouter();
  const { loadErpData, loadSample, ready } = usePlanner();

  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(true);
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

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/erp/captcha');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load the captcha.');
      setCaptchaImage(data.captchaImage);
      setSessionToken(data.sessionToken);
      setCaptchaText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the ERP.');
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    // Data fetch on mount — the canonical exception to no-setState-in-effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCaptcha();
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
        throw new Error(att.error ?? 'Could not fetch attendance.');
      }
      if (!ttRes.ok) throw new Error(tt.error ?? 'Could not fetch the timetable.');
      const subjects = att.subjects ?? [];
      const days = tt.days ?? [];
      loadErpData(subjects, days, term);
      // Persist a MongoDB snapshot: attendance + timetable only — never the password.
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
          setSnapshotMsg(snap.error ?? 'Could not save to MongoDB.');
        }
      } catch {
        setSnapshotMsg('Could not reach the snapshot API.');
      }
      setFetched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
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

  if (!ready) return <Container className="py-10"><p className="text-sm text-neutral-500">Loading…</p></Container>;

  return (
    <Container className="max-w-2xl py-10">
      <SectionTitle eyebrow="Sync" title="Sync with the ERP" />

      {!loggedIn ? (
        <Card className="animate-rise p-6">
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-semibold" htmlFor="uid">University ID</label>
              <input
                id="uid"
                className={inputClass}
                value={universityId}
                onChange={(e) => setUniversityId(e.target.value)}
                placeholder="e.g. 25XXXXXXX"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold" htmlFor="pwd">ERP password</label>
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
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">Captcha</label>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-40 items-center justify-center overflow-hidden rounded-lg border border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                  {captchaLoading ? (
                    <span className="text-xs text-neutral-400">Loading…</span>
                  ) : captchaImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={captchaImage} alt="ERP captcha" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs text-neutral-400">Unavailable</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={loadCaptcha}
                  className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  New captcha
                </button>
              </div>
              <input
                className={cn(inputClass, 'mt-2')}
                value={captchaText}
                onChange={(e) => setCaptchaText(e.target.value)}
                placeholder="Type the letters above"
                autoComplete="off"
                required
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                You solve the captcha — it&apos;s the ERP&apos;s own captcha, passed straight through.
              </p>
            </div>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy || captchaLoading || !sessionToken} className="w-full">
              {busy ? 'Logging in…' : 'Log in and sync'}
            </Button>
          </form>

          <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              <b className="text-neutral-700 dark:text-neutral-300">Privacy:</b> your password is used
              only to log in to the ERP and is never stored. Synced data stays in your browser
              (localStorage); only an encrypted session cookie lives on the server.
            </p>
            <Button variant="secondary" className="mt-3 w-full" onClick={() => { loadSample(); router.push('/'); }}>
              Try it with sample data
            </Button>
            <Button variant="secondary" className="mt-2 w-full" onClick={handleRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Restore last synced snapshot'}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="animate-rise p-6">
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">[SYNCED] You&apos;re in.</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Pick a term, then fetch your attendance and timetable.
          </p>
          {termOptions.length > 0 ? (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-semibold" htmlFor="term">Term</label>
              <select
                id="term"
                className={inputClass}
                value={termIdx}
                onChange={(e) => setTermIdx(Number(e.target.value))}
              >
                {termOptions.map((t, i) => (
                  <option key={`${t.academicyear}-${t.semesterid}-${i}`} value={i}>
                    {t.academicyear} · {t.semester || `Sem ${t.semesterid}`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
              Using {term.academicyear} · {term.semester} (no term list found on the ERP page).
            </p>
          )}
          {error && (
            <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={handleFetch} disabled={fetching} className="flex-1">
              {fetching ? 'Fetching…' : 'Fetch my data'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => { setLoggedIn(false); loadCaptcha(); }}
              disabled={fetching}
            >
              Log in again
            </Button>
          </div>
          {snapshotMsg === 'ok' && savedAt && (
            <p className="mt-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Saved to MongoDB ✓ {savedAt}
            </p>
          )}
          {snapshotMsg && snapshotMsg !== 'ok' && (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
              MongoDB snapshot skipped: {snapshotMsg}
            </p>
          )}
          {fetched && (
            <Button onClick={() => router.push('/')} className="mt-4 w-full">
              Open my week →
            </Button>
          )}
        </Card>
      )}
    </Container>
  );
}
