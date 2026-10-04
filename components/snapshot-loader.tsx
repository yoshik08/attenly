'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePlanner, type SnapshotData } from '@/components/data-context';
import { api } from '@/lib/api';

/**
 * On mount (and when the Google session appears), pull the latest backend
 * snapshot for this user into the planner context. The 10-minute backend
 * sync keeps it fresh; this just loads what's already there.
 */
export function SnapshotLoader() {
  const { status } = useSession();
  const { loadSnapshot, ready } = usePlanner();
  const done = useRef(false);

  useEffect(() => {
    if (!ready || status !== 'authenticated' || done.current) return;
    done.current = true;
    fetch(api('/api/snapshots?mine=1'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.snapshot) loadSnapshot(d.snapshot as SnapshotData);
      })
      .catch(() => {
        /* no snapshot yet — the gate will handle it */
      });
  }, [ready, status, loadSnapshot]);

  return null;
}
