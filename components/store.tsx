'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { signOut as nextAuthSignOut } from 'next-auth/react';
import { api, BASE_PATH } from '@/lib/api';
import {
  DEFAULT_TCBR,
  DEFAULT_TARGET,
  DEFAULT_WEIGHTS,
  type Target,
  type TcbrSettings,
  type Weights,
} from '@/lib/math';
import type { ClientSnapshot } from '@/lib/db/snapshots';
import type { AccountView } from '@/lib/db/users';
import type { Dataset } from '@/lib/erp/full-sync';
import { countsOf, type SeenCounts } from '@/lib/insights';
import { keepFailed } from '@/lib/local-snapshot';
import { localAccountView, localPost, patchLocalAccount, readLocalAccount, writeLocalAccount, type LocalAccount } from './local';

/**
 * A freshly linked account, from the link form. `local` is set when the person signed
 * in without Google: their sealed login and ERP session, and the datasets that failed.
 */
export interface Linked {
  universityId: string;
  snapshot: ClientSnapshot;
  local?: { key: string; erp: string | null; failed: Dataset[] };
}

export interface Settings {
  /** The one global target attendance (75 or 85). */
  target: Target;
  weights: Weights;
  tcbr: TcbrSettings;
}

export interface SyncState {
  running: boolean;
  mode: 'auto' | 'force' | null;
  /** Result code of the last attempt ('synced', 'fresh', 'bad_captcha', …). */
  code: string | null;
  message: string | null;
  at: number | null;
}

type Phase = 'boot' | 'signed-out' | 'ready' | 'error';

interface StoreState {
  phase: Phase;
  /**
   * Signed in without Google: the account and its data live in this browser only
   * (components/local.ts), and it re-syncs quietly every five minutes while a tab is open.
   */
  local: boolean;
  googleConfigured: boolean;
  user: { name: string | null; email: string | null; image: string | null } | null;
  accounts: AccountView[];
  active: string | null;
  snapshot: ClientSnapshot | null;
  freshMs: number;
  /** serverNow − Date.now(), so staleness doesn't depend on the phone's clock. */
  skew: number;
  loadError: string | null;
  sync: SyncState;
  /** The last day attendance is taken (YYYY-MM-DD), or null for month end. */
  lastInstructionDay: string | null;
}

interface StoreValue extends StoreState {
  settings: Settings;
  activeAccount: AccountView | null;
  /** The cached counts the person last looked at, for change badges. */
  seen: SeenCounts | null;
  stale: boolean;
  refresh: () => Promise<void>;
  forceSync: () => Promise<void>;
  switchAccount: (universityId: string) => Promise<void>;
  onLinked: (linked: Linked) => Promise<void>;
  removeAccount: (universityId: string) => Promise<{ ok: boolean; error?: string }>;
  makePrimary: (universityId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Sync a specific year and semester (ERP ids) for the shown account, or null for automatic. */
  setTerm: (term: { academicyear: string; semesterid: string } | null) => Promise<{ ok: boolean; error?: string }>;
  updateSettings: (patch: Partial<Settings>) => void;
  /** Save the Forecast window's end date (null = forecast to month end). */
  setLastInstructionDay: (day: string | null) => Promise<{ ok: boolean; error?: string }>;
  markSeen: (code?: string) => void;
  clearDevice: () => void;
  signOut: () => Promise<void>;
}

const SETTINGS_KEY = 'attenly:settings:v2';
const LEGACY_KEY = 'skipwise:v1';
const ACTIVE_KEY = 'attenly-active-account';
const CACHE_KEY = 'attenly:cache:v2';
const SEEN_KEY = 'attenly:seen:v1';
const AUTO_RETRY_MS = 3 * 60 * 1000;
/** Signed in without Google, an open tab (shown or hidden) re-syncs when its data is this old. */
export const LOCAL_AUTO_MS = 5 * 60 * 1000;
/** When a tab of this browser last started a quiet sync, so two open tabs don't both pull. */
const LOCAL_AUTO_CLAIM = 'attenly:local:auto';

const DEFAULT_SETTINGS: Settings = { target: DEFAULT_TARGET, weights: DEFAULT_WEIGHTS, tcbr: DEFAULT_TCBR };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
/** The active account id is a raw string (as the previous version stored it), not JSON. */
function readActive(): string | null {
  try {
    const v = localStorage.getItem(ACTIVE_KEY);
    return v && /^[A-Za-z0-9]+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app still works, it just won't remember */
  }
}

/** On-demand ERP sets this device keeps (components/records.tsx): dropped with the rest of the device's data. */
/** The term the account signed in without Google syncs ('' for automatic). */
function termOfLocal(): string {
  return JSON.stringify(readLocalAccount()?.term ?? '');
}

function clearRecordCopies() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('attenly:rec:')) localStorage.removeItem(k);
    }
  } catch {
    /* storage blocked: nothing was kept */
  }
}

function loadSettings(): Settings {
  // v2 stored a safeAt / condonationFrom pair; carry it over as the one target.
  const s =
    read<Partial<Settings> & { thresholds?: { safeAt?: number } }>(SETTINGS_KEY) ??
    read<{ settings?: Partial<Settings> & { thresholds?: { safeAt?: number } } }>(LEGACY_KEY)?.settings ??
    null;
  if (!s) return DEFAULT_SETTINGS;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const stored = s.target ?? (typeof s.thresholds?.safeAt === 'number' && s.thresholds.safeAt < 80 ? 75 : undefined);
  return {
    target: stored === 75 ? 75 : stored === 85 ? 85 : DEFAULT_TARGET,
    weights: {
      L: num(s.weights?.L, DEFAULT_WEIGHTS.L),
      T: num(s.weights?.T, DEFAULT_WEIGHTS.T),
      P: num(s.weights?.P, DEFAULT_WEIGHTS.P),
      S: num(s.weights?.S, DEFAULT_WEIGHTS.S),
    },
    tcbr: {
      enabled: Boolean(s.tcbr?.enabled),
      perCourse: s.tcbr?.perCourse && typeof s.tcbr.perCourse === 'object' ? s.tcbr.perCourse : {},
    },
  };
}

interface CacheShape {
  user: StoreState['user'];
  accounts: AccountView[];
  snapshots: Record<string, ClientSnapshot>;
  lastInstructionDay?: string | null;
}

/** What /api/data answered: the body is the route's JSON, read field by field below. */
type Loaded = { ok: boolean; d: Awaited<ReturnType<Response['json']>> };

declare global {
  interface Window {
    /** Set by the inline script in app/layout.tsx: /api/data, requested before hydration. */
    __attenlyEarly?: { account: string | null; at: number; res: Promise<Loaded> };
  }
}

/**
 * The /api/data response the page started fetching while it parsed, if it is for this
 * account and recent. Taken once: every later load goes to the network.
 */
function takeEarlyData(account: string | null): Promise<Loaded> | null {
  if (typeof window === 'undefined') return null;
  const early = window.__attenlyEarly;
  window.__attenlyEarly = undefined;
  if (!early || early.account !== account || Date.now() - early.at > 15_000) return null;
  return early.res;
}

const IDLE_SYNC: SyncState = { running: false, mode: null, code: null, message: null, at: null };

const StoreContext = createContext<StoreValue | null>(null);

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>({
    phase: 'boot',
    local: false,
    googleConfigured: true,
    user: null,
    accounts: [],
    active: null,
    snapshot: null,
    freshMs: 330_000,
    skew: 0,
    loadError: null,
    sync: IDLE_SYNC,
    lastInstructionDay: null,
  });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [seenAll, setSeenAll] = useState<Record<string, SeenCounts>>({});
  const [clockNow, setClockNow] = useState(0);
  useEffect(() => {
    const tick = () => setClockNow(Date.now());
    const iv = window.setInterval(tick, 30_000);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(first);
    };
  }, []);
  const stateRef = useRef(state);
  const syncing = useRef(false);
  /** The running sync, and whether the person can see it (false for a quiet background one). */
  const inflight = useRef<{ done: Promise<void>; term: string } | null>(null);
  const shown = useRef(false);
  const lastAuto = useRef<Record<string, number>>({});
  useEffect(() => {
    stateRef.current = state;
  });

  /** The first counts shown for an account become the baseline for change badges. */
  const ensureSeen = useCallback((universityId: string | null, snapshot: ClientSnapshot | null) => {
    if (!universityId || !snapshot) return;
    setSeenAll((all) => {
      if (all[universityId]) return all;
      const next = { ...all, [universityId]: countsOf(snapshot.attendance) };
      write(SEEN_KEY, next);
      return next;
    });
  }, []);

  const persistSnapshot = useCallback((universityId: string, snapshot: ClientSnapshot | null) => {
    const cache = read<CacheShape>(CACHE_KEY) ?? { user: null, accounts: [], snapshots: {} };
    if (snapshot) cache.snapshots[universityId] = snapshot;
    else delete cache.snapshots[universityId];
    write(CACHE_KEY, cache);
  }, []);

  /** Shows the account this browser signed in without Google; never asks the server. */
  const enterLocal = useCallback(
    (a: LocalAccount, sync?: SyncState) => {
      ensureSeen(a.universityId, a.snapshot);
      setState((s) => ({
        ...s,
        phase: 'ready',
        local: true,
        user: { name: null, email: null, image: null },
        accounts: [localAccountView(a)],
        active: a.universityId,
        snapshot: a.snapshot,
        lastInstructionDay: a.lastInstructionDay,
        loadError: null,
        sync: sync ?? s.sync,
      }));
    },
    [ensureSeen],
  );

  const load = useCallback(
    async (account?: string | null) => {
      // Signed in without Google: this browser holds everything, so there is nothing to fetch.
      const loc = readLocalAccount();
      if (loc) {
        enterLocal(loc);
        return;
      }
      const wanted = account ?? readActive() ?? null;
      try {
        // The response started before hydration if it is there; a failed early request is
        // simply made again.
        const early = takeEarlyData(wanted);
        let got: Loaded | null = early ? await early.catch(() => null) : null;
        if (!got) {
          const r = await fetch(api(`/api/data${wanted ? `?account=${encodeURIComponent(wanted)}` : ''}`), { cache: 'no-store' });
          got = { ok: r.ok, d: await r.json() };
        }
        const { ok, d } = got;
        if (!d.signedIn) {
          write(CACHE_KEY, null);
          setState((s) => ({ ...s, phase: 'signed-out', local: false, googleConfigured: d.googleConfigured !== false, user: null, accounts: [], active: null, snapshot: null, loadError: null }));
          return;
        }
        if (!ok) {
          setState((s) => ({ ...s, phase: s.snapshot ? 'ready' : 'error', loadError: d.error ?? 'Attenly can’t load your data right now.' }));
          return;
        }
        const active: string | null = d.active ?? null;
        if (active) write(ACTIVE_KEY, active);
        const cache = read<CacheShape>(CACHE_KEY) ?? { user: null, accounts: [], snapshots: {} };
        cache.user = d.user;
        cache.accounts = d.accounts;
        cache.lastInstructionDay = d.lastInstructionDay ?? null;
        if (active && d.snapshot) cache.snapshots[active] = d.snapshot;
        write(CACHE_KEY, cache);
        ensureSeen(active, d.snapshot ?? (active ? (cache.snapshots[active] ?? null) : null));
        setState((s) => ({
          ...s,
          phase: 'ready',
          local: false,
          user: d.user,
          accounts: d.accounts ?? [],
          active,
          snapshot: d.snapshot ?? (active ? (cache.snapshots[active] ?? null) : null),
          lastInstructionDay: d.lastInstructionDay ?? null,
          freshMs: typeof d.freshMs === 'number' ? d.freshMs : s.freshMs,
          skew: typeof d.serverNow === 'number' ? d.serverNow - Date.now() : 0,
          loadError: null,
        }));
      } catch {
        setState((s) => ({ ...s, phase: s.snapshot ? 'ready' : 'error', loadError: 'You look offline. Showing what this device last saw.' }));
      }
    },
    [ensureSeen, enterLocal],
  );

  // Boot: settings, cached data for an instant first paint, then the network. A layout
  // effect, so the cached screen replaces the skeleton before the browser paints again.
  useIso(() => {
    // localStorage only exists after hydration; reading it during render would
    // make the first client render differ from the server HTML.
    setSettings(loadSettings());
    const seenStored = read<Record<string, SeenCounts>>(SEEN_KEY) ?? {};
    setSeenAll(seenStored);
    const loc = readLocalAccount();
    if (loc) {
      enterLocal(loc);
      return;
    }
    const cache = read<CacheShape>(CACHE_KEY);
    const active = readActive();
    const cachedId = active && cache?.snapshots[active] ? active : (cache?.accounts[0]?.universityId ?? null);
    if (cache?.user && cachedId) {
      ensureSeen(cachedId, cache.snapshots[cachedId] ?? null);
      setState((s) => ({
        ...s,
        phase: 'ready',
        user: cache.user,
        accounts: cache.accounts,
        active: cachedId,
        snapshot: cache.snapshots[cachedId] ?? null,
        lastInstructionDay: cache.lastInstructionDay ?? null,
      }));
    }
    void load(active);
  }, [load, ensureSeen, enterLocal]);

  /**
   * A sync for the account signed in without Google: the server opens the sealed login,
   * pulls from the ERP and keeps nothing; this browser keeps the result, carrying over
   * whatever failed this time from its own last copy.
   */
  const runLocalSync = useCallback(async (mode: 'auto' | 'force', quiet: () => boolean) => {
    const loc = readLocalAccount();
    if (!loc) {
      // The browser didn't keep the login (storage blocked or cleared): only signing in again helps.
      const message = 'This browser didn’t keep your login. Sign out and sign in again.';
      setState((p) => ({ ...p, sync: { running: false, mode, code: 'needs_password', message, at: Date.now() } }));
      return;
    }
    const prev = loc.snapshot;
    try {
      const res = await localPost('/api/local/sync', {
        term: loc.term,
        reuse: prev && prev.attendance.length > 0 ? { academicyear: prev.term.academicyear, semesterid: prev.term.semesterid } : null,
      });
      const d = await res.json().catch(() => ({}));
      const code: string = d.code ?? (res.ok ? 'synced' : 'failed');
      if (stateRef.current.active !== loc.universityId) return; // signed out meanwhile
      if (d.ok && d.snapshot) {
        const snapshot = keepFailed(prev, d.snapshot as ClientSnapshot, Array.isArray(d.failed) ? d.failed : []);
        const next = patchLocalAccount({ snapshot, needsPassword: false, lastError: null });
        setState((p) => ({
          ...p,
          snapshot,
          accounts: next ? [localAccountView(next)] : p.accounts,
          sync: { running: false, mode, code, message: null, at: Date.now() },
        }));
        return;
      }
      const message: string = d.error ?? 'The sync didn’t finish. Try again.';
      const lastError = { code, message, at: new Date().toISOString() };
      const rejected = code === 'needs_password' || code === 'bad_credentials';
      // A quiet sync that hit a passing problem (captcha, slow ERP) stays quiet and
      // tries again later; only a rejected password is worth interrupting for.
      if (!rejected && quiet()) return;
      const next = patchLocalAccount(rejected ? { needsPassword: true, lastError } : { lastError });
      setState((p) => ({
        ...p,
        accounts: next ? [localAccountView(next)] : p.accounts,
        sync: { running: false, mode, code, message, at: Date.now() },
      }));
    } catch {
      if (quiet()) return;
      setState((p) => ({ ...p, sync: { running: false, mode, code: 'offline', message: 'You look offline. Try again when you’re back online.', at: Date.now() } }));
    }
  }, []);

  const runSync = useCallback(
    async (mode: 'auto' | 'force') => {
      let s = stateRef.current;
      const id = s.active;
      if (!id) return;
      if (syncing.current) {
        // Sync now (or a new term) while a quiet background sync runs: show that one,
        // and pull again after it only if it was for a different term.
        const run = inflight.current;
        if (mode !== 'force' || !s.local || !run || shown.current) return;
        shown.current = true;
        setState((p) => ({ ...p, sync: { ...p.sync, running: true, mode } }));
        await run.done;
        if (termOfLocal() === run.term || syncing.current) return;
        s = stateRef.current;
      }
      syncing.current = true;
      const quiet = s.local && mode === 'auto';
      shown.current = !quiet;
      if (!quiet) setState((p) => ({ ...p, sync: { ...p.sync, running: true, mode } }));
      if (s.local) {
        const done = runLocalSync(mode, () => !shown.current);
        inflight.current = { done, term: termOfLocal() };
        try {
          await done;
        } finally {
          syncing.current = false;
          inflight.current = null;
        }
        return;
      }
      try {
        const res = await fetch(api('/api/erp/hard-sync'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ universityId: id, mode }),
        });
        const d = await res.json().catch(() => ({}));
        const code: string = d.code ?? (res.ok ? 'synced' : 'failed');
        if (stateRef.current.active !== id) return; // switched accounts meanwhile
        if (d.snapshot) persistSnapshot(id, d.snapshot);
        setState((p) => ({
          ...p,
          snapshot: d.snapshot ?? p.snapshot,
          sync: { running: false, mode, code, message: d.ok ? null : (d.error ?? 'The sync didn’t finish. Try again.'), at: Date.now() },
          accounts:
            code === 'needs_password' || code === 'bad_credentials'
              ? p.accounts.map((a) => (a.universityId === id ? { ...a, needsPassword: true, lastError: { code, message: d.error ?? '', at: new Date().toISOString() } } : a))
              : d.ok
                ? p.accounts.map((a) => (a.universityId === id ? { ...a, needsPassword: false, lastError: null, lastSyncAt: d.snapshot?.syncedAt ?? a.lastSyncAt } : a))
                : p.accounts,
        }));
      } catch {
        setState((p) => ({ ...p, sync: { running: false, mode, code: 'offline', message: 'You look offline. The sync will retry.', at: Date.now() } }));
      } finally {
        syncing.current = false;
      }
    },
    [persistSnapshot, runLocalSync],
  );

  const activeAccount = useMemo(
    () => state.accounts.find((a) => a.universityId === state.active) ?? null,
    [state.accounts, state.active],
  );

  const ageOf = useCallback(
    (snap: ClientSnapshot | null) => (snap ? Date.now() + stateRef.current.skew - new Date(snap.syncedAt).getTime() : Infinity),
    [],
  );

  // Auto-sync: whenever this tab is visible and the cloud data is older than
  // ~5.5 minutes, quietly ask the server to re-sync (it re-checks freshness).
  // Signed in without Google there's an effect of its own below.
  useEffect(() => {
    if (state.phase !== 'ready' || !state.active || state.local) return;
    const tick = () => {
      const s = stateRef.current;
      const acc = s.accounts.find((a) => a.universityId === s.active);
      if (!acc || acc.needsPassword || syncing.current || document.visibilityState !== 'visible') return;
      if (ageOf(s.snapshot) < s.freshMs) return;
      const last = lastAuto.current[acc.universityId] ?? 0;
      if (Date.now() - last < AUTO_RETRY_MS) return;
      lastAuto.current[acc.universityId] = Date.now();
      void runSync('auto');
    };
    tick();
    const iv = window.setInterval(tick, 30_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [state.phase, state.active, state.local, state.accounts, ageOf, runSync]);

  // Signed in without Google: while any tab is open, shown or hidden, re-sync quietly
  // once the data in this browser is five minutes old. Hidden tabs have their timers
  // slowed to about once a minute, which this cadence doesn't mind; a phone that froze
  // the tab catches up the moment it's shown again. Tabs of one browser share the
  // stored copy, so only one of them pulls.
  useEffect(() => {
    if (state.phase !== 'ready' || !state.active || !state.local) return;
    const tick = () => {
      const s = stateRef.current;
      if (syncing.current || !navigator.onLine) return;
      const loc = readLocalAccount();
      if (!loc || loc.universityId !== s.active || loc.needsPassword) return;
      // Another tab may have synced meanwhile: show its copy instead of pulling again.
      const stored = loc.snapshot ? new Date(loc.snapshot.syncedAt).getTime() : 0;
      if (stored > (s.snapshot ? new Date(s.snapshot.syncedAt).getTime() : 0)) {
        setState((p) => ({ ...p, snapshot: loc.snapshot, accounts: [localAccountView(loc)] }));
      }
      if (ageOf(loc.snapshot) < LOCAL_AUTO_MS) return;
      let claimed = 0;
      try {
        claimed = Number(localStorage.getItem(LOCAL_AUTO_CLAIM)) || 0;
      } catch {}
      const last = Math.max(lastAuto.current[loc.universityId] ?? 0, claimed);
      if (Date.now() - last < AUTO_RETRY_MS) return;
      lastAuto.current[loc.universityId] = Date.now();
      try {
        localStorage.setItem(LOCAL_AUTO_CLAIM, String(Date.now()));
      } catch {}
      void runSync('auto');
    };
    tick();
    const iv = window.setInterval(tick, 15_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [state.phase, state.active, state.local, ageOf, runSync]);

  const forceSync = useCallback(() => runSync('force'), [runSync]);

  const switchAccount = useCallback(
    async (universityId: string) => {
      if (stateRef.current.local) return; // one account per device without Google
      write(ACTIVE_KEY, universityId);
      const cache = read<CacheShape>(CACHE_KEY);
      setState((s) => ({ ...s, active: universityId, snapshot: cache?.snapshots[universityId] ?? null, sync: IDLE_SYNC }));
      await load(universityId);
    },
    [load],
  );

  const onLinked = useCallback(
    async ({ universityId, snapshot, local }: Linked) => {
      const synced: SyncState = { ...IDLE_SYNC, code: 'synced', at: Date.now() };
      if (local) {
        // Signed in without Google. Re-entering the password keeps this device's
        // semester pick and forecast date; someone else signing in here starts fresh.
        const prev = readLocalAccount();
        const same = prev?.universityId === universityId ? prev : null;
        if (prev && !same) clearRecordCopies();
        const account: LocalAccount = {
          universityId,
          key: local.key,
          erp: local.erp,
          term: same?.term ?? null,
          snapshot: keepFailed(same?.snapshot ?? null, snapshot, local.failed),
          lastInstructionDay: same?.lastInstructionDay ?? null,
          needsPassword: false,
          lastError: null,
        };
        writeLocalAccount(account);
        enterLocal(account, synced);
        return;
      }
      write(ACTIVE_KEY, universityId);
      persistSnapshot(universityId, snapshot);
      ensureSeen(universityId, snapshot);
      setState((s) => ({ ...s, active: universityId, snapshot, sync: synced }));
      await load(universityId);
    },
    [load, persistSnapshot, ensureSeen, enterLocal],
  );

  /** Signing out without Google forgets everything this device kept for the account. */
  const signOutLocal = useCallback(async () => {
    writeLocalAccount(null);
    clearRecordCopies();
    setState((s) => ({ ...s, phase: 'signed-out', local: false, user: null, accounts: [], active: null, snapshot: null, lastInstructionDay: null, sync: IDLE_SYNC }));
    // Still signed in with Google in this browser? Then that account shows instead.
    await load(null);
  }, [load]);

  const removeAccount = useCallback(
    async (universityId: string) => {
      if (stateRef.current.local) {
        await signOutLocal();
        return { ok: true };
      }
      try {
        const res = await fetch(api(`/api/erp/accounts?universityId=${encodeURIComponent(universityId)}`), { method: 'DELETE' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: d.error ?? 'Could not remove that account.' };
        persistSnapshot(universityId, null);
        const seen = read<Record<string, SeenCounts>>(SEEN_KEY) ?? {};
        delete seen[universityId];
        write(SEEN_KEY, seen);
        setSeenAll(seen);
        if (readActive() === universityId) write(ACTIVE_KEY, null);
        await load(null);
        return { ok: true };
      } catch {
        return { ok: false, error: 'You look offline. Try again.' };
      }
    },
    [load, persistSnapshot, signOutLocal],
  );

  const makePrimary = useCallback(
    async (universityId: string) => {
      if (stateRef.current.local) return { ok: true }; // the only account is the primary one
      try {
        const res = await fetch(api('/api/erp/accounts'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ universityId, primary: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: d.error ?? 'Could not change the primary account.' };
        await load(stateRef.current.active);
        return { ok: true };
      } catch {
        return { ok: false, error: 'You look offline. Try again.' };
      }
    },
    [load],
  );

  const setTerm = useCallback(
    async (term: { academicyear: string; semesterid: string } | null) => {
      const id = stateRef.current.active;
      if (!id) return { ok: false, error: 'No ERP account is linked yet.' };
      if (stateRef.current.local) {
        const next = patchLocalAccount({ term });
        if (!next) return { ok: false, error: 'This device couldn’t save that.' };
        setState((p) => ({ ...p, accounts: [localAccountView(next)] }));
        await runSync('force');
        return { ok: true };
      }
      try {
        const res = await fetch(api('/api/erp/accounts'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ universityId: id, term }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: d.error ?? 'Could not change the semester.' };
        setState((p) => ({ ...p, accounts: Array.isArray(d.accounts) ? d.accounts : p.accounts }));
        await runSync('force');
        return { ok: true };
      } catch {
        return { ok: false, error: 'You look offline. Try again.' };
      }
    },
    [runSync],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      write(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  /**
   * The Forecast window's end date. Written through to the user's document so it
   * survives reloads, sign-outs and other devices; the local copy is only the
   * cached value for the first paint. Without Google it lives on this device only.
   */
  const setLastInstructionDay = useCallback(async (day: string | null) => {
    const prev = stateRef.current.lastInstructionDay;
    setState((s) => ({ ...s, lastInstructionDay: day }));
    if (stateRef.current.local) {
      if (patchLocalAccount({ lastInstructionDay: day })) return { ok: true };
      setState((s) => ({ ...s, lastInstructionDay: prev }));
      return { ok: false, error: 'This device couldn’t save that date.' };
    }
    try {
      const res = await fetch(api('/api/prefs'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastInstructionDay: day }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState((s) => ({ ...s, lastInstructionDay: prev }));
        return { ok: false, error: d.error ?? 'Could not save that date.' };
      }
      const cache = read<CacheShape>(CACHE_KEY);
      if (cache) {
        cache.lastInstructionDay = day;
        write(CACHE_KEY, cache);
      }
      return { ok: true };
    } catch {
      setState((s) => ({ ...s, lastInstructionDay: prev }));
      return { ok: false, error: 'You look offline. Try again.' };
    }
  }, []);

  const seen = state.active ? (seenAll[state.active] ?? null) : null;

  const markSeen = useCallback(
    (code?: string) => {
      const s = stateRef.current;
      if (!s.active || !s.snapshot) return;
      setSeenAll((all) => {
        const current = countsOf(s.snapshot!.attendance);
        const prev = all[s.active!] ?? {};
        const merged = code ? { ...prev, [code]: current[code] ?? {} } : current;
        const next = { ...all, [s.active!]: merged };
        write(SEEN_KEY, next);
        return next;
      });
    },
    [],
  );

  const clearDevice = useCallback(() => {
    for (const k of [CACHE_KEY, SEEN_KEY, SETTINGS_KEY, LEGACY_KEY, ACTIVE_KEY, 'attenly:calc-drafts', 'attenly:painted']) write(k, null);
    clearRecordCopies();
    setSettings(DEFAULT_SETTINGS);
    setSeenAll({});
  }, []);

  const signOut = useCallback(async () => {
    if (stateRef.current.local) return signOutLocal();
    write(CACHE_KEY, null);
    write(ACTIVE_KEY, null);
    clearRecordCopies();
    await nextAuthSignOut({ callbackUrl: `${BASE_PATH}` });
  }, [signOutLocal]);

  const refresh = useCallback(() => load(stateRef.current.active), [load]);
  const stale = state.snapshot ? clockNow + state.skew - new Date(state.snapshot.syncedAt).getTime() >= state.freshMs : true;

  // One object per real change. The 30-second clock only matters when it flips `stale`,
  // so its ticks no longer re-render every screen that reads the store.
  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      settings,
      activeAccount,
      seen,
      stale,
      refresh,
      forceSync,
      switchAccount,
      onLinked,
      removeAccount,
      makePrimary,
      setTerm,
      updateSettings,
      setLastInstructionDay,
      markSeen,
      clearDevice,
      signOut,
    }),
    [state, settings, activeAccount, seen, stale, refresh, forceSync, switchAccount, onLinked, removeAccount, makePrimary, setTerm, updateSettings, setLastInstructionDay, markSeen, clearDevice, signOut],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
