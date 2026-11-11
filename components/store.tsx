'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { countsOf, type SeenCounts } from '@/lib/insights';

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
  onLinked: (universityId: string, snapshot: ClientSnapshot) => Promise<void>;
  removeAccount: (universityId: string) => Promise<{ ok: boolean; error?: string }>;
  makePrimary: (universityId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Sync a specific year and semester (ERP ids) for the shown account, or null for automatic. */
  setTerm: (term: { academicyear: string; semesterid: string } | null) => Promise<{ ok: boolean; error?: string }>;
  updateSettings: (patch: Partial<Settings>) => void;
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
}

const IDLE_SYNC: SyncState = { running: false, mode: null, code: null, message: null, at: null };

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>({
    phase: 'boot',
    googleConfigured: true,
    user: null,
    accounts: [],
    active: null,
    snapshot: null,
    freshMs: 330_000,
    skew: 0,
    loadError: null,
    sync: IDLE_SYNC,
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

  const load = useCallback(
    async (account?: string | null) => {
      const wanted = account ?? readActive() ?? null;
      try {
        const res = await fetch(api(`/api/data${wanted ? `?account=${encodeURIComponent(wanted)}` : ''}`), {
          cache: 'no-store',
        });
        const d = await res.json();
        if (!d.signedIn) {
          write(CACHE_KEY, null);
          setState((s) => ({ ...s, phase: 'signed-out', googleConfigured: d.googleConfigured !== false, user: null, accounts: [], active: null, snapshot: null, loadError: null }));
          return;
        }
        if (!res.ok) {
          setState((s) => ({ ...s, phase: s.snapshot ? 'ready' : 'error', loadError: d.error ?? 'Attenly can’t load your data right now.' }));
          return;
        }
        const active: string | null = d.active ?? null;
        if (active) write(ACTIVE_KEY, active);
        const cache = read<CacheShape>(CACHE_KEY) ?? { user: null, accounts: [], snapshots: {} };
        cache.user = d.user;
        cache.accounts = d.accounts;
        if (active && d.snapshot) cache.snapshots[active] = d.snapshot;
        write(CACHE_KEY, cache);
        ensureSeen(active, d.snapshot ?? (active ? (cache.snapshots[active] ?? null) : null));
        setState((s) => ({
          ...s,
          phase: 'ready',
          user: d.user,
          accounts: d.accounts ?? [],
          active,
          snapshot: d.snapshot ?? (active ? (cache.snapshots[active] ?? null) : null),
          freshMs: typeof d.freshMs === 'number' ? d.freshMs : s.freshMs,
          skew: typeof d.serverNow === 'number' ? d.serverNow - Date.now() : 0,
          loadError: null,
        }));
      } catch {
        setState((s) => ({ ...s, phase: s.snapshot ? 'ready' : 'error', loadError: 'You look offline. Showing what this device last saw.' }));
      }
    },
    [ensureSeen],
  );

  // Boot: settings, cached data for an instant first paint, then the network.
  useEffect(() => {
    // localStorage only exists after hydration; reading it during render would
    // make the first client render differ from the server HTML.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSettings(loadSettings());
    const seenStored = read<Record<string, SeenCounts>>(SEEN_KEY) ?? {};
    setSeenAll(seenStored);
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
      }));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    void load(active);
  }, [load, ensureSeen]);

  const runSync = useCallback(
    async (mode: 'auto' | 'force') => {
      const s = stateRef.current;
      const id = s.active;
      if (!id || syncing.current) return;
      syncing.current = true;
      setState((p) => ({ ...p, sync: { ...p.sync, running: true, mode } }));
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
    [persistSnapshot],
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
  useEffect(() => {
    if (state.phase !== 'ready' || !state.active) return;
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
  }, [state.phase, state.active, state.accounts, ageOf, runSync]);

  const forceSync = useCallback(() => runSync('force'), [runSync]);

  const switchAccount = useCallback(
    async (universityId: string) => {
      write(ACTIVE_KEY, universityId);
      const cache = read<CacheShape>(CACHE_KEY);
      setState((s) => ({ ...s, active: universityId, snapshot: cache?.snapshots[universityId] ?? null, sync: IDLE_SYNC }));
      await load(universityId);
    },
    [load],
  );

  const onLinked = useCallback(
    async (universityId: string, snapshot: ClientSnapshot) => {
      write(ACTIVE_KEY, universityId);
      persistSnapshot(universityId, snapshot);
      ensureSeen(universityId, snapshot);
      setState((s) => ({ ...s, active: universityId, snapshot, sync: { ...IDLE_SYNC, code: 'synced', at: Date.now() } }));
      await load(universityId);
    },
    [load, persistSnapshot, ensureSeen],
  );

  const removeAccount = useCallback(
    async (universityId: string) => {
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
    [load, persistSnapshot],
  );

  const makePrimary = useCallback(
    async (universityId: string) => {
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
    setSettings(DEFAULT_SETTINGS);
    setSeenAll({});
  }, []);

  const signOut = useCallback(async () => {
    write(CACHE_KEY, null);
    write(ACTIVE_KEY, null);
    await nextAuthSignOut({ callbackUrl: `${BASE_PATH}` });
  }, []);

  const value: StoreValue = {
    ...state,
    settings,
    activeAccount,
    seen,
    stale: state.snapshot ? clockNow + state.skew - new Date(state.snapshot.syncedAt).getTime() >= state.freshMs : true,
    refresh: () => load(stateRef.current.active),
    forceSync,
    switchAccount,
    onLinked,
    removeAccount,
    makePrimary,
    setTerm,
    updateSettings,
    markSeen,
    clearDevice,
    signOut,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
