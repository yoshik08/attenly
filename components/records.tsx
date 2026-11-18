'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { RecordData } from '@/lib/erp/records';
import { RECORD_MAX_AGE, type RecordSet } from '@/lib/record-sets';
import { localPost } from './local';
import { useStore } from './store';

export const RECORDS_PREFIX = 'attenly:rec:v1:';

interface Stored<T> {
  data: T;
  fetchedAt: string;
}

interface RecordState<T> {
  data: T | null;
  fetchedAt: string | null;
  /** Asking the server (and possibly the ERP) right now. */
  loading: boolean;
  error: string | null;
  code: string | null;
  /** The ERP failed and this is the last copy Attenly read. */
  stale: boolean;
}

function readLocal<T>(key: string): Stored<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Stored<T>) : null;
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: Stored<unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* full or blocked: the screen still works, it just won't open instantly next time */
  }
}

/**
 * One on-demand ERP set for the shown account. Paints from this device's last copy at
 * once, then asks the server, which answers from its cache or reads the ERP.
 * `refresh()` skips both caches.
 *
 * Signed in without Google the server keeps no cache, so this device's copy stands in
 * for it: the ERP is only asked again once the copy is older than the set's max age.
 */
export function useRecord<S extends RecordSet>(set: S, params: { ay?: string; sem?: string } = {}, enabled = true) {
  type T = RecordData[S];
  const { active, local } = useStore();
  const { ay, sem } = params;
  const key = `${RECORDS_PREFIX}${active ?? '-'}:${set}${ay && sem ? `:${ay}:${sem}` : ''}`;
  const [state, setState] = useState<RecordState<T>>({ data: null, fetchedAt: null, loading: false, error: null, code: null, stale: false });
  const seq = useRef(0);

  const load = useCallback(
    async (fresh: boolean) => {
      if (!active || !enabled) return;
      if (local && !fresh) {
        const copy = readLocal<T>(key);
        if (copy && Date.now() - Date.parse(copy.fetchedAt) < RECORD_MAX_AGE[set]) return;
      }
      const mine = ++seq.current;
      setState((s) => ({ ...s, loading: true, error: null, code: null }));
      const q = new URLSearchParams({ set, account: active });
      if (ay && sem) {
        q.set('ay', ay);
        q.set('sem', sem);
      }
      if (fresh) q.set('fresh', '1');
      try {
        const res = local
          ? await localPost('/api/local/records', { set, ...(ay && sem ? { ay, sem } : {}) })
          : await fetch(api(`/api/erp/records?${q.toString()}`), { cache: 'no-store' });
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          data?: T;
          fetchedAt?: string;
          stale?: boolean;
          error?: string;
          code?: string;
        };
        if (mine !== seq.current) return;
        if (!res.ok || !d.ok || !d.data) {
          setState((s) => ({ ...s, loading: false, error: d.error ?? 'Attenly couldn’t read this from the ERP.', code: d.code ?? null }));
          return;
        }
        const fetchedAt = d.fetchedAt ?? new Date().toISOString();
        writeLocal(key, { data: d.data, fetchedAt });
        setState({ data: d.data, fetchedAt, loading: false, error: d.stale ? (d.error ?? null) : null, code: null, stale: Boolean(d.stale) });
      } catch {
        if (mine !== seq.current) return;
        setState((s) => ({ ...s, loading: false, error: 'You look offline. Showing what this device last saw.', code: 'offline' }));
      }
    },
    [active, local, enabled, set, ay, sem, key],
  );

  useEffect(() => {
    // This device's copy first (only readable after hydration), then the network.
    const local = readLocal<T>(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the cached copy paints before the request returns
    setState({ data: local?.data ?? null, fetchedAt: local?.fetchedAt ?? null, loading: false, error: null, code: null, stale: false });
    void load(false);
  }, [key, load]);

  const refresh = useCallback(() => load(true), [load]);
  return { ...state, refresh };
}
